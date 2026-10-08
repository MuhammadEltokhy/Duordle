(function () {
  const { socket, ensureRegistered, setLobbyId, escapeHtml } = window.Duordle;
  const lobbyListEl = document.getElementById('lobby-list');
  const emptyStateEl = document.getElementById('empty-state');
  const filtersBtn = document.getElementById('filters-btn');
  const filtersBox = document.getElementById('filters-box');
  const applyFiltersBtn = document.getElementById('apply-filters-btn');
  const filterPlayers = document.getElementById('filter-players');
  const filterLength = document.getElementById('filter-length');
  const useIdBtn = document.getElementById('use-id-btn');
  const useIdModal = document.getElementById('use-id-modal');
  const lobbyIdInput = document.getElementById('lobby-id-input');
  const submitIdBtn = document.getElementById('submit-id-btn');
  const cancelIdBtn = document.getElementById('cancel-id-btn');
  const toast = document.getElementById('toast');

  function showToast(message) {
    toast.textContent = message;
    toast.style.display = 'block';
    toast.classList.remove('shake');
    void toast.offsetWidth; 
    toast.classList.add('shake');
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  }
  function currentFilters() {
    const filters = {};
    if (filterPlayers.value) filters.maxPlayers = Number(filterPlayers.value);
    if (filterLength.value) filters.wordLength = Number(filterLength.value);
    return filters;
  }
  function renderLobbies(lobbies) {
    lobbyListEl.innerHTML = '';
    if (!lobbies || lobbies.length === 0) {
      emptyStateEl.style.display = 'block';
      return;
    }
    emptyStateEl.style.display = 'none';
    for (const lobby of lobbies) {
      const li = document.createElement('li');
      li.className = 'lobby-row';
      li.innerHTML = `
        <span>
          <span class="lobby-id">${escapeHtml(lobby.id)}</span>
          &nbsp;&middot;&nbsp; ${lobby.wordLength}-letter words
          &nbsp;&middot;&nbsp; ${lobby.playerCount}/${lobby.maxPlayers} players
        </span>
        <button class="btn" data-id="${escapeHtml(lobby.id)}">Join</button>
      `;
      lobbyListEl.appendChild(li);
    }
    lobbyListEl.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => attemptJoin(btn.getAttribute('data-id')));
    });
  }
  function refreshList() {
    socket.emit('listPublicLobbies', currentFilters(), (res) => {
      if (res && res.ok) renderLobbies(res.lobbies);
    });
  }
  function attemptJoin(lobbyId) {
    socket.emit('joinLobby', { lobbyId }, (res) => {
      if (!res || !res.ok) {
        showToast(res && res.error ? res.error : 'Could not join lobby.');
        return;
      }
      setLobbyId(lobbyId);
      window.location.href = '/lobby.html';
    });
  }
  filtersBtn.addEventListener('click', () => {
    filtersBox.style.display = filtersBox.style.display === 'none' ? 'block' : 'none';
  });
  applyFiltersBtn.addEventListener('click', refreshList);
  useIdBtn.addEventListener('click', () => {
    lobbyIdInput.value = '';
    useIdModal.style.display = 'flex';
    lobbyIdInput.focus();
  });
  cancelIdBtn.addEventListener('click', () => { useIdModal.style.display = 'none'; });
  submitIdBtn.addEventListener('click', () => {
    const id = lobbyIdInput.value.trim();
    if (id.length !== 4) {
      showToast('Lobby ID must be 4 characters.');
      return;
    }
    attemptJoin(id);
  });
  ensureRegistered(() => {
    refreshList();
    setInterval(refreshList, 4000); 
  });
})();