// All input validation lives here so nothing from a client is ever
// trusted without being checked first (security requirement: validate
// all input / block field tampering).
const cfg = require('../config');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validUsername(name) {
  if (!isNonEmptyString(name)) return false;
  const trimmed = name.trim();
  if (trimmed.length < cfg.MIN_USERNAME_LENGTH || trimmed.length > cfg.MAX_USERNAME_LENGTH) {
    return false;
  }
  // letters, numbers, underscore, hyphen only - prevents HTML/script injection
  // via username (also escaped again at render time on the client, belt & braces)
  return /^[A-Za-z0-9_\-]+$/.test(trimmed);
}

function sanitizeUsername(name) {
  return String(name).trim().slice(0, cfg.MAX_USERNAME_LENGTH);
}

function validLobbySettings(settings) {
  if (typeof settings !== 'object' || settings === null) return false;
  const { wordLength, maxPlayers, rounds, isPublic } = settings;

  if (!Number.isInteger(wordLength) || wordLength < cfg.MIN_LETTERS || wordLength > cfg.MAX_LETTERS) {
    return false;
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < cfg.MIN_PLAYERS || maxPlayers > cfg.MAX_PLAYERS) {
    return false;
  }
  if (!Number.isInteger(rounds) || rounds < cfg.MIN_ROUNDS || rounds > cfg.MAX_ROUNDS) {
    return false;
  }
  if (typeof isPublic !== 'boolean') return false;

  return true;
}

function validLobbyId(id) {
  if (!isNonEmptyString(id)) return false;
  if (id.length !== cfg.LOBBY_ID_LENGTH) return false;
  const alphabetSet = new Set(cfg.LOBBY_ID_ALPHABET.split(''));
  return [...id].every((ch) => alphabetSet.has(ch));
}

function validGuess(word, expectedLength) {
  if (!isNonEmptyString(word)) return false;
  const trimmed = word.trim();
  if (trimmed.length !== expectedLength) return false;
  return /^[A-Za-z]+$/.test(trimmed);
}

module.exports = {
  validUsername,
  sanitizeUsername,
  validLobbySettings,
  validLobbyId,
  validGuess,
};
