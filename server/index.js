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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(securityHeaders());
app.use(generalLimiter);
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, '..', 'robots.txt')));
app.get('/llms.txt', (req, res) => res.sendFile(path.join(__dirname, '..', 'llms.txt')));

// Custom 404 - must stay AFTER static middleware
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

// ---------------------------------------------------------------------
// In-memory per-socket rate limiting for lobby creation (bot protection)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function publicPlayer(p) {
  // Never send anything beyond what's needed to render the UI - no
  // internal fields, no secret state (trim API responses / don't leak
  // extra data).
  return { socketId: p.socketId, username: p.username, isHost: p.isHost, connected: p.connected };
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

function findPlayer(lobby, socketId) {
  return lobby.players.find((p) => p.socketId === socketId);
}

function findPlayerByUsername(lobby, username) {
  return lobby.players.find((p) => p.username === username);
}

function usernameTaken(lobby, username) {
  return lobby.players.some((p) => p.username === username);
}

// Every page navigation (index -> create/join -> lobby -> game) opens a
// brand new Socket.IO connection in the browser, which means the
// player's socket.id changes between pages. Rather than fight that, we
// identify a returning player by username-within-this-lobby (usernames
// are kept unique per lobby) and simply re-point their player record at
// the new socket.id. This snapshot is what lets a freshly loaded page
// catch up on a round already in progress.
function roundSnapshot(lobby, socketId) {
  if (!lobby.round) return null;
  const mine = lobby.round.data.get(socketId);
  const opponents = [];
  for (const [sid, d] of lobby.round.data) {
    if (sid === socketId) continue;
    opponents.push({
      socketId: sid,
      guesses: d.guesses,
      solved: d.finishTimeMs !== null ? d.solved : null,
      finishTimeMs: d.finishTimeMs,
    });
  }
  return {
    roundIndex: lobby.currentRoundIndex,
    totalRounds: lobby.settings.rounds,
    wordLength: lobby.settings.wordLength,
    maxTrials: lobby.round.maxTrials,
    myGuesses: mine ? mine.guesses : [],
    myFinished: mine ? mine.finishTimeMs !== null : false,
    opponents,
  };
}

function isHost(lobby, socketId) {
  const player = findPlayer(lobby, socketId);
  return Boolean(player && player.isHost);
}

function emitLobbyUpdate(lobby) {
  io.to(lobby.id).emit('lobbyUpdate', publicLobbyState(lobby));
}

async function startRound(lobby) {
  lobby.state = 'in_round';
  const word = await wordProvider.getRandomWord(
    lobby.settings.wordLength,
    Array.from(lobby.usedWordsThisGame)
  );
  lobby.usedWordsThisGame.add(word);

  lobby.round = {
    word,
    maxTrials: cfg.MAX_TRIALS,
    startTime: Date.now(),
    finishedOrder: [], // socketIds, in finish order (solved or forced-ended)
    data: new Map(), // socketId -> { guesses: colorRows[], solved, trialsUsed, finishTimeMs }
  };

  for (const p of lobby.players) {
    lobby.round.data.set(p.socketId, { guesses: [], solved: false, trialsUsed: 0, finishTimeMs: null });
  }

  io.to(lobby.id).emit('roundStart', {
    roundIndex: lobby.currentRoundIndex,
    totalRounds: lobby.settings.rounds,
    wordLength: lobby.settings.wordLength,
    maxTrials: cfg.MAX_TRIALS,
  });
}

function fastestSolvedTime(lobby) {
  let fastest = null;
  for (const [, d] of lobby.round.data) {
    if (d.solved && (fastest === null || d.finishTimeMs < fastest)) {
      fastest = d.finishTimeMs;
    }
  }
  return fastest;
}

function allFinished(lobby) {
  return [...lobby.round.data.values()].every((d) => d.finishTimeMs !== null);
}

function forceFinishRemaining(lobby) {
  // "If the player before last finished and got the word right, stop the
  // clock for both them and the last remaining player" - once everyone
  // but one player is done, the last player's round ends right here,
  // scored only on their partial progress.
  const now = Date.now();
  for (const [socketId, d] of lobby.round.data) {
    if (d.finishTimeMs === null) {
      d.finishTimeMs = now - lobby.round.startTime;
      d.solved = false; // forced end - they did not solve it in time
      io.to(lobby.id).emit('playerFinished', { socketId, finishTimeMs: d.finishTimeMs, solved: false, forced: true });
    }
  }
}

