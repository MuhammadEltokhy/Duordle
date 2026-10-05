// Supplies random words per length, validates against Oxford when
// configured (see oxfordClient.js), and caches validated results to
// disk so repeated server restarts don't re-spend API calls.
const fs = require('fs');
const path = require('path');
const { OXFORD_ENABLED } = require('../config');
const oxford = require('./oxfordClient');

const DATA_DIR = path.join(__dirname, '..', 'data');

const rawCache = {}; // length -> string[] (local seed list)
const validatedCache = {}; // length -> string[] (oxford-confirmed subset)

function loadRaw(length) {
  if (rawCache[length]) return rawCache[length];
  const file = path.join(DATA_DIR, `words_${length}.json`);
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  rawCache[length] = list;
  return list;
}

function validatedCachePath(length) {
  return path.join(DATA_DIR, `validated_words_${length}.json`);
}

function loadValidatedFromDisk(length) {
  if (validatedCache[length]) return validatedCache[length];
  const file = validatedCachePath(length);
  if (fs.existsSync(file)) {
    validatedCache[length] = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    validatedCache[length] = [];
  }
  return validatedCache[length];
}

function saveValidatedToDisk(length) {
  fs.writeFileSync(validatedCachePath(length), JSON.stringify(validatedCache[length]));
}

/**
 * Lazily builds up a validated pool for a given length by checking a
 * handful of not-yet-checked candidates against Oxford each call. This
 * spreads API usage out over time instead of hammering Oxford on
 * startup, and the game is always playable (via the raw fallback list)
 * even while the validated pool is still small.
 */
async function topUpValidatedPool(length, targetSize = 60, batchSize = 8) {
  const validated = loadValidatedFromDisk(length);
  if (validated.length >= targetSize) return;

  const raw = loadRaw(length);
  const alreadyChecked = new Set(validated);
  const candidates = raw.filter((w) => !alreadyChecked.has(w)).slice(0, batchSize);

  for (const word of candidates) {
    const exists = await oxford.checkWordExists(word);
    if (exists) validated.push(word);
    // null (API error/timeout) or false -> skip, don't add
  }
  saveValidatedToDisk(length);
}

/**
 * @param {number} length
 * @param {string[]} excludeWords - words already used this game session
 * @returns {Promise<string>} a random word of the given length
 */
async function getRandomWord(length, excludeWords = []) {
  const exclude = new Set(excludeWords.map((w) => w.toUpperCase()));
  let pool;

  if (OXFORD_ENABLED) {
    // Fire-and-forget: top up the validated pool a little each time,
    // without blocking this round's word pick on a slow network call.
    topUpValidatedPool(length).catch(() => {});
    const validated = loadValidatedFromDisk(length);
    pool = validated.length >= 10 ? validated : loadRaw(length); // not enough validated yet -> fall back
  } else {
    pool = loadRaw(length);
  }

  const available = pool.filter((w) => !exclude.has(w));
  const finalPool = available.length > 0 ? available : pool; // safety net: never return nothing

  const word = finalPool[Math.floor(Math.random() * finalPool.length)];
  return word.toUpperCase();
}

module.exports = { getRandomWord };
