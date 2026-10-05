// Central config. Keeping all tunables in one place also makes it easy
// for you (Muhammad) to rebalance the game later without hunting through files.
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  OXFORD_APP_ID: process.env.OXFORD_APP_ID || '',
  OXFORD_APP_KEY: process.env.OXFORD_APP_KEY || '',
  OXFORD_ENABLED: Boolean(process.env.OXFORD_APP_ID && process.env.OXFORD_APP_KEY),

  MIN_LETTERS: 3,
  MAX_LETTERS: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 6,
  MIN_ROUNDS: 1,
  MAX_ROUNDS: 7,

  LOBBY_ID_LENGTH: 4,
  LOBBY_ID_ALPHABET:
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',

  MAX_USERNAME_LENGTH: 16,
  MIN_USERNAME_LENGTH: 2,

  // How many guesses a player gets, regardless of word length.
  // Classic Wordle uses 6 — keeping this fixed (not length-scaled) is
  // simplest to reason about and matches what most players expect.
  MAX_TRIALS: 6,

  // Round auto-advances this many ms after the result screen shows,
  // if the host doesn't manually click "Next round" first.
  ROUND_RESULT_DELAY_MS: 8000,
};
