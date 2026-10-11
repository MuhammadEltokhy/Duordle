/* =============================================================================
   Duordle game server  (Express + Socket.IO, everything in memory)

   WHAT CHANGED IN THIS VERSION (so you can find it quickly in the code below)
   -----------------------------------------------------------------------------
   1. "Not in word list": every guess is checked with wordProvider.isValidWord()
      BEFORE it uses up a trial. Oxford API first (when keys are set), bundled
      dictionary as the fallback. Rejected guesses get ack {ok:false, code:'NOT_IN_WORD_LIST'}.
   2. Round time limit chosen by the host (settings.timeLimitSec: 0 = no countdown,
      otherwise 60..300). The countdown shrinks every time a player finishes
      (see lib/roundTimer.js) and the server emits `timerUpdate` to everyone.
   3. If the second-to-last player SOLVES the word, the last player's clock stops too
      and the round ends right away (`forceFinishRemaining`). When the countdown runs out,
      everyone still playing is stopped and the round ends (`onTimeout`).
   4. New scoring (lib/scoring.js): hundreds of points for a solved word, ~20-60 for a
      failed one, both influenced by green/yellow tiles; speed counts too.
   5. Leaving: new `leaveLobby` event (instant) + disconnect with a grace period.
      Everyone gets `playerLeft` ("Player x has left the lobby"). If the host leaves, the
      earliest remaining player becomes host (`hostChanged`); if nobody is left the lobby
      is shut down and its ID can never be used again (the ID ledger is permanent).
   6. Players are identified by USERNAME (unique inside a lobby) instead of socket id, so
      a page refresh / navigation can never desync boards, rankings or stopwatches.
      Socket ids are no longer sent to other players at all.
   7. Round start / rejoin snapshots carry the server clock (`serverNow`), the round start time
      and the deadline so every browser can run an accurate stopwatch and countdown.
   8. Round results now include previous rank / previous total per player (for the
      rank-change and count-up animations) and the winner(s) after the last round.
   9. Hardening: every socket handler goes through handle() which tolerates garbage
      payloads and can never crash the server; a player can only act inside a lobby they
      belong to; one guess at a time per player (no double-submits while a word is being
      checked); static files are served with `Cache-Control: no-cache` so edits show up
      on a normal refresh.
   ============================================================================= */
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const cfg = require('./config');
const { securityHeaders, generalLimiter } = require('./middleware/security');
const validate = require('./lib/validate');
const lobbyManager = require('./lib/lobbyManager');
const wordProvider = require('./lib/wordProvider');
const { computeColors, isSolved } = require('./lib/wordleColors');
const { calculateScore } = require('./lib/scoring');
const { reduceRemaining } = require('./lib/roundTimer');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(securityHeaders());
app.use(generalLimiter);
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    // Always revalidate, so a normal refresh picks up edited html/css/js.
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, '..', 'robots.txt')));
app.get('/llms.txt', (req, res) => res.sendFile(path.join(__dirname, '..', 'llms.txt')));

// Custom 404 - must stay AFTER the static middleware
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// -----------------------------------------------------------------------------
// Bot protection: limit lobby creation per socket
// -----------------------------------------------------------------------------
const creationTimestamps = new Map(); // socketId -> number[]
const CREATE_LIMIT = 8;
const CREATE_WINDOW_MS = 10 * 60 * 1000;

