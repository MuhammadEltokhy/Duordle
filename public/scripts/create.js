(function () {
  const { socket, ensureRegistered, setLobbyId } = window.Duordle;

  const lengthSlider = document.getElementById('length-slider');
  const lengthValue = document.getElementById('length-value');
  const lengthJoke = document.getElementById('length-joke');
  const visibilitySelect = document.getElementById('visibility-select');
  const playersSelect = document.getElementById('players-select');
  const roundsSelect = document.getElementById('rounds-select');
  const timeSlider = document.getElementById('time-slider');
  const timeValue = document.getElementById('time-value');
  const noTimeCheck = document.getElementById('no-time-check');
  const timeNote = document.getElementById('time-note');
  const createSubmitBtn = document.getElementById('create-submit-btn');
  const createError = document.getElementById('create-error');

  // Funny strings as the host drags the letter-count slider.
  const jokes = {
    3: "easy lmao",
    4: "still warming up",
    5: "that's real deal homie",
    6: "okay now we're talking",
    7: "bold choice, champ",
    8: "you sure about this?",
    9: "borderline unhinged",
    10: "son 🙏🏿",
  };

  function updateJoke() {
    const val = Number(lengthSlider.value);
    lengthValue.textContent = val;
    lengthJoke.textContent = jokes[val] || '';
    // Styling lives in create.css (.is-max) - no inline styles from JS.
    lengthJoke.classList.toggle('is-max', val === 10);
  }
  lengthSlider.addEventListener('input', updateJoke);
  updateJoke();

  function updateTime() {
    timeValue.textContent = noTimeCheck.checked
      ? 'No limit'
      : UI.formatTime(Number(timeSlider.value) * 1000);
    timeSlider.disabled = noTimeCheck.checked;
    timeNote.hidden = noTimeCheck.checked;
  }
  timeSlider.addEventListener('input', updateTime);
  noTimeCheck.addEventListener('change', updateTime);
  updateTime();

  ensureRegistered(() => {
    createSubmitBtn.addEventListener('click', () => {
      createSubmitBtn.disabled = true;
      createError.textContent = '';

      const settings = {
        isPublic: visibilitySelect.value === 'public',
        wordLength: Number(lengthSlider.value),
        maxPlayers: Number(playersSelect.value),
        rounds: Number(roundsSelect.value),
        timeLimitSec: noTimeCheck.checked ? 0 : Number(timeSlider.value),
      };

      socket.emit('createLobby', settings, (res) => {
        createSubmitBtn.disabled = false;
        if (!res || !res.ok) {
          createError.textContent = (res && res.error) || 'Could not create lobby.';
          return;
        }
        setLobbyId(res.lobbyId);
        window.location.href = '/lobby.html';
      });
    });
  });
})();
