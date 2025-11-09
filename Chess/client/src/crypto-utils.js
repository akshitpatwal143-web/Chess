import { ec as EC } from 'elliptic';
import { SHA256 } from 'crypto-js';

const ec = new EC('secp256k1');

// Generate a new key pair
export const generateKeys = () => {
  const key = ec.genKeyPair();
  const publicKey = key.getPublic('hex');
  const privateKey = key.getPrivate('hex');
  return { publicKey, privateKey };
};

// Sign a piece of data
export const signData = (privateKey, data) => {
  const key = ec.keyFromPrivate(privateKey, 'hex');
  const hash = SHA256(data).toString();
  const signature = key.sign(hash, 'base64');
  return signature.toDER('hex');
};

// Store keys in local storage
export const saveKeys = (gameId, keys) => {
  localStorage.setItem(`chess-keys-${gameId}`, JSON.stringify(keys));
};

// Retrieve keys from local storage
export const getKeys = (gameId) => {
  const keys = localStorage.getItem(`chess-keys-${gameId}`);
  return keys ? JSON.parse(keys) : null;
};