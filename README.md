# Duordle

A competitive multiplayer word-guessing game (Wordle, but you race other
people). Node.js + Express + Socket.IO backend, plain HTML/CSS/JS frontend.

## Quick start

```bash
npm install
cp .env.example .env     # optional - see "Oxford API" below
npm start
```

Then open `http://localhost:3000` in a few different browser tabs/windows
to test multiplayer locally (each tab = a different player).

## Project structure

```
server/
  index.js            Express + Socket.IO server, all game-flow logic
  config.js            Every tunable constant in one place
  lib/
    lobbyManager.js    Active lobbies + permanent lobby-ID ledger
    wordProvider.js     Random word selection (+ optional Oxford validation)
    oxfordClient.js      Oxford Dictionaries API wrapper
    scoring.js            The scoring formula (pure functions, unit-testable)
    wordleColors.js        Green/yellow/gray tile logic (duplicate-letter safe)
    validate.js              All input validation
  middleware/
    security.js               Helmet + rate limiting
  data/
    words_3.json ... words_10.json    Local curated word pools
    used_ids.json (generated)          Permanent ledger of every lobby ID ever issued
public/
  index.html, create-lobby.html, join-lobby.html, lobby.html, game.html, 404.html, privacy-policy.html
  styles/main.css, styles/game.css
  scripts/   one file per page, plus socket-client.js (shared connection helper)
```

## Changing the font

Everything reads from one CSS variable. Edit `--font-main` (and/or
`--font-ui`) at the top of `public/styles/main.css` - every page picks it
up automatically.

## The Oxford Dictionaries API (optional)

Register for free credentials at https://developer.oxforddictionaries.com/.
Oxford's API is a **lookup/definition API, not a random-word generator** -
there's no endpoint that hands you "a random real word of length 7". So
this project uses it the way it's actually meant to be used: as a
**validator**. The server keeps its own local word lists
(`server/data/words_*.json`, generated from a real English dictionary) and
asks Oxford "is this a recognized headword?" to filter out obscure
entries, caching validated words to disk so each word only ever gets
checked once, ever.

**You don't need Oxford keys for the game to work.** Leave `.env` blank
(or don't create it at all) and Duordle uses the local word lists
directly - fully playable with zero external dependencies.

If you do add keys, validation happens gradually in the background (a
few words get checked per round, not all at once), so the game is never
blocked waiting on Oxford's API.

## Game rules implemented

- 2-6 players per lobby, host-chosen word length (3-10), host-chosen
  round count (1-7), public or private visibility.
- Private lobbies get a permanent, never-repeated 4-character ID
  (`server/data/used_ids.json` grows forever and is checked on every
  generation - an ID is retired the moment it's issued, even after its
  lobby is long gone).
- No accounts - pick a username each visit.
- 6 guesses per word (classic Wordle rule), regardless of word length.
- **No difficulty system** - by design decision, score depends only on
  word length plus performance (see below).
- Other players' boards are visible as colored squares only - never
  their actual letters or guessed words.
- Once all but one player has finished a word, the round ends
  immediately for everyone, including that last player (scored on
  partial progress, since they didn't solve it).
- A word used in one round never repeats within the same game, but can
  reappear in a fresh game (`Play again` resets the used-word tracker).

## Scoring formula

Implemented exactly as designed in `server/lib/scoring.js`:

```
BaseValue = 15 * length^1.2
TrialFactor = 0.4 + 0.6 * progress^1.5        (progress: earlier trial = closer to 1.0)
TimeFactor  = 0.75 + 0.25 * (fastestTime / myTime)
HintFactor  = 1 + 0.10 * avg(green+yellow tiles / length)

solved:     score = round(BaseValue * TrialFactor * TimeFactor * HintFactor / 10) * 10
not solved: score = round(BaseValue * 0.15 * bestProgressRatio / 10) * 10
```

Solved vs. not solved dominates the score; trial timing matters more
than raw speed; hint accumulation matters least. All weights live as
plain constants in `scoring.js` if you want to rebalance them.

## Security measures in place

- **Helmet** sets security headers (CSP, no-referrer, etc.) on every response.
- **express-rate-limit** throttles HTTP requests per IP; a separate
  in-memory limiter throttles lobby creation per socket.
- **All input validated server-side** (`lib/validate.js`) - usernames,
  lobby settings, lobby IDs, and guesses are all checked before use;
  nothing from the client is trusted blindly.
- **Colors/scores are always computed server-side** - a client can never
  submit its own "I got it right" claim; the server is the single
  source of truth, which also means the secret word is never sent to
  any client's network tab until the round officially ends.
- **Usernames are escaped before rendering** (via `textContent`, never
  `innerHTML`) to prevent any script-injection through a username.
- **API keys live only in `.env`** (gitignored) and are only ever used
  server-side - they never reach the browser.
- **No database is used** in this version (lobbies are in-memory), so
  there's nothing to apply row-level security or parameterized queries
  to yet. If you later add persistence (e.g. for permanent leaderboards),
  that's the point to add RLS policies and parameterized queries - the
  codebase is structured so that would live entirely inside
  `lib/lobbyManager.js` without touching game logic elsewhere.
- Custom `404.html`, `robots.txt`, `llms.txt`, per-page unique titles and
  meta descriptions, a single `<h1>` per page, `lang="en"` on every page,
  canonical tags, breadcrumbs, and a Privacy Policy page are all in place.
- No gradients anywhere - flat NYT-style color palette throughout.
- Small JS bundle by design: no frameworks, no bundler, one plain script
  per page plus a shared connection helper.

## Known limitations (be aware before relying on these)

- **No reconnect-on-crash handling.** Page-to-page navigation (lobby ->
  game) is handled via a `rejoinLobby` mechanism that re-matches a
  returning player by username, with a 15-second grace window so
  normal navigation never drops anyone. A genuine network drop or
  closed-tab mid-round beyond that window will remove the player - full
  reconnect-with-resume is listed as a stretch goal, not implemented here.
- **In-memory state only.** Restarting the server wipes all active
  lobbies (the used-ID ledger persists to disk, lobbies themselves do
  not). Fine for a single-process hobby deployment; would need Redis or
  similar to run multiple server instances behind a load balancer.
- **Word lists are a representative sample**, not a fully hand-curated
  final list - skim `server/data/words_*.json` before shipping publicly
  and remove anything you don't want showing up as an answer.
- **No automated test suite** is included - the game flow was verified
  manually via scripted Socket.IO client simulations during development
  (lobby creation/join validation, a full round with wrong guesses only,
  and a full round with an instant correct solve), but there's no
  `npm test` here yet.
- `public/assets/social-share.png` referenced in meta tags is not
  included (no real image to generate) - add your own, or remove the
  `og:image` tag.
- Replace `your-domain-here.example` in canonical tags, `robots.txt`,
  and `llms.txt` with your actual domain before deploying.

## Deployment

Any host that supports long-lived WebSocket connections works: Render,
Railway, Fly.io, or your own VPS. Set the `PORT` environment variable if
your host requires a specific one (most inject this automatically).
GitHub Pages / Netlify / Vercel's static tier will **not** work for this
- they don't run a persistent Node process.
