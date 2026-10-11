// Pure scoring functions (no sockets, no timers) so they are easy to unit-test.
//
// A word's score depends on its LENGTH and on how the player did. There are no
// difficulty tiers. Priority of the factors, strongest first:
//
//     solved at all  >>  which trial  >  speed vs first finisher  >>  green/yellow tiles
//
// SOLVED:   score = base * ( FLOOR + TRIAL_W*trial + TIME_W*time + TILE_W*tiles )
//     base  = 100 x word length                       (5 letters -> 500 max)
//     trial = ((maxTrials - trialUsed) / (maxTrials-1)) ^ curve     1.0 on the 1st try, 0 on the last
//     time  = firstFinisherTime / myTime                            1.0 for the fastest solver
//     tiles = avg over the guesses made BEFORE solving of
//             (greens*1 + yellows*0.5) / (length*1)                 1.0 if solved on the 1st try
// NOT SOLVED: score = 20 + 40 * (best single row: (greens + yellows*0.5) / length)
//             (0 if the player never made a guess)
// Everything is rounded to the nearest 10.
const { MAX_TRIALS, SCORING } = require('../config');

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function baseValue(length) {
  return SCORING.POINTS_PER_LETTER * length;
}

function trialScore(trialsUsed, maxTrials = MAX_TRIALS) {
  if (maxTrials <= 1) return 1;
  const t = clamp01((maxTrials - trialsUsed) / (maxTrials - 1));
  return Math.pow(t, SCORING.TRIAL_CURVE);
}

function timeScore(myTimeMs, fastestTimeMs) {
  if (!myTimeMs || !fastestTimeMs) return 1;
  return clamp01(fastestTimeMs / myTimeMs);
}

function rowValue(row, length) {
  let v = 0;
  for (const c of row) {
    if (c === 'green') v += SCORING.GREEN_VALUE;
    else if (c === 'yellow') v += SCORING.YELLOW_VALUE;
  }
  return v / (length * SCORING.GREEN_VALUE); // 1.0 = every tile green
}

// Average tile quality of the guesses made before the solving one.
function tileScoreBeforeSolve(colorRows, length) {
  const prior = colorRows.slice(0, -1);
  if (prior.length === 0) return 1;
  const sum = prior.reduce((acc, row) => acc + rowValue(row, length), 0);
  return clamp01(sum / prior.length);
}

function bestRowValue(colorRows, length) {
  return colorRows.reduce((best, row) => Math.max(best, rowValue(row, length)), 0);
}

function roundTo(n) {
  return Math.round(n / SCORING.ROUND_TO) * SCORING.ROUND_TO;
}

/**
 * @param {Object} p
 * @param {number} p.length          word length
 * @param {boolean} p.solved
 * @param {number} p.trialsUsed      1-indexed trial the player solved on
 * @param {number} p.myTimeMs        how long this player took
 * @param {number} p.fastestTimeMs   the fastest SOLVER's time this round (null if nobody solved)
 * @param {string[][]} p.colorRows   every guess the player made: arrays of 'green'|'yellow'|'gray'
 * @returns {number} the rounded score for this word
 */
function calculateScore({ length, solved, trialsUsed, myTimeMs, fastestTimeMs, colorRows }) {
  const rows = colorRows || [];

  if (!solved) {
    if (rows.length === 0) return 0; // never tried -> nothing
    return roundTo(SCORING.FAIL_BASE + SCORING.FAIL_TILE_MAX * bestRowValue(rows, length));
  }

  const S = SCORING;
  const share =
    S.SOLVED_FLOOR +
    S.TRIAL_WEIGHT * trialScore(trialsUsed) +
    S.TIME_WEIGHT * timeScore(myTimeMs, fastestTimeMs) +
    S.TILE_WEIGHT * tileScoreBeforeSolve(rows, length);

  return roundTo(baseValue(length) * share);
}

module.exports = {
  calculateScore,
  baseValue,
  trialScore,
  timeScore,
  tileScoreBeforeSolve,
  bestRowValue,
};
