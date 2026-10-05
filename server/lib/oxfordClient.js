// Thin wrapper around the Oxford Dictionaries API (v2).
// Docs: https://developer.oxforddictionaries.com/
//
// IMPORTANT (be upfront about this): the Oxford API is a LOOKUP/definition
// API, not a "give me a random word" generator - there's no endpoint that
// returns "a random real English word of length N". So the integration
// here uses Oxford the way it's actually designed to be used: as a
// validator. The server keeps its own local candidate word lists (see
// server/data/words_*.json) and asks Oxford "is this a real headword?"
// to filter out anything too obscure/not a standard dictionary entry.
// Validated words are cached to disk so you only pay the API-call cost
// once per word, ever - not on every round.
//
// If OXFORD_APP_ID / OXFORD_APP_KEY aren't set, this module is simply
// never called and wordProvider.js falls back to the local lists as-is.

const https = require('https');
const { OXFORD_APP_ID, OXFORD_APP_KEY } = require('../config');

const BASE_HOST = 'od-api.oxforddictionaries.com';
const BASE_PATH = '/api/v2/entries/en-gb/';

function checkWordExists(word) {
  return new Promise((resolve) => {
    const options = {
      hostname: BASE_HOST,
      path: BASE_PATH + encodeURIComponent(word.toLowerCase()),
      method: 'GET',
      headers: {
        app_id: OXFORD_APP_ID,
        app_key: OXFORD_APP_KEY,
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      // 200 = found, 404 = not a recognized headword, anything else = treat as "unknown, allow it"
      // (we never want a flaky API response to brick word selection)
      if (res.statusCode === 200) {
        res.resume();
        resolve(true);
      } else if (res.statusCode === 404) {
        res.resume();
        resolve(false);
      } else {
        res.resume();
        resolve(null); // unknown - caller decides how to treat this
      }
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

module.exports = { checkWordExists };
