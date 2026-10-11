// Two jobs:
//   1. getRandomWord(length, exclude)  - picks the secret word for a round.
//   2. isValidWord(word)               - "Not in word list" check for every guess.
//
// Word sources:
//   server/data/words_N.json        candidate ANSWERS (a few hundred per length)
//   server/data/valid_words_N.json  every ACCEPTABLE GUESS we know (~52k words, 3-10 letters)
//   Oxford Dictionaries API         asked when configured (see config.js: OXFORD_*)
//   server/data/oxford_cache.json   every Oxford answer is remembered here forever, so a word
//                                   is only ever looked up once (saves your API quota).
const fs = require('fs');
const path = require('path');
const { OXFORD_ENABLED, OXFORD_CHECK_ALL } = require('../config');
const oxford = require('./oxfordClient');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Local dictionaries
// ---------------------------------------------------------------------------
const validSets = {};   // length -> Set of UPPERCASE words
const answerPools = {}; // length -> array of UPPERCASE words that are safe to use as answers

function loadValidSet(length) {
  if (validSets[length]) return validSets[length];
  const file = path.join(DATA_DIR, `valid_words_${length}.json`);
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[words] could not read ${file}: ${err.message}`);
  }
  validSets[length] = new Set(list.map((w) => String(w).toUpperCase()));
  return validSets[length];
}

// Answers must also be in the valid list, which silently drops entries such as
// Roman numerals (XXIV) or abbreviations (ASST) that older answer files contained.
function loadAnswerPool(length) {
  if (answerPools[length]) return answerPools[length];
  const file = path.join(DATA_DIR, `words_${length}.json`);
  const valid = loadValidSet(length);
  const list = JSON.parse(fs.readFileSync(file, 'utf8')).map((w) => String(w).toUpperCase());
  const filtered = list.filter((w) => valid.size === 0 || valid.has(w));
  answerPools[length] = filtered.length > 0 ? filtered : list;
  return answerPools[length];
}

// ---------------------------------------------------------------------------
// Oxford answers cache (persisted so restarts don't re-spend API calls)
// ---------------------------------------------------------------------------
const CACHE_FILE = path.join(DATA_DIR, 'oxford_cache.json');
const oxfordCache = new Map(); // WORD -> true | false
let cacheDirty = false;

(function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const w of raw.valid || []) oxfordCache.set(w, true);
    for (const w of raw.invalid || []) oxfordCache.set(w, false);
  } catch (err) {
    console.warn(`[words] could not read Oxford cache: ${err.message}`);
  }
})();

function saveCacheSoon() {
  cacheDirty = true;
  setTimeout(() => {
    if (!cacheDirty) return;
    cacheDirty = false;
    const valid = [];
    const invalid = [];
    for (const [w, ok] of oxfordCache) (ok ? valid : invalid).push(w);
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ valid, invalid }));
    } catch (err) {
      console.warn(`[words] could not write Oxford cache (read-only disk?): ${err.message}`);
    }
  }, 1500);
}

// ---------------------------------------------------------------------------
// Guess validation
// ---------------------------------------------------------------------------
/**
 * Is `word` a real English word?
 *   1. cached Oxford verdict, if we have one
 *   2. bundled dictionary says yes -> accepted at once (unless OXFORD_CHECK_ALL=true)
 *   3. Oxford is asked (when keys are configured):
 *        found -> valid, not found -> invalid, error/timeout -> fall back to the bundled dictionary
 *   4. no Oxford keys -> the bundled dictionary alone decides
 * @returns {Promise<boolean>}
 */
async function isValidWord(word) {
  if (typeof word !== 'string' || !/^[A-Za-z]{3,10}$/.test(word.trim())) return false;
  const W = word.trim().toUpperCase();

  const inLocal = loadValidSet(W.length).has(W);

  if (oxfordCache.has(W)) return oxfordCache.get(W);
  if (inLocal && !OXFORD_CHECK_ALL) return true;
  if (!OXFORD_ENABLED) return inLocal;

  const verdict = await oxford.checkWordExists(W); // true | false | null (error/timeout/quota)
  if (verdict === null) return inLocal;            // never let a flaky API break the game
  oxfordCache.set(W, verdict);
  saveCacheSoon();
  return verdict;
}

// ---------------------------------------------------------------------------
// Picking the secret word
// ---------------------------------------------------------------------------
async function getRandomWord(length, excludeWords = []) {
  const exclude = new Set(excludeWords.map((w) => w.toUpperCase()));
  const pool = loadAnswerPool(length);

  let available = pool.filter((w) => !exclude.has(w));
  if (available.length === 0) available = pool; // safety net: never return nothing

  // With Oxford configured, make sure the chosen answer is a real headword; try a few
  // candidates, and fall back to the first pick if Oxford can't be reached.
  if (OXFORD_ENABLED) {
    const tried = new Set();
    for (let i = 0; i < 5 && tried.size < available.length; i++) {
      const candidate = available[Math.floor(Math.random() * available.length)];
      if (tried.has(candidate)) continue;
      tried.add(candidate);
      const verdict = await oxford.checkWordExists(candidate);
      if (verdict === true) {
        oxfordCache.set(candidate, true);
        saveCacheSoon();
        return candidate;
      }
      if (verdict === false) {
        oxfordCache.set(candidate, false);
        saveCacheSoon();
      }
      if (verdict === null) break; // Oxford unreachable - stop asking
    }
  }
  return available[Math.floor(Math.random() * available.length)];
}

module.exports = { getRandomWord, isValidWord };
