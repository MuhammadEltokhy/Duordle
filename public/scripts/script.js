(function(){
  const unInput=document.getElementById('username-input');
  const unError=document.getElementById('username-error');
  const create=document.getElementById('create-btn');
  const join=document.getElementById('join-btn');
  function valid(name){
    return /^[A-Za-z0-9_\-]{2,16}$/.test(name.trim());
  }
  function refresh(){
    const name = unInput.value;
    const cool = valid(name);
    create.disabled = !cool;
    join.disabled = !cool;
    unError.textContent = name.length > 0 && !cool
      ? 'Between 2-16ch; only letters, numbers, _ or - only.'
      : '';
  }
  unInput.addEventListener('input', refresh);
  refresh();
  function save(destination) {
    sessionStorage.setItem('duordle_username', unInput.value.trim());
    window.location.href = destination;
  }
  create.addEventListener('click', () => save('create-lobby.html'));
  join.addEventListener('click', () => save('join-lobby.html'));
})();