function endRound(lobby) {
  const fastest = fastestSolvedTime(lobby);
  const results = [];

  for (const player of lobby.players) {
    const d = lobby.round.data.get(player.socketId);
    const roundScore = calculateScore({
      length: lobby.settings.wordLength,
      solved: d.solved,
      trialsUsed: d.trialsUsed,
      myTimeMs: d.finishTimeMs,
      fastestTimeMs: fastest,
      guessColorRows: d.guesses,
    });
    player.score = (player.score || 0) + roundScore;
    player.roundScores = player.roundScores || [];
    player.roundScores.push(roundScore);
    results.push({ socketId: player.socketId, username: player.username, roundScore, totalScore: player.score });
  }

  results.sort((a, b) => b.totalScore - a.totalScore);

  const isLastRound = lobby.currentRoundIndex + 1 >= lobby.settings.rounds;
  lobby.state = isLastRound ? 'game_end' : 'round_result';

  io.to(lobby.id).emit('roundResult', {
    word: lobby.round.word,
    ranking: results,
    isLastRound,
  });

  lobby.currentRoundIndex += 1;

  if (!isLastRound) {
    setTimeout(() => {
      // Only auto-advance if the host hasn't already manually triggered it
      // and the lobby still exists (could've been closed meanwhile).
      const current = lobbyManager.getLobby(lobby.id);
      if (current && current.state === 'round_result') startRound(current);
    }, cfg.ROUND_RESULT_DELAY_MS);
  }
}

function maybeEndRound(lobby) {
  const solvedOrFinishedCount = [...lobby.round.data.values()].filter((d) => d.finishTimeMs !== null).length;
  const total = lobby.players.length;

  if (solvedOrFinishedCount >= total - 1 && solvedOrFinishedCount < total) {
    forceFinishRemaining(lobby);
  }
  if (allFinished(lobby)) {
    endRound(lobby);
  }
}

