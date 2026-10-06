(function(){
  const unInput=document.getElementById('usernameInput');
  const unError=document.getElementById('usernameError');
  const create=document.getElementById('create');
  const join=document.getElementById('join');
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
  function save(go) {
    sessionStorage.setItem('username', unInput.value.trim());
    window.location.href = go;
  }
  create.addEventListener('click', () => save('create.html'));
  join.addEventListener('click', () => save('join.html'));
})();