function allowedToCreate(socketId) {
  const now = Date.now();
  const list = (creationTimestamps.get(socketId) || []).filter((t) => now - t < CREATE_WINDOW_MS);
  if (list.length >= CREATE_LIMIT) return false;
  list.push(now);
  creationTimestamps.set(socketId, list);
  return true;
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
// Only what the UI needs - no socket ids, no internal state.
function publicPlayer(p) {
  return { username: p.username, isHost: p.isHost, connected: p.connected };
}

function publicLobbyState(lobby) {
  return {
    id: lobby.id,
    settings: lobby.settings,
    players: lobby.players.map(publicPlayer),
    state: lobby.state,
    currentRoundIndex: lobby.currentRoundIndex,
  };
}

function emitLobbyUpdate(lobby) {
  io.to(lobby.id).emit('lobbyUpdate', publicLobbyState(lobby));
}

const findByUsername = (lobby, username) => lobby.players.find((p) => p.username === username);
const findBySocket = (lobby, socket) => lobby.players.find((p) => p.socketId === socket.id);

function unfinishedCount(round) {
  let n = 0;
  for (const d of round.data.values()) if (d.finishTimeMs === null) n += 1;
  return n;
}

function fastestSolvedTime(round) {
  let fastest = null;
  for (const d of round.data.values()) {
    if (d.solved && d.finishTimeMs !== null && (fastest === null || d.finishTimeMs < fastest)) {
      fastest = d.finishTimeMs;
    }
  }
  return fastest;
}

// Wraps every socket handler: tolerates a missing/garbage payload or ack and turns any
// exception into an error reply instead of crashing the whole server.
function handle(socket, event, fn) {
  socket.on(event, (payload, ack) => {
    if (typeof payload === 'function') { ack = payload; payload = {}; }
    if (typeof ack !== 'function') ack = () => {};
    if (payload === null || typeof payload !== 'object') payload = {};
    Promise.resolve()
      .then(() => fn(payload, ack))
      .catch((err) => {
        console.error(`[socket:${event}]`, err);
        ack({ ok: false, error: 'Server error.' });
      });
  });
}

// The lobby a message is addressed to + the player behind this socket (or an error text).
function context(socket, payload) {
  if (!socket.data.username) return { error: 'Register a username first.' };
  const lobby = lobbyManager.getLobby(payload.lobbyId);
  if (!lobby) return { error: 'Lobby not found.' };
  const player = findBySocket(lobby, socket);
  if (!player) return { error: 'You are not in this lobby.' };
  return { lobby, player };
}

// -----------------------------------------------------------------------------
// Round snapshot - lets a freshly loaded game page catch up (every page change in
// the browser opens a NEW socket, so the page always asks for this when it loads)
// -----------------------------------------------------------------------------
function roundSnapshot(lobby, username) {
  const round = lobby.round;
  if (!round || lobby.state === 'lobby') return null;
  const mine = round.data.get(username);
  const opponents = [];
  for (const [name, d] of round.data) {
    if (name === username) continue;
    opponents.push({
      username: name,
      rows: d.guesses.map((g) => g.colors), // colors only - never the letters
      finished: d.finishTimeMs !== null,
      solved: d.finishTimeMs !== null ? d.solved : null,
      finishTimeMs: d.finishTimeMs,
    });
  }
  return {
    roundIndex: round.index,
    totalRounds: lobby.settings.rounds,
    wordLength: lobby.settings.wordLength,
    maxTrials: round.maxTrials,
    startTime: round.startTime,
    serverNow: Date.now(),
    limitMs: round.limitMs,
    deadline: round.deadline,
    ended: round.ended,
    participating: Boolean(mine),
    myGuesses: mine ? mine.guesses.map((g) => ({ word: g.word, colors: g.colors })) : [],
    myFinished: mine ? mine.finishTimeMs !== null : false,
    myFinishTimeMs: mine ? mine.finishTimeMs : null,
    mySolved: mine && mine.finishTimeMs !== null ? mine.solved : null,
    opponents,
  };
}

// -----------------------------------------------------------------------------
// Rounds
// -----------------------------------------------------------------------------
async function startRound(lobby) {
  if (lobby.starting) return; // double click / timer + click protection
  lobby.starting = true;
  try {
    clearTimeout(lobby.nextRoundTimer);
    lobby.state = 'in_round';

    const word = await wordProvider.getRandomWord(
      lobby.settings.wordLength,
      Array.from(lobby.usedWordsThisGame) // a word never repeats inside one game
    );
    if (lobbyManager.getLobby(lobby.id) !== lobby) return; // lobby was closed meanwhile
    lobby.usedWordsThisGame.add(word);

    const startTime = Date.now();
    const limitMs = lobby.settings.timeLimitSec * 1000; // 0 = no countdown
    const round = {
      index: lobby.currentRoundIndex,
      word,
      maxTrials: cfg.MAX_TRIALS,
      startTime,
      limitMs,
      deadline: limitMs > 0 ? startTime + limitMs : null,
      initialPlayers: lobby.players.length, // a 2-player lobby never shrinks its countdown
      timerHandle: null,
      ended: false,
      // username -> { guesses:[{word,colors}], solved, trialsUsed, finishTimeMs, busy }
      data: new Map(),
    };
    for (const p of lobby.players) {
      round.data.set(p.username, { guesses: [], solved: false, trialsUsed: 0, finishTimeMs: null, busy: false });
    }
    lobby.round = round;
    lobby.lastResult = null;
    scheduleDeadline(lobby);

    io.to(lobby.id).emit('roundStart', {
      roundIndex: round.index,
      totalRounds: lobby.settings.rounds,
      wordLength: lobby.settings.wordLength,
      maxTrials: round.maxTrials,
      startTime: round.startTime,
      serverNow: Date.now(),
      limitMs: round.limitMs,
      deadline: round.deadline,
      players: lobby.players.map((p) => p.username),
    });
  } finally {
    lobby.starting = false;
  }
}

// ---- countdown ----
function scheduleDeadline(lobby) {
  const round = lobby.round;
  clearTimeout(round.timerHandle);
  if (!round.deadline) return; // no time limit
  round.timerHandle = setTimeout(() => onTimeout(lobby, round), Math.max(0, round.deadline - Date.now()));
}

function onTimeout(lobby, round) {
  if (lobby.round !== round || round.ended) return;
  forceFinishRemaining(lobby, 'timeout'); // everyone still playing is stopped as "not solved"
  endRound(lobby, 'timeout');
}

function emitTimerUpdate(lobby, reduced) {
  const round = lobby.round;
  io.to(lobby.id).emit('timerUpdate', {
    serverNow: Date.now(),
    deadline: round.deadline,
    remainingMs: round.deadline ? Math.max(0, round.deadline - Date.now()) : null,
    limitMs: round.limitMs,
    reduced,
  });
}

// ---- finishing ----
function finishPlayer(lobby, username, solved, { forced = false, reason = null } = {}) {
  const round = lobby.round;
  const d = round.data.get(username);
  d.solved = solved;
  d.finishTimeMs = Date.now() - round.startTime;
  io.to(lobby.id).emit('playerFinished', {
    username,
    finishTimeMs: d.finishTimeMs,
    solved,
    trialsUsed: d.trialsUsed,
    forced,
    reason,
  });
}

// Everyone still playing is stopped as "did not solve" (their clocks stop at this moment).
function forceFinishRemaining(lobby, reason) {
  for (const [username, d] of lobby.round.data) {
    if (d.finishTimeMs === null) finishPlayer(lobby, username, false, { forced: true, reason });
  }
}

// Called after a player finished on their own (solved it, or used all their trials).
function afterNaturalFinish(lobby, solved) {
  const round = lobby.round;
  const unfinished = unfinishedCount(round);

  if (unfinished === 0) return endRound(lobby, 'all-finished');

  // The second-to-last player SOLVED it: the last player's clock stops too, round ends.
  if (solved && unfinished === 1 && round.data.size >= 2) {
    forceFinishRemaining(lobby, 'last-player');
    return endRound(lobby, 'last-player');
  }

  // Others are still playing: shrink the countdown (see lib/roundTimer.js).
  if (round.deadline) {
    const remaining = round.deadline - Date.now();
    const next = reduceRemaining({
      remainingMs: remaining,
      unfinishedAfter: unfinished,
      initialPlayers: round.initialPlayers,
    });
    if (next < remaining) {
      round.deadline = Date.now() + next;
      scheduleDeadline(lobby);
      emitTimerUpdate(lobby, true);
    }
  }
}

// ---- scoring + ranking ----
function endRound(lobby, reason) {
  const round = lobby.round;
  if (!round || round.ended) return;
  round.ended = true;
  clearTimeout(round.timerHandle);

  io.to(lobby.id).emit('roundEnding', { reason });

  const fastest = fastestSolvedTime(round);

  // Ranking BEFORE this round (ties keep join order) - used for the rank-change animation.
  const before = lobby.players.slice().sort((a, b) => b.score - a.score);
  const prevRank = new Map(before.map((p, i) => [p.username, i + 1]));

  const perPlayer = new Map();
  for (const player of lobby.players) {
    const d = round.data.get(player.username);
    const roundScore = d
      ? calculateScore({
          length: lobby.settings.wordLength,
          solved: d.solved,
          trialsUsed: d.trialsUsed,
          myTimeMs: d.finishTimeMs,
          fastestTimeMs: fastest,
          colorRows: d.guesses.map((g) => g.colors),
        })
      : 0;
    const prevTotal = player.score;
    player.score += roundScore;
    player.roundScores.push(roundScore);
    perPlayer.set(player.username, { roundScore, prevTotal, d });
  }

  // Sorting `before` (not lobby.players) keeps ties in their previous order.
  const after = before.slice().sort((a, b) => b.score - a.score);
  const ranking = after.map((p, i) => {
    const info = perPlayer.get(p.username);
    return {
      username: p.username,
      rank: i + 1,
      prevRank: prevRank.get(p.username),
      roundScore: info.roundScore,
      prevTotal: info.prevTotal,
      totalScore: p.score,
      solved: info.d ? info.d.solved : false,
      trialsUsed: info.d ? info.d.trialsUsed : 0,
      timeMs: info.d ? info.d.finishTimeMs : null,
    };
  });

  const isLastRound = round.index + 1 >= lobby.settings.rounds;
  lobby.state = isLastRound ? 'game_end' : 'round_result';
  lobby.currentRoundIndex = round.index + 1;

  const topScore = ranking.length ? ranking[0].totalScore : 0;
  lobby.lastResult = {
    roundIndex: round.index,
    totalRounds: lobby.settings.rounds,
    word: round.word,
    reason,
    isLastRound,
    ranking,
    winners: isLastRound ? ranking.filter((r) => r.totalScore === topScore).map((r) => ({ username: r.username, totalScore: r.totalScore })) : [],
    nextRoundInMs: isLastRound ? null : cfg.ROUND_RESULT_DELAY_MS,
    serverNow: Date.now(),
  };
  io.to(lobby.id).emit('roundResult', lobby.lastResult);

  if (!isLastRound) {
    lobby.nextRoundTimer = setTimeout(() => {
      const current = lobbyManager.getLobby(lobby.id);
      if (current && current.state === 'round_result') startRound(current);
    }, cfg.ROUND_RESULT_DELAY_MS);
  }
}

// -----------------------------------------------------------------------------
// Leaving / disconnecting
// -----------------------------------------------------------------------------
function shutdownLobby(lobby) {
  // The lobby is gone for good. Its ID stays in the used-ID ledger forever (see
  // lobbyManager), so it can never be handed to another lobby.
  clearTimeout(lobby.nextRoundTimer);
  if (lobby.round) clearTimeout(lobby.round.timerHandle);
  for (const p of lobby.players) clearTimeout(p.removalTimer);
  lobbyManager.deleteLobby(lobby.id);
}

function removePlayer(lobby, username) {
  const idx = lobby.players.findIndex((p) => p.username === username);
  if (idx === -1) return;
  const [removed] = lobby.players.splice(idx, 1);
  clearTimeout(removed.removalTimer);

  io.to(lobby.id).emit('playerLeft', { username });

  if (lobby.players.length === 0) return shutdownLobby(lobby);

  if (removed.isHost) {
    // Earliest player still in the lobby (players are kept in join order); prefer one who is online.
    const next = lobby.players.find((p) => p.connected) || lobby.players[0];
    next.isHost = true;
    io.to(lobby.id).emit('hostChanged', { username: next.username });
  }

  // A player who leaves mid-round is dropped from that round.
  if (lobby.state === 'in_round' && lobby.round && !lobby.round.ended) {
    lobby.round.data.delete(username);
    if (lobby.round.data.size === 0 || unfinishedCount(lobby.round) === 0) endRound(lobby, 'all-finished');
  }

  emitLobbyUpdate(lobby);
}

// -----------------------------------------------------------------------------
// Socket handlers
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.username = null;
  socket.data.lobbyId = null;

  handle(socket, 'register', ({ username }, ack) => {
    if (!validate.validUsername(username)) return ack({ ok: false, error: 'Invalid username.' });
    socket.data.username = validate.sanitizeUsername(username);
    ack({ ok: true });
  });

  handle(socket, 'createLobby', (settings, ack) => {
    if (!socket.data.username) return ack({ ok: false, error: 'Register a username first.' });
    if (!validate.validLobbySettings(settings)) return ack({ ok: false, error: 'Invalid lobby settings.' });
    if (!allowedToCreate(socket.id)) return ack({ ok: false, error: 'Too many lobbies created - slow down.' });

    const id = lobbyManager.generateLobbyId(); // brand-new ID, never used before, ever
    const lobby = {
      id,
      settings: {
        isPublic: settings.isPublic,
        wordLength: settings.wordLength,
        maxPlayers: settings.maxPlayers,
        rounds: settings.rounds,
        timeLimitSec: settings.timeLimitSec,
      },
      players: [
        { socketId: socket.id, username: socket.data.username, isHost: true, connected: true, score: 0, roundScores: [], removalTimer: null },
      ],
      state: 'lobby',
      currentRoundIndex: 0,
      usedWordsThisGame: new Set(),
      round: null,
      lastResult: null,
      starting: false,
      nextRoundTimer: null,
    };
    lobbyManager.createLobby(lobby);
    socket.data.lobbyId = id;
    socket.join(id);
    ack({ ok: true, lobbyId: id });
    emitLobbyUpdate(lobby);
  });

  handle(socket, 'joinLobby', ({ lobbyId }, ack) => {
    if (!socket.data.username) return ack({ ok: false, error: 'Register a username first.' });
    if (!validate.validLobbyId(lobbyId)) return ack({ ok: false, error: 'There’s no lobby with this ID' });

    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack({ ok: false, error: 'There’s no lobby with this ID' });
    if (lobby.state !== 'lobby') return ack({ ok: false, error: 'That game has already started.' });
    if (lobby.players.length >= lobby.settings.maxPlayers) return ack({ ok: false, error: 'The lobby is full' });
    if (findByUsername(lobby, socket.data.username)) {
      return ack({ ok: false, error: 'That username is already taken in this lobby - pick another.' });
    }

    lobby.players.push({ socketId: socket.id, username: socket.data.username, isHost: false, connected: true, score: 0, roundScores: [], removalTimer: null });
    socket.data.lobbyId = lobbyId;
    socket.join(lobbyId);
    ack({ ok: true, lobbyId });
    emitLobbyUpdate(lobby);
  });

  handle(socket, 'getLobbyState', ({ lobbyId }, ack) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack({ ok: false, error: 'Lobby not found.' });
    ack({ ok: true, state: publicLobbyState(lobby) });
  });

  // Every lobby-bound page calls this right after `register` (page navigation = new socket).
  // The player's seat is found by username and re-pointed at the new socket.
  handle(socket, 'rejoinLobby', ({ lobbyId }, ack) => {
    if (!socket.data.username) return ack({ ok: false, error: 'Register a username first.' });
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack({ ok: false, error: 'Lobby not found.' });

    const player = findByUsername(lobby, socket.data.username);
    if (!player) return ack({ ok: false, error: 'You are not a member of this lobby.' });

    clearTimeout(player.removalTimer);
    player.removalTimer = null;
    player.socketId = socket.id;
    player.connected = true;

    socket.data.lobbyId = lobbyId;
    socket.join(lobbyId);
    ack({
      ok: true,
      state: publicLobbyState(lobby),
      round: roundSnapshot(lobby, player.username),
      result: lobby.state === 'round_result' || lobby.state === 'game_end' ? lobby.lastResult : null,
      serverNow: Date.now(),
    });
    emitLobbyUpdate(lobby);
  });

  handle(socket, 'leaveLobby', (payload, ack) => {
    const ctx = context(socket, payload);
    if (ctx.error) return ack({ ok: false, error: ctx.error });
    socket.leave(ctx.lobby.id);
    socket.data.lobbyId = null;
    removePlayer(ctx.lobby, ctx.player.username);
    ack({ ok: true });
  });

  handle(socket, 'listPublicLobbies', (filters, ack) => {
    ack({ ok: true, lobbies: lobbyManager.listPublicLobbies(filters || {}) });
  });

  handle(socket, 'startGame', (payload, ack) => {
    const ctx = context(socket, payload);
    if (ctx.error) return ack({ ok: false, error: ctx.error });
    const { lobby, player } = ctx;
    if (!player.isHost) return ack({ ok: false, error: 'Only the host can start the game.' });
    if (lobby.state !== 'lobby') return ack({ ok: false, error: 'The game already started.' });
    if (lobby.players.length < cfg.MIN_PLAYERS) return ack({ ok: false, error: 'Need at least 2 players.' });
    ack({ ok: true });
    return startRound(lobby);
  });

  handle(socket, 'nextRound', (payload, ack) => {
    const ctx = context(socket, payload);
    if (ctx.error) return ack({ ok: false, error: ctx.error });
    const { lobby, player } = ctx;
    if (!player.isHost) return ack({ ok: false, error: 'Only the host can do that.' });
    if (lobby.state !== 'round_result') return ack({ ok: false, error: 'Not between rounds right now.' });
    ack({ ok: true });
    return startRound(lobby);
  });

  handle(socket, 'playAgain', (payload, ack) => {
    const ctx = context(socket, payload);
    if (ctx.error) return ack({ ok: false, error: ctx.error });
    const { lobby, player } = ctx;
    if (!player.isHost) return ack({ ok: false, error: 'Only the host can do that.' });
    if (lobby.state !== 'game_end') return ack({ ok: false, error: 'Game is not over yet.' });

    lobby.currentRoundIndex = 0;
    lobby.usedWordsThisGame = new Set(); // words may come back in a NEW game
    lobby.round = null;
    lobby.lastResult = null;
    for (const p of lobby.players) { p.score = 0; p.roundScores = []; }
    lobby.state = 'lobby';
    ack({ ok: true });
    emitLobbyUpdate(lobby);
  });

  handle(socket, 'submitGuess', async ({ lobbyId, guess }, ack) => {
    const ctx = context(socket, { lobbyId });
    if (ctx.error) return ack({ ok: false, error: ctx.error });
    const { lobby, player } = ctx;
    const round = lobby.round;

    if (lobby.state !== 'in_round' || !round || round.ended) return ack({ ok: false, error: 'No active round.' });
    if (!validate.validGuess(guess, lobby.settings.wordLength)) return ack({ ok: false, error: 'Invalid guess.' });

    const d = round.data.get(player.username);
    if (!d) return ack({ ok: false, error: 'You are not in this round.' });
    if (d.finishTimeMs !== null) return ack({ ok: false, error: 'You already finished this round.' });
    if (d.trialsUsed >= round.maxTrials) return ack({ ok: false, error: 'No trials left.' });
    if (d.busy) return ack({ ok: false, error: 'One guess at a time.' });

    const word = guess.trim().toUpperCase();

    // --- "Not in word list" check (Oxford API / bundled dictionary). Does NOT use a trial. ---
    d.busy = true;
    let real;
    try {
      real = word === round.word || (await wordProvider.isValidWord(word));
    } finally {
      d.busy = false;
    }
    // The round may have ended (time ran out) or the player been stopped while we were checking.
    if (lobby.round !== round || round.ended || d.finishTimeMs !== null) {
      return ack({ ok: false, error: 'The round has ended.' });
    }
    if (!real) return ack({ ok: false, code: 'NOT_IN_WORD_LIST', error: 'Not in word list' });

    // Colors are always computed here - a client can never claim its own result.
    const colors = computeColors(word, round.word);
    d.guesses.push({ word, colors });
    d.trialsUsed += 1;
    const solved = isSolved(colors);

    // Everyone else only ever gets the colors, never the letters.
    socket.to(lobby.id).emit('opponentGuess', { username: player.username, trialIndex: d.trialsUsed, colors });

    const outOfTrials = !solved && d.trialsUsed >= round.maxTrials;
    ack({ ok: true, colors, solved, trialIndex: d.trialsUsed, outOfTrials });

    if (solved || outOfTrials) {
      finishPlayer(lobby, player.username, solved);
      afterNaturalFinish(lobby, solved);
    }
  });

  // A closed tab / lost connection. The seat is held briefly (normal page-to-page navigation
  // also closes the socket for a moment); if the player doesn't come back they have left.
  socket.on('disconnect', () => {
    const lobby = lobbyManager.getLobby(socket.data.lobbyId);
    if (!lobby) return;
    const player = findBySocket(lobby, socket); // not found = they already re-joined on a newer socket
    if (!player) return;

    player.connected = false;
    emitLobbyUpdate(lobby);
    clearTimeout(player.removalTimer);
    player.removalTimer = setTimeout(() => {
      const current = lobbyManager.getLobby(lobby.id);
      if (!current) return;
      const still = findByUsername(current, player.username);
      if (still && !still.connected) removePlayer(current, player.username);
    }, cfg.REMOVAL_GRACE_MS);
  });
});

server.listen(cfg.PORT, () => {
  console.log(`Duordle server listening on http://localhost:${cfg.PORT}`);
  if (cfg.OXFORD_ENABLED) {
    console.log(`Oxford API: ON (${cfg.OXFORD_CHECK_ALL ? 'checking every new guess' : 'checking words missing from the bundled dictionary'}).`);
  } else {
    console.log('Oxford API keys not set - using the bundled dictionary for "Not in word list" (this is fine, the game fully works).');
  }
});
