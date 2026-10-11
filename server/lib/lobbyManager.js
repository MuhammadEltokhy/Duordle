const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const USED_IDS_FILE = path.join(__dirname, '..', 'data', 'used_ids.json');

function loadUsedIds() {
  try {
    if (!fs.existsSync(USED_IDS_FILE)) {
      fs.writeFileSync(USED_IDS_FILE, '[]');
      return new Set();
    }
    return new Set(JSON.parse(fs.readFileSync(USED_IDS_FILE, 'utf8')));
  } catch (err) {
    console.warn(`[lobbies] could not read the used-ID ledger: ${err.message}`);
    return new Set();
  }
}

function persistUsedId() {
  try {
    fs.writeFileSync(USED_IDS_FILE, JSON.stringify(Array.from(usedIds)));
  } catch (err) {
    // Read-only disk (some hosts): IDs are still never reused while the server runs.
    console.warn(`[lobbies] could not save the used-ID ledger: ${err.message}`);
  }
}

// Every ID ever generated lives here forever, even after its lobby is
// long gone - this file is append-only by design (per the requirement
// that an ID, once used, is never reused on this site again).
const usedIds = loadUsedIds();

function generateLobbyId() {
  const { LOBBY_ID_LENGTH, LOBBY_ID_ALPHABET } = cfg;
  let id;
  do {
    id = '';
    for (let i = 0; i < LOBBY_ID_LENGTH; i++) {
      id += LOBBY_ID_ALPHABET[Math.floor(Math.random() * LOBBY_ID_ALPHABET.length)];
    }
  } while (usedIds.has(id));

  usedIds.add(id);
  persistUsedId();
  return id;
}

// ---- In-memory active lobby store ----
// lobbyId -> Lobby object (see server/index.js for shape/usage)
const lobbies = new Map();

function createLobby(lobby) {
  lobbies.set(lobby.id, lobby);
  return lobby;
}

function getLobby(id) {
  return lobbies.get(id);
}

// Closing a lobby removes it from memory only. Its ID stays in the used-ID ledger
// above FOREVER, so that ID can never be issued to another lobby.
function deleteLobby(id) {
  lobbies.delete(id);
}

function listPublicLobbies(filters = {}) {
  const result = [];
  for (const lobby of lobbies.values()) {
    if (!lobby.settings.isPublic) continue;
    if (lobby.state !== 'lobby') continue; // don't list lobbies already mid-game
    if (filters.maxPlayers && lobby.settings.maxPlayers !== filters.maxPlayers) continue;
    if (filters.wordLength && lobby.settings.wordLength !== filters.wordLength) continue;

    result.push({
      id: lobby.id,
      wordLength: lobby.settings.wordLength,
      playerCount: lobby.players.length,
      maxPlayers: lobby.settings.maxPlayers,
    });
  }
  return result;
}

module.exports = {
  generateLobbyId,
  createLobby,
  getLobby,
  deleteLobby,
  listPublicLobbies,
  lobbies,
};