// ---------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.username = null;

  socket.on('register', ({ username }, ack) => {
    if (!validate.validUsername(username)) {
      return ack && ack({ ok: false, error: 'Invalid username.' });
    }
    socket.data.username = validate.sanitizeUsername(username);
    ack && ack({ ok: true });
  });

  socket.on('createLobby', (settings, ack) => {
    if (!socket.data.username) return ack && ack({ ok: false, error: 'Register a username first.' });
    if (!validate.validLobbySettings(settings)) return ack && ack({ ok: false, error: 'Invalid lobby settings.' });
    if (!allowedToCreate(socket.id)) return ack && ack({ ok: false, error: 'Too many lobbies created - slow down.' });

    const id = lobbyManager.generateLobbyId();
    const lobby = {
      id,
      settings: {
        isPublic: settings.isPublic,
        wordLength: settings.wordLength,
        maxPlayers: settings.maxPlayers,
        rounds: settings.rounds,
      },
      players: [{ socketId: socket.id, username: socket.data.username, isHost: true, connected: true, score: 0, roundScores: [] }],
      state: 'lobby',
      currentRoundIndex: 0,
      usedWordsThisGame: new Set(),
      round: null,
    };
    lobbyManager.createLobby(lobby);
    socket.join(id);
    ack && ack({ ok: true, lobbyId: id });
    emitLobbyUpdate(lobby);
  });

  socket.on('joinLobby', ({ lobbyId }, ack) => {
    if (!socket.data.username) return ack && ack({ ok: false, error: 'Register a username first.' });
    if (!validate.validLobbyId(lobbyId)) return ack && ack({ ok: false, error: 'There\u2019s no lobby with this ID' });

    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack && ack({ ok: false, error: 'There\u2019s no lobby with this ID' });
    if (lobby.state !== 'lobby') return ack && ack({ ok: false, error: 'That game has already started.' });
    if (lobby.players.length >= lobby.settings.maxPlayers) return ack && ack({ ok: false, error: 'The lobby is full' });
    if (usernameTaken(lobby, socket.data.username)) {
      return ack && ack({ ok: false, error: 'That username is already taken in this lobby - pick another.' });
    }

    lobby.players.push({ socketId: socket.id, username: socket.data.username, isHost: false, connected: true, score: 0, roundScores: [] });
    socket.join(lobbyId);
    ack && ack({ ok: true, lobbyId });
    emitLobbyUpdate(lobby);
  });

  socket.on('getLobbyState', ({ lobbyId }, ack) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack && ack({ ok: false, error: 'Lobby not found.' });
    ack && ack({ ok: true, state: publicLobbyState(lobby), round: roundSnapshot(lobby, socket.id) });
  });

  // Called by every lobby-bound page right after `register`, since page
  // navigation always creates a fresh socket. Re-points this player's
  // record at the new socket.id by matching on username.
  socket.on('rejoinLobby', ({ lobbyId }, ack) => {
    if (!socket.data.username) return ack && ack({ ok: false, error: 'Register a username first.' });
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack && ack({ ok: false, error: 'Lobby not found.' });

    const player = findPlayerByUsername(lobby, socket.data.username);
    if (!player) return ack && ack({ ok: false, error: 'You are not a member of this lobby.' });

    if (player._removalTimer) {
      clearTimeout(player._removalTimer);
      player._removalTimer = null;
    }

    const oldSocketId = player.socketId;
    player.socketId = socket.id;
    player.connected = true;

    // Carry over any in-progress round data under the new socket.id too.
    if (lobby.round && lobby.round.data.has(oldSocketId)) {
      lobby.round.data.set(socket.id, lobby.round.data.get(oldSocketId));
      lobby.round.data.delete(oldSocketId);
    }

    socket.join(lobbyId);
    ack && ack({ ok: true, state: publicLobbyState(lobby), round: roundSnapshot(lobby, socket.id) });
    emitLobbyUpdate(lobby);
  });

  socket.on('listPublicLobbies', (filters, ack) => {
    ack && ack({ ok: true, lobbies: lobbyManager.listPublicLobbies(filters || {}) });
  });

  socket.on('startGame', ({ lobbyId }, ack) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack && ack({ ok: false, error: 'Lobby not found.' });
    if (!isHost(lobby, socket.id)) return ack && ack({ ok: false, error: 'Only the host can start the game.' });
    if (lobby.players.length < cfg.MIN_PLAYERS) return ack && ack({ ok: false, error: 'Need at least 2 players.' });

    ack && ack({ ok: true });
    startRound(lobby);
  });

  socket.on('nextRound', ({ lobbyId }, ack) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack && ack({ ok: false, error: 'Lobby not found.' });
    if (!isHost(lobby, socket.id)) return ack && ack({ ok: false, error: 'Only the host can do that.' });
    if (lobby.state !== 'round_result') return ack && ack({ ok: false, error: 'Not between rounds right now.' });
    ack && ack({ ok: true });
    startRound(lobby);
  });

  socket.on('playAgain', ({ lobbyId }, ack) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby) return ack && ack({ ok: false, error: 'Lobby not found.' });
    if (!isHost(lobby, socket.id)) return ack && ack({ ok: false, error: 'Only the host can do that.' });
    if (lobby.state !== 'game_end') return ack && ack({ ok: false, error: 'Game is not over yet.' });

    lobby.currentRoundIndex = 0;
    lobby.usedWordsThisGame = new Set(); // words may reappear in a new game, per spec
    for (const p of lobby.players) {
      p.score = 0;
      p.roundScores = [];
    }
    lobby.state = 'lobby';
    ack && ack({ ok: true });
    emitLobbyUpdate(lobby);
  });

  socket.on('submitGuess', ({ lobbyId, guess }, ack) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (!lobby || lobby.state !== 'in_round') return ack && ack({ ok: false, error: 'No active round.' });
    if (!validate.validGuess(guess, lobby.settings.wordLength)) return ack && ack({ ok: false, error: 'Invalid guess.' });

    const d = lobby.round.data.get(socket.id);
    if (!d) return ack && ack({ ok: false, error: 'You are not in this round.' });
    if (d.finishTimeMs !== null) return ack && ack({ ok: false, error: 'You already finished this round.' });
    if (d.trialsUsed >= lobby.round.maxTrials) return ack && ack({ ok: false, error: 'No trials left.' });

    // Server computes colors itself - never trust a client-submitted result
    // (block field tampering).
    const colors = computeColors(guess, lobby.round.word);
    d.guesses.push(colors);
    d.trialsUsed += 1;

    const solved = isSolved(colors);
    ack && ack({ ok: true, colors, solved });

    // Full detail only to the guesser themselves.
    socket.emit('ownGuessResult', { trialIndex: d.trialsUsed, colors, solved });
    // Colors only (no letters) to everyone else in the lobby.
    socket.to(lobbyId).emit('opponentGuess', { socketId: socket.id, trialIndex: d.trialsUsed, colors });

    if (solved) {
      d.solved = true;
      d.finishTimeMs = Date.now() - lobby.round.startTime;
      io.to(lobbyId).emit('playerFinished', { socketId: socket.id, finishTimeMs: d.finishTimeMs, solved: true });
    } else if (d.trialsUsed >= lobby.round.maxTrials) {
      d.finishTimeMs = Date.now() - lobby.round.startTime;
      io.to(lobbyId).emit('playerFinished', { socketId: socket.id, finishTimeMs: d.finishTimeMs, solved: false });
    }

    maybeEndRound(lobby);
  });
  const REMOVAL_GRACE_MS = 15000;

  socket.on('disconnect', () => {
    for (const lobby of lobbyManager.lobbies.values()) {
      const player = lobby.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      player.connected = false;
      player._removalTimer = setTimeout(() => {
        const idx = lobby.players.findIndex((p) => p.socketId === socket.id && !p.connected);
        if (idx === -1) return; // they reconnected under a new socket.id already

        const wasHost = lobby.players[idx].isHost;
        lobby.players.splice(idx, 1);

        if (lobby.players.length === 0) {
          lobbyManager.deleteLobby(lobby.id);
          return;
        }
        if (wasHost) lobby.players[0].isHost = true;

        emitLobbyUpdate(lobby);
        if (lobby.state === 'in_round') maybeEndRound(lobby);
      }, REMOVAL_GRACE_MS);

      emitLobbyUpdate(lobby); // let others see them as momentarily disconnected
    }
  });
});

server.listen(cfg.PORT, () => {
  console.log(`Duordle server listening on http://localhost:${cfg.PORT}`);
  if (!cfg.OXFORD_ENABLED) {
    console.log('Oxford API keys not set - using local word lists only (this is fine, the game fully works).');
  }
});
