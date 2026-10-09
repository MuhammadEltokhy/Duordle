window.Duordle = (function (){
  const socket = io();
  function getUsername(){
    return sessionStorage.getItem('duordle_username') || '';
  }
  function setUsername(name){
    sessionStorage.setItem('duordle_username', name);
  }
  function getLobbyId(){
    return sessionStorage.getItem('duordle_lobby_id') || '';
  }
  function setLobbyId(id){
    sessionStorage.setItem('duordle_lobby_id', id);
  }
  function ensureRegistered(callback){
    const username = getUsername();
    if (!username){
      window.location.href = '/';
      return;
    }
    socket.emit('register', {username}, (res)=>{
      if (!res || !res.ok){
        window.location.href = '/';
        return;
      }
      callback && callback();
    });
  }
  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  return {socket, getUsername, 
    setUsername, getLobbyId, setLobbyId, 
    ensureRegistered, escapeHtml
    };
})();
