// Central config. Every tunable number in the game lives here so you can
// rebalance scoring / timing / limits without hunting through other files.
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,

  // ---- Oxford Dictionaries API (word validation + answer-pool filtering) ----
  OXFORD_APP_ID: process.env.OXFORD_APP_ID || '',
  OXFORD_APP_KEY: process.env.OXFORD_APP_KEY || '',
  OXFORD_ENABLED: Boolean(process.env.OXFORD_APP_ID && process.env.OXFORD_APP_KEY),
  // false (default): words found in the bundled dictionary are accepted instantly and
  //   Oxford is only asked about words the bundled dictionary doesn't know (saves your
  //   Oxford quota and avoids Oxford's "inflected forms aren't headwords" gaps).
  // true: Oxford is asked about EVERY new guess (results are cached forever).
  OXFORD_CHECK_ALL: process.env.OXFORD_CHECK_ALL === 'true',

  // ---- Lobby limits ----
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

  // Guesses per word (classic Wordle = 6), regardless of word length.
  MAX_TRIALS: 6,

  // ---- Round time limit (host picks it when creating the lobby) ----
  // timeLimitSec = 0 means "no countdown at all".
  MIN_TIME_LIMIT_SEC: 60,   // 1 minute
  MAX_TIME_LIMIT_SEC: 300,  // 5 minutes

  // How the countdown shrinks every time a player finishes (solved OR used all trials).
  // Lobbies that started with only 2 players never shrink - they just get the host's time.
  TIMER: {
    REDUCTION_FACTOR: 0.7,     // remaining time is multiplied by this on every finish...
    MIN_REMAINING_MS: 60000,   // ...but never reduced below 1 minute by this rule...
    LAST_TWO_MAX_MS: 60000,    // ...and once only 2 players are left they get at most 1 minute.
  },

  // ---- Scoring (see server/lib/scoring.js for the formula) ----
  SCORING: {
    POINTS_PER_LETTER: 100,    // base value of a word = 100 x its length (5 letters -> 500)
    // Share of the base value, when SOLVED. Floor + weights must add up to 1.
    // Hierarchy requested: solved >> trial number > time > green/yellow tiles.
    SOLVED_FLOOR: 0.50,        // just for getting the word at all
    TRIAL_WEIGHT: 0.28,        // earlier trial = more
    TIME_WEIGHT: 0.18,         // faster than the first finisher = more
    TILE_WEIGHT: 0.04,         // green/yellow tiles found before solving
    TRIAL_CURVE: 1.3,          // >1 punishes late solves a bit harder
    GREEN_VALUE: 1,            // a green tile counts fully...
    YELLOW_VALUE: 0.5,         // ...a yellow tile counts half
    // NOT solved: flat consolation + a little for the best row of green/yellow tiles.
    FAIL_BASE: 20,
    FAIL_TILE_MAX: 40,
    ROUND_TO: 10,              // scores are rounded to the nearest 10
  },

  // How long a disconnected player's seat is held (covers normal page-to-page
  // navigation, which briefly closes the socket) before they count as having left.
  REMOVAL_GRACE_MS: 8000,

  // Result screen stays this long before the next round starts automatically
  // (the host can skip it with the "Next round" button).
  ROUND_RESULT_DELAY_MS: 14000,
};
