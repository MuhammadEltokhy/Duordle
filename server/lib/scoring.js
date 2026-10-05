// Pure scoring functions - no difficulty tiers (removed by design decision).
// Score depends only on: word length, which trial you solved on, how fast
// relative to the round's first finisher, and how many green/yellow tiles
// you accumulated along the way. Solving at all dominates everything else.
//
// Priority order (by design): solved >>> trial used > relative time >> hints
const { MAX_TRIALS } = require('../config');

function baseValue(length) {
  return 15 * Math.pow(length, 1.2);
}

function trialFactor(trialsUsed, maxTrials = MAX_TRIALS) {
  const progress = (maxTrials - trialsUsed + 1) / maxTrials;
  return 0.4 + 0.6 * Math.pow(progress, 1.5);
}

function timeFactor(myTimeMs, fastestTimeMs) {
  if (!fastestTimeMs || !myTimeMs) return 0.75;
  const ratio = Math.min(1, fastestTimeMs / myTimeMs);
  return 0.75 + 0.25 * ratio;
}

function hintFactor(hintRatio) {
  return 1 + 0.1 * Math.max(0, Math.min(1, hintRatio));
}

// hintRatio helper: average, over every guess made, of (green+yellow)/length
function computeHintRatio(guessColorRows, length) {
  if (!guessColorRows || guessColorRows.length === 0) return 0;
  const ratios = guessColorRows.map((row) => {
    const hits = row.filter((c) => c === 'green' || c === 'yellow').length;
    return hits / length;
  });
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function bestProgressRatio(guessColorRows, length) {
  if (!guessColorRows || guessColorRows.length === 0) return 0;
  let best = 0;
  for (const row of guessColorRows) {
    const hits = row.filter((c) => c === 'green' || c === 'yellow').length;
    best = Math.max(best, hits / length);
  }
  return best;
}

/**
 * @param {Object} p
 * @param {number} p.length - word length
 * @param {boolean} p.solved
 * @param {number} p.trialsUsed - 1-indexed trial the player solved on (ignored if !solved)
 * @param {number} p.myTimeMs - time taken (ms) up to solving or round end
 * @param {number} p.fastestTimeMs - fastest solver's time this round (ms)
 * @param {Array<Array<string>>} p.guessColorRows - color rows ("gray"/"yellow"/"green") for every guess made
 * @returns {number} final rounded score for this word
 */
function calculateScore({ length, solved, trialsUsed, myTimeMs, fastestTimeMs, guessColorRows }) {
  const base = baseValue(length);

  let raw;
  if (solved) {
    const tf = trialFactor(trialsUsed);
    const tmf = timeFactor(myTimeMs, fastestTimeMs);
    const hf = hintFactor(computeHintRatio(guessColorRows, length));
    raw = base * tf * tmf * hf;
  } else {
    const progress = bestProgressRatio(guessColorRows, length);
    raw = base * 0.15 * progress;
  }

  return Math.round(raw / 10) * 10;
}

module.exports = {
  calculateScore,
  baseValue,
  trialFactor,
  timeFactor,
  hintFactor,
  computeHintRatio,
  bestProgressRatio,
};
