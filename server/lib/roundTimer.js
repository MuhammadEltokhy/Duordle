// The round countdown rule, as a pure function (unit-testable).
//
// Called every time a player FINISHES a word (solved it OR used all their trials).
//   - A lobby that started with only 2 players never shrinks: it keeps the host's time.
//   - Otherwise the remaining time is multiplied by REDUCTION_FACTOR, but not below
//     MIN_REMAINING_MS, and it can never increase.
//   - Once only 2 (or fewer) players are still playing, the remaining time is capped
//     at LAST_TWO_MAX_MS (1 minute).
//
// Example (4 players, 3:00 limit): p1 finishes with 2:38 left -> 1:50 left;
// p2 finishes 23s later with 1:27 left -> 1:01, capped to 1:00 for the last two.
const { TIMER } = require('../config');

function reduceRemaining({ remainingMs, unfinishedAfter, initialPlayers }) {
  if (initialPlayers <= 2) return remainingMs;

  let next = Math.min(remainingMs, Math.max(TIMER.MIN_REMAINING_MS, remainingMs * TIMER.REDUCTION_FACTOR));
  if (unfinishedAfter <= 2) next = Math.min(next, TIMER.LAST_TWO_MAX_MS);
  return Math.max(0, Math.round(next));
}

module.exports = { reduceRemaining };
