
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto"); // 👈 Add this
const { Chess } = require('chess.js'); 
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const app = express();
const cors = require('cors');
// Replace it with this (AFTER)
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// ✅ SETUP MIDDLEWARE HERE
app.use(cors());          // 👈 Add this line to allow all CORS requests
app.use(express.json());  // 👈 Move this line here

const execFileAsync = promisify(execFile);

// --- Game Logic Dependencies (your existing code) ---
const DATA_DIR = path.join(__dirname, "data", "games");
const TMP_DIR = path.join(__dirname, "data", "tmp");
const BIN = path.join(__dirname, "bin", process.platform === "win32" ? "my_moves.exe" : "my_moves");

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });
}
ensureDirs();

async function runC(command, moves, extraArg) {
  const tempPath = path.join(TMP_DIR, `moves_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  await fs.writeFile(tempPath, moves.join("\n"), "utf8");
  try {
    const args = [command, tempPath];
    if (extraArg) args.push(extraArg);
    
    // We now capture both stdout and stderr
    const { stdout, stderr } = await execFileAsync(BIN, args, { timeout: 5000, maxBuffer: 1024 * 1024 });
    
    const updatedMoves = stdout.split(/\r?\n/).filter(Boolean);
    const capturedStderr = stderr.trim(); // The single undone move
    
    return { moves: updatedMoves, captured: capturedStderr };
  } finally {
    fs.rm(tempPath).catch(() => {});
  }
}

// --- NEW In-Memory Game Store ---
const games = {};

function verifySignature(publicKey, data, signature) {
  try {
    // We re-hash the data on the backend in the same way as the frontend
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    
    // Import the public key using the elliptic library
    const key = ec.keyFromPublic(publicKey, 'hex');
    
    // Verify the hash and signature using the key
    return key.verify(hash, signature);
  } catch (e) {
    // If the key or signature is malformed, it will throw an error
    console.error("Verification error:", e.message);
    return false;
  }
}


// --- NEW AND MODIFIED ROUTES ---

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ✅ NEW: Create a new secure session
app.post("/api/game/create", (req, res) => {
  const { player1PublicKey } = req.body;
  if (!player1PublicKey) {
    return res.status(400).json({ ok: false, error: "Missing public key" });
  }

  const gameId = `chess-${crypto.randomBytes(6).toString('hex')}`;
  games[gameId] = {
    gameId,
    players: { white: player1PublicKey, black: null }, // Player 1 is always White
    moves: [],
    redoMoves: [],
    status: 'waiting', // 'waiting' or 'active'
    updatedAt: new Date().toISOString(),
  };

  console.log(`Game created: ${gameId}`);
  res.json({ ok: true, gameId });
});

// ✅ NEW: Join an existing session (Handles React Strict Mode)
app.post("/api/game/:id/join", (req, res) => {
  const gameId = req.params.id;
  const { player2PublicKey } = req.body;
  const game = games[gameId];

  if (!game) {
    return res.status(404).json({ ok: false, error: "Game not found" });
  }

  // If the game is NOT waiting for a player...
  if (game.status !== 'waiting') {
    // ✅ NEW LOGIC: Check if this is the SAME Player 2 joining again.
    if (player2PublicKey === game.players.black) {
      console.log("Player 2 is re-joining the active game (Strict Mode). Allowing it.");
      // If so, just return success without changing anything.
      return res.json({ ok: true, game }); 
    }
    // If it's a DIFFERENT player, then the game is truly full.
    return res.status(403).json({ ok: false, error: "Game is already full" });
  }

  if (!player2PublicKey) {
    return res.status(400).json({ ok: false, error: "Missing public key" });
  }

  // This part only runs the first time
  game.players.black = player2PublicKey;
  game.status = 'active';
  game.updatedAt = new Date().toISOString();

  console.log(`Player 2 joined ${gameId}. Game is active.`);
  
  io.to(gameId).emit("game:start", game);
  
  res.json({ ok: true, game });
});
// 💥 MODIFIED: Make a move with signature verification
// 💥 MODIFIED: Make a move with signature verification AND game-over check
app.post("/api/game/:id/move", async (req, res) => {
  const gameId = req.params.id;
  const game = games[gameId];
  const { move, publicKey, signature } = req.body;

  if (!game) return res.status(404).json({ ok: false, error: "Game not found" });
  if (game.status !== 'active') return res.status(400).json({ ok: false, error: "Game is not active" });
  if (!move || !publicKey || !signature) return res.status(400).json({ ok: false, error: "Missing move, public key, or signature" });
  
  const isWhiteTurn = game.moves.length % 2 === 0;
  const expectedPublicKey = isWhiteTurn ? game.players.white : game.players.black;

  if (publicKey !== expectedPublicKey) {
    return res.status(403).json({ ok: false, error: "Not your turn!" });
  }

  const dataToVerify = `${gameId}|${move}`; 
  if (!verifySignature(publicKey, dataToVerify, signature)) {
    return res.status(403).json({ ok: false, error: "Invalid signature. Move rejected." });
  }
  
  try {
    const { moves } = await runC("add", game.moves, move);
    game.moves = moves;
    game.redoMoves = [];
    game.updatedAt = new Date().toISOString();

    // ✅ CHECK FOR GAME OVER CONDITION
    const chess = new Chess();
    game.moves.forEach(m => chess.move(m)); // Load all moves

    if (chess.isGameOver()) {
      game.status = 'review'; // Change status to unlock controls
      console.log(`Game ${gameId} is over. Status: review`);

      let reason = 'Game Over';
      if (chess.isCheckmate()) reason = 'Checkmate';
      if (chess.isStalemate()) reason = 'Stalemate';
      if (chess.isThreefoldRepetition()) reason = 'Threefold Repetition';
      
      // Notify clients the game has ended
      io.to(gameId).emit('game:end', { status: 'review', reason });
    }

    // Broadcast the move update as usual
    io.to(gameId).emit("game:update", game);
    res.json({ ok: true, game }); 
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/game/:id/undo", async (req, res) => {
  const gameId = req.params.id;
  const game = games[gameId];

  // Only allow if the game exists and is in review mode
  if (!game || game.status !== 'review') {
    return res.status(403).json({ ok: false, error: "Can only undo after the game is over." });
  }
  
  try {
    const { moves, captured } = await runC("undo", game.moves, null);
    game.moves = moves;
    if (captured) {
        game.redoMoves.push(captured); // Add the undone move to the redo stack
    }
    io.to(gameId).emit("game:update", game);
    res.json({ ok: true, game });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/api/game/:id/redo", async (req, res) => {
    const gameId = req.params.id;
    const game = games[gameId];

    if (!game || (game.status !== 'review' && game.status !== 'active')) {
        return res.status(403).json({ ok: false, error: "Cannot redo at this time." });
    }
    if (game.redoMoves.length === 0) {
        return res.status(400).json({ ok: false, error: "No moves to redo." });
    }

    try {
        const moveToRedo = game.redoMoves.pop(); // Get the last undone move
        const { moves } = await runC("add", game.moves, moveToRedo); // Add it back
        game.moves = moves;
        
        io.to(gameId).emit("game:update", game);
        res.json({ ok: true, game });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
// In server.js

app.post("/api/game/:id/reset", async (req, res) => {
  const gameId = req.params.id;
  const game = games[gameId];

  if (!game || game.status !== 'review') {
    return res.status(403).json({ ok: false, error: "Can only reset after the game is over." });
  }

  try {
    const { moves } = await runC("clear", [], null);
    game.moves = moves; // ✅ FIX: Use the 'moves' variable
    io.to(gameId).emit("game:update", game);
    res.json({ ok: true, game }); // ✅ FIX: Send the whole game object for consistency
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Socket.IO for real-time updates
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("game:join", async (gameId) => {
    if (games[gameId]) {
      socket.join(gameId);
      console.log(`Socket ${socket.id} joined room ${gameId}`);
      // Send current game state immediately after join
      socket.emit("game:update", games[gameId]);
    } else {
        socket.emit("error", { message: "Game not found via socket" });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
