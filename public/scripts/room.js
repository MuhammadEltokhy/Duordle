(function (){
  const{ 
    socket, ensureRegistered, 
    getLobbyId, escapeHtml 
    } =window.Duordle;
  const lobbyId = getLobbyId();
  if (!lobbyId){
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
  lobbyIdDisplay.textContent = lobbyId;
  function render(state){
    visibilityNote.textContent = state.settings.isPublic
      ? 'This lobby is public and listed for anyone to join.'
      : 'This lobby is private - share the ID above with friends to invite them.';
    shareNote.textContent = `Lobby ID: ${lobbyId}`;
    settingLength.textContent = state.settings.wordLength;
    settingRounds.textContent = state.settings.rounds;
    settingMaxPlayers.textContent = state.settings.maxPlayers;
    playerList.innerHTML = '';
    for (const p of state.players){
      const li = document.createElement('li');
      li.className = 'lobby-row';
      li.innerHTML = `<span>${escapeHtml(p.username)}${p.isHost ? ' (host)' : ''}${p.connected ? '' : ' (reconnecting...)'}</span>`;
      playerList.appendChild(li);
    }
    const me = state.players.find((p) => p.socketId === socket.id);
    const amHost = Boolean(me && me.isHost);
    startBtn.style.display = amHost ? 'block' : 'none';
    waitingNote.style.display = amHost ? 'none' : 'block';
    startBtn.disabled = state.players.length < 2;
    if (state.state === 'in_round' || state.state === 'round_result') {
      window.location.href = '/game.html';
    }
  }
  socket.on('lobbyUpdate', render);
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
