import { useEffect, useState, useCallback } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { io } from "socket.io-client";
import QRCode from "qrcode.react";
// ✅ Add new crypto helpers
import { generateKeys, saveKeys, getKeys, signData } from "./crypto-utils";

// A simple way to get gameId from URL, e.g., /join/chess-123abc
const getGameIdFromUrl = () => {
  const path = window.location.pathname;
  if (path.startsWith('/join/')) {
    return path.split('/')[2];
  }
  return null;
}

const socket = io("192.168.1.171:3001");

export default function App() {
  const [showQr, setShowQr] = useState(false);
  const [qrData, setQrData] = useState("");
  const [moves, setMoves] = useState([]);
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState("start");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isGameOver, setGameOver] = useState(false);
  const [gameOverReason, setGameOverReason] = useState("");
  const [redoMoves, setRedoMoves] = useState([]);
  const [gameMode, setGameMode] = useState("idle"); // Can be 'idle', 'multiplayer', or 'computer'

  // ✅ New state to manage game session
  const [gameId, setGameId] = useState(getGameIdFromUrl());
  const [playerColor, setPlayerColor] = useState(null); // 'white' or 'black'
  // ✅ ADD THIS NEW HOOK TO DETECT GAME OVER

  useEffect(() => {
    // Only check for game over if we are in computer mode and the game is not already over
    if (gameMode === 'computer' && !isGameOver) {
      if (game.isGameOver()) {
        setGameOver(true); // Update the state to show the game has ended

        let reason = "Game Over";
        if (game.isCheckmate()) {
          // The winner is the player whose turn it is NOT.
          const winner = game.turn() === 'w' ? 'Black' : 'White';
          reason = `Checkmate! ${winner} wins.`;
        } else if (game.isStalemate()) {
          reason = "Stalemate! It's a draw.";
        } else if (game.isThreefoldRepetition()) {
          reason = "Draw by Threefold Repetition.";
        } else if (game.isInsufficientMaterial()) {
          reason = "Draw by Insufficient Material.";
        }

        setGameOverReason(reason);
        // Use an alert to make it obvious to the user
        alert(reason);
      }
    }
  }, [game, gameMode, isGameOver]); // This hook runs every time the game state changes

  useEffect(() => {
    const joinExistingGame = async (id) => {
      let keys = getKeys(id);
      if (!keys) {
        keys = generateKeys();
        saveKeys(id, keys);
      }

      try {
        const res = await fetch(`/api/game/${id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player2PublicKey: keys.publicKey }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);

        console.log("Successfully joined as Player 2 (Black)");
        setPlayerColor('black');
        setGameId(id);
        setGameMode('multiplayer');
        socket.emit("game:join", id);
      } catch (e) {
        setErr(`Failed to join game: ${e.message}`);
      }
    };

    const urlGameId = getGameIdFromUrl();
    if (urlGameId) {
      joinExistingGame(urlGameId);
    }
  }, []);
  const handlePlayComputerClick = () => {
    // Reset the game
    const newGame = new Chess();
    setGame(newGame);
    setFen(newGame.fen());
    setMoves([]);
    setRedoMoves([]);
    setGameOver(false);
    setGameOverReason("");
    setGameId(null); // Clear any existing multiplayer gameId
    setShowQr(false); // Hide QR code if it was open

    // Set the mode to 'computer' and player as White
    setGameMode("computer");
    setPlayerColor('white'); // Player is always white against the computer
    console.log("Starting a new game against the computer.");
  };

  // ✅ Modified Multiplayer button click handler
  const handleMultiplayerClick = async () => {
    setGameMode("multiplayer");
    console.log("Multiplayer button clicked!");
    setErr("");
    try {
      const keys = generateKeys();
      console.log("Generated keys, sending request to server..."); // 👈 Log 2

      const res = await fetch("/api/game/create", { // 👈 Make sure this IP is correct!
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1PublicKey: keys.publicKey }),
      });

      const json = await res.json();
      console.log("Received response from server:", json); // 👈 Log 3

      if (!json.ok) {
        throw new Error(json.error || "Failed to create game");
      }

      const newGameId = json.gameId;
      saveKeys(newGameId, keys);
      setGameId(newGameId);
      setPlayerColor('white');

      const link = `${window.location.origin}/join/${newGameId}`;
      setQrData(link);
      setShowQr(true);
      socket.emit("game:join", newGameId);
      console.log(`QR code should be visible now for game: ${newGameId}`); // 👈 Log 4

    } catch (e) {
      console.error("Error in handleMultiplayerClick:", e); // 👈 Log 5 (Error)
      setErr(`Error creating game: ${e.message}`);
    }
  };

  // Socket listeners
  // Inside your existing socket listener useEffect
  useEffect(() => {
    socket.on("connect", () => console.log("Socket connected:", socket.id));

    socket.on("game:update", (data) => {
      console.log("Received game:update from server", data);

      // ✅ Add this check to prevent crashes
      if (!data || !Array.isArray(data.moves)) {
        console.error("Received invalid game update data. Moves is not an array.");
        return; // Stop execution if the data is bad
      }

      const g = new Chess();
      data.moves.forEach((m) => g.move(m));

      setGame(g);
      setFen(g.fen());
      setMoves(data.moves);
      setRedoMoves(data.redoMoves || []);
    });

    socket.on("game:start", (data) => {
      console.log("Player 2 joined! Game has started.", data);
      setShowQr(false);
    });

    socket.on("game:end", (data) => {
      console.log("Game over!", data.reason);
      setGameOver(true);
      setGameOverReason(data.reason);
      alert(`Game Over: ${data.reason}`);
    });

    socket.on("disconnect", () => console.log("Socket disconnected"));

    return () => {
      socket.off("connect");
      socket.off("game:update");
      socket.off("game:start");
      socket.off("disconnect");
      socket.off("game:end");
    };
  }, []);
  // 👈 Add dependencies
  // ✅ ADD THESE FUNCTIONS TO YOUR COMPONENT
  const undo = async () => {
    if (!gameId) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/game/${gameId}/undo`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Undo failed");
      // Update will come via socket, no need to set state here
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  const redo = async () => {
    if (!gameId || redoMoves.length === 0) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/game/${gameId}/redo`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Redo failed");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  const reset = async () => {
    if (!gameId || !confirm("Reset the board for review?")) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/game/${gameId}/reset`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Reset failed");
      // Update will come via socket, no need to set state here
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  // AFTER
  const addMove = useCallback(async (san) => {
    if (!gameId) {
      setErr("You are not in a game session.");
      return;
    }
    const keys = getKeys(gameId);
    if (!keys) {
      setErr("Your cryptographic keys are missing for this game.");
      return;
    }

    setLoading(true);
    setErr("");
    try {
      const dataToSign = `${gameId}|${san}`;
      const signature = signData(keys.privateKey, dataToSign);
      const res = await fetch(`/api/game/${gameId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          move: san,
          publicKey: keys.publicKey,
          signature: signature,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Add move failed");
    } catch (e) {
      setErr(e.message);
      const g = new Chess();
      moves.forEach((m) => g.move(m));
      setGame(g);
      setFen(g.fen());
    } finally {
      setLoading(false);
    }
  }, [gameId, moves]); 
// ✅ ADD THIS ENTIRE FUNCTION
const onDrop = useCallback((sourceSquare, targetSquare) => {
  // Create a copy to safely validate the move
  const gameCopy = new Chess(game.fen());
  const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: "q" });

  // If the move is illegal, do nothing
  if (move === null) return false;

  // In multiplayer, we just send the move and wait for the server's update
  if (gameMode === 'multiplayer') {
    void addMove(move.san);
  } else {
    // In computer mode, we update the state directly by rebuilding the history
    const newMoves = [...moves, move.san];
    const newGame = new Chess();
    newMoves.forEach(m => newGame.move(m));
    
    setGame(newGame);
    setMoves(newMoves);
    setFen(newGame.fen());
  }
  
  return true;
}, [game, gameMode, addMove, moves]); // Dependencies are important
useEffect(() => {
  const makeComputerMove = () => {
    // Exit if not the computer's turn
    if (gameMode !== 'computer' || game.isGameOver() || game.turn() !== 'b') {
      return;
    }

    // 1. Find a random move to make
    const possibleMoves = game.moves({ verbose: true });
    if (possibleMoves.length === 0) return;
    const randomIndex = Math.floor(Math.random() * possibleMoves.length);
    const move = possibleMoves[randomIndex];

    // 2. Append the computer's move to our existing 'moves' array
    const newMoves = [...moves, move.san];

    // 3. Create a fresh game object from the START
    const newGame = new Chess();
    // 4. Replay ALL moves from our complete history onto the fresh game
    newMoves.forEach(m => newGame.move(m));

    // 5. Update the state after a short delay with the new, correct info
    setTimeout(() => {
      setGame(newGame);
      setMoves(newMoves);
      setFen(newGame.fen());
    }, 300);
  };

  makeComputerMove();
}, [game, gameMode, moves]); // ✅ IMPORTANT: 'moves' must be in the dependency array
  // ✅ REPLACE WITH THIS CORRECTED BLOCK
const turn = game.turn();
const nextTurn = turn === "w" ? "White" : "Black";

// This is the main logic fix. It now correctly handles the state for both players.
const isMyTurn = gameMode === 'multiplayer' 
  ? (playerColor === 'white' && turn === 'w') || (playerColor === 'black' && turn === 'b')
  : (gameMode === 'computer' && turn === 'w');

// The chessboard's draggable prop now just uses our reliable isMyTurn variable.
const arePiecesDraggable = isMyTurn;

// Optional: Keep this log for debugging if you want
console.log({
  gameMode: gameMode,
  playerColor: playerColor,
  turn: turn,
  isMyTurn: isMyTurn,
  arePiecesDraggable: arePiecesDraggable
});

  // --- RENDER LOGIC ---
  // (Your JSX remains mostly the same, but you would replace your
  // Multiplayer button's onClick with `handleMultiplayerClick` and disable
  // the undo/reset buttons, as they are not implemented in secure mode).
  // Also, you'd use the `isMyTurn` variable to control the board.
  const boardWidth = Math.min(520, windowWidth - 40);
  const isMobile = windowWidth < 768;

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "1rem",
        paddingTop: "3.5rem",
      }}
    >
      {/* Heading */}
      <h1

        style={{
          position: "fixed",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          margin: 0,
          padding: "12px 0",
          fontSize: "1.5rem",
          textAlign: "center",
          backgroundImage: "url('/wood_1.jpg')", // ✅ Correct way to reference image
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          width: "100%",
          zIndex: 1000,
          color: "#fff",
          fontWeight: "bold", // ✅ Add this line
          letterSpacing: "1px", // optional: spacing between letters
          textShadow: "1px 1px 2px rgba(0,0,0,0.5)", // optional: improves readability
        }}
      >
        Chess Moves
      </h1>




      {/* Instruction above the board */}
      <p style={{ textAlign: "left", marginLeft: "5px", fontSize: "1rem" }}>
        Play on the board or type moves like <code>e4</code>, <code>Nf3</code>, <code>Bc4</code>.
      </p>

      {/* Main Flex Container */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row", // 📱 stack on mobile
          justifyContent: "center",
          alignItems: "flex-start",
          gap: isMobile ? 20 : 50,
        }}
      >
        {/* Chessboard */}
        <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
          <Chessboard
            // 👈 force redraw when fen changes
            position={fen}
            onPieceDrop={onDrop}
            boardWidth={boardWidth}
            arePiecesDraggable={arePiecesDraggable}
          />

        </div>

        {/* 📱 On Mobile → Controls + Moves side by side */}
        {isMobile ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row", // side by side
              justifyContent: "center",
              gap: 20,
              width: "100%",
            }}
          >
            {/* Controls (Mobile) */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                boxShadow: "0 2px 6px rgba(252, 250, 250, 0.15)",
                background: "transparent",
                flex: 1,
              }}
            >
              {/* ✅ Next Turn box fixed for mobile */}
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center", // center content
                  gap: 8,
                  fontWeight: "600",
                  boxShadow: "0 2px 6px rgba(252, 250, 250, 0.15)",
                  width: "100%", // full width so it doesn’t overflow
                  border: "1px solid #686262ff",
                  background: "transparent",
                  fontSize: "0.9rem",
                  marginBottom: 10,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    border: "1px solid #fff",
                    backgroundColor: nextTurn === "White" ? "#fff" : "#000",
                  }}
                />
                {nextTurn}
              </div>

              <button onClick={handlePlayComputerClick} disabled={gameMode !== 'idle'}>
                Play with Computer
              </button>
              <button onClick={handleMultiplayerClick} disabled={!!gameId}>
                Multiplayer
              </button>

              {showQr && (
                <div
                  // ✅ REPLACE the old style with this new one
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    background: "rgba(0, 0, 0, 0.5)", // Semi-transparent black backdrop
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 2000, // Make sure it's on top of everything
                  }}
                >
                  <div
                    style={{
                      background: "#fff",
                      color: "#000",
                      padding: "20px",
                      borderRadius: "8px",
                      textAlign: "center",
                    }}
                  >
                    <h3 style={{ margin: "0 0 10px 0", fontSize: "1.2rem" }}>Scan to Join</h3>
                    <QRCode value={qrData} size={150} />
                    <p style={{ fontSize: "0.8rem", margin: "10px 0 0 0" }}>Or share link:</p>
                    <code style={{ fontSize: "0.7rem", wordBreak: "break-all" }}>{qrData}</code>
                  </div>
                </div>
              )}
              <button
                onClick={undo}
                // This logic correctly disables the button during the game
                // and enables it only after the game is finished.
                disabled={!isGameOver || loading || moves.length === 0}
              >
                Undo
              </button>

              <button onClick={redo} disabled={!isGameOver || redoMoves.length === 0 || loading}>
                Redo
              </button>
              <button
                onClick={reset}
                disabled={!isGameOver || loading || moves.length === 0}
              >
                Reset
              </button>

            </div>

            {/* Moves List (Mobile, unchanged) */}
            <div style={{ flex: 1 }}>
              {err && <div style={{ color: "crimson", marginBottom: 8 }}>{err}</div>}
              <h2 style={{ textAlign: "center", fontSize: "1.2rem" }}>Moves</h2>
              <ol
                style={{
                  marginTop: 8,
                  fontSize: "1rem",
                  textAlign: "left",
                  maxHeight: "200px",
                  overflowY: "auto",
                  paddingLeft: "1.2em",
                  lineHeight: "1.8em",
                  whiteSpace: "nowrap", // 💥 prevent wrapping
                  overflowX: "auto", // 💥 allow horizontal scroll if needed
                  display: "block",
                }}
              >
                {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, index) => {
                  const whiteMove = moves[2 * index];
                  const blackMove = moves[2 * index + 1];
                  return (
                    <li key={index} style={{ whiteSpace: "nowrap" }}>
                      White: {whiteMove || ""} <span style={{ margin: "0 8px", color: "#666" }}>•</span> Black: {blackMove || ""}
                    </li>

                  );
                })}
              </ol>

            </div>
          </div>
        ) : (
          <>
            {/* Controls (Desktop, unchanged) */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 20,
                marginRight: 50,
                alignItems: "flex-start",
              }}
            >
              {/* Next Move box */}
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: "600",
                  boxShadow: "0 2px 6px rgba(252, 250, 250, 0.15)",
                  width: 140,
                  border: "1px solid #686262ff",
                  background: "transparent",
                  fontSize: "0.9rem",
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    border: "1px solid #fff",
                    backgroundColor: nextTurn === "White" ? "#fff" : "#000",
                  }}
                />
                {nextTurn}
              </div>

              {/* Controls buttons */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 12,
                  borderRadius: 8,
                  boxShadow: "0 2px 6px rgba(252, 250, 250, 0.15)",
                  width: 160,
                  background: "transparent",
                }}
              >

                <button onClick={handlePlayComputerClick} disabled={gameMode !== 'idle'}>
                  Play with Computer
                </button>

                <button onClick={handleMultiplayerClick} disabled={!!gameId}>
                  Multiplayer
                </button>
                {showQr && (
                  <div
                    // ✅ REPLACE the old style with this new one
                    style={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      background: "rgba(0, 0, 0, 0.5)", // Semi-transparent black backdrop
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      zIndex: 2000, // Make sure it's on top of everything
                    }}
                  >
                    <div
                      style={{
                        background: "#fbfafaf0",
                        marginLeft: "auto", // Pushes the box to the right
                        marginRight: "200px",
                        color: "#000",
                        padding: "20px",
                        borderRadius: "8px",
                        textAlign: "center",
                      }}
                    >
                      <h3 style={{ margin: "0 0 10px 0", fontSize: "1.2rem" }}>Scan to Join</h3>
                      <QRCode value={qrData} size={150} />
                      <p style={{ fontSize: "0.8rem", margin: "10px 0 0 0" }}>Or share link:</p>
                      <code style={{ fontSize: "0.7rem", wordBreak: "break-all" }}>{qrData}</code>
                    </div>
                  </div>
                )}




                <button onClick={undo} disabled={!isGameOver || loading || moves.length === 0}>
                  Undo
                </button>

                <button onClick={redo} disabled={!isGameOver || redoMoves.length === 0 || loading}>
                  Redo
                </button>
                <button onClick={reset} disabled={!isGameOver || loading || moves.length === 0}>
                  Reset
                </button>

              </div>

            </div>

            {/* Moves List (Desktop, unchanged) */}
            <div style={{ flex: 1 }}>
              {err && <div style={{ color: "crimson", marginBottom: 8 }}>{err}</div>}
              <h2 style={{ textAlign: "center", fontSize: "1.2rem" }}>Moves</h2>
              <ol
                style={{
                  marginTop: 8,
                  fontSize: "1rem",
                  textAlign: "left",
                  maxHeight: "200px",
                  overflowY: "auto",
                  paddingLeft: "1.2em",
                  lineHeight: "1.8em",
                  whiteSpace: "nowrap", // 💥 prevent wrapping
                  overflowX: "auto", // 💥 allow horizontal scroll if needed
                  display: "block",
                }}
              >
                {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, index) => {
                  const whiteMove = moves[2 * index];
                  const blackMove = moves[2 * index + 1];
                  return (
                    <li key={index} style={{ whiteSpace: "nowrap" }}>
                      White: {whiteMove || ""} <span style={{ margin: "0 8px", color: "#666" }}>—</span> Black: {blackMove || ""}
                    </li>

                  );
                })}
              </ol>



            </div>
          </>
        )}
      </div>
    </div >
  );
}

