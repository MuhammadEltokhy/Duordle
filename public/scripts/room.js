(function () {
  const { socket, ensureRegistered, getLobbyId, escapeHtml } = window.Duordle;
  const lobbyId = getLobbyId();

  if (!lobbyId) {
    window.location.href = '/';
    return;
  }

  const lobbyIdDisplay = document.getElementById('lobby-id-display');
  const visibilityNote = document.getElementById('visibility-note');
  const shareNote = document.getElementById('share-note');
  const settingLength = document.getElementById('setting-length');
  const settingRounds = document.getElementById('setting-rounds');
  const settingMaxPlayers = document.getElementById('setting-maxplayers');
  const playerList = document.getElementById('player-list');
  const startBtn = document.getElementById('start-btn');
  const waitingNote = document.getElementById('waiting-note');
  const settingTime = document.getElementById('setting-time');
  const leaveBtn = document.getElementById('leave-btn');
  const myName = sessionStorage.getItem('duordle_username');
  let knownPlayers = null;

  lobbyIdDisplay.textContent = lobbyId;

  function render(state) {
    visibilityNote.textContent = state.settings.isPublic
      ? 'This lobby is public and listed for anyone to join.'
      : 'This lobby is private - share the ID above with friends to invite them.';
    shareNote.textContent = lobbyId;
    settingTime.textContent = state.settings.timeLimitSec
      ? UI.formatTime(state.settings.timeLimitSec * 1000)
      : 'No limit';
    settingLength.textContent = state.settings.wordLength;
    settingRounds.textContent = state.settings.rounds;
    settingMaxPlayers.textContent = state.settings.maxPlayers;

    playerList.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      li.className = 'lobby-row';
      // Rows for players who were not in the previous list pop in.
      if (knownPlayers && !knownPlayers.has(p.username)) li.classList.add('row-pop');
      let badges = '';
      if (p.isHost) badges += ' <span class="badge host">host</span>';
      if (p.username === myName) badges += ' <span class="badge you">you</span>';
      if (!p.connected) badges += ' <span class="badge away">away</span>';
      li.innerHTML = `<span>${escapeHtml(p.username)}${badges}</span>`;
      playerList.appendChild(li);
    }
    knownPlayers = new Set(state.players.map((p) => p.username));

    const me = state.players.find((p) => p.username === myName);
    const amHost = Boolean(me && me.isHost);
    startBtn.hidden = !amHost;
    waitingNote.hidden = amHost;
    startBtn.disabled = state.players.length < 2;

    if (['in_round', 'round_result', 'game_end'].includes(state.state)) {
      window.location.href = '/game.html';
    }
  }

  socket.on('lobbyUpdate', render);
  socket.on('playerLeft', (d) => d && UI.sideNotice(`Player ${d.username} has left the lobby`));
  socket.on('hostChanged', (d) => d && UI.sideNotice(`${d.username} is now the host`));
  leaveBtn.addEventListener('click', () => {
    socket.emit('leaveLobby', { lobbyId }, () => {
      sessionStorage.removeItem('duordle_lobby_id');
      window.location.href = '/';
    });
  });
  socket.on('roundStart', () => { window.location.href = '/game.html'; });

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    socket.emit('startGame', { lobbyId }, (res) => {
      if (!res || !res.ok) {
        startBtn.disabled = false;
        alert((res && res.error) || 'Could not start game.');
      }
    });
  });

  ensureRegistered(() => {
    socket.emit('rejoinLobby', { lobbyId }, (res) => {
      if (!res || !res.ok) {
        alert((res && res.error) || 'Could not rejoin lobby.');
        window.location.href = '/';
        return;
      }
      render(res.state);
    });
  });
})();
