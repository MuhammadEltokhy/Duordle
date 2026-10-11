window.Duordle = (function (){
  // On a host that cannot run the Node server (for example Vercel), /socket.io/socket.io.js
  // does not exist and `io` is undefined. Instead of every page crashing, we use a "dead"
  // socket (so buttons, toggles and sliders still work) and show a clear message.
  const serverMissing = typeof io === 'undefined';
  const socket = serverMissing
    ? { id: null, on() {}, off() {}, emit() {}, connected: false }
    : io();

  function showOfflineBanner(text){
    if (document.getElementById('offline-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'offline-banner';
    bar.className = 'offline-banner';
    bar.textContent = text;
    document.body.appendChild(bar);
  }
  if (serverMissing){
    const warn = () => showOfflineBanner('Cannot reach the Duordle game server. Run it with "npm start" or host it on a service that runs Node.js (not Vercel).');
    if (document.body) warn(); else document.addEventListener('DOMContentLoaded', warn);
  } else {
    socket.on('disconnect', () => {
      // short blips (page changes, reconnects) are normal; only warn if it lasts
      setTimeout(() => { if (!socket.connected) showOfflineBanner('Connection lost - trying to reconnect...'); }, 4000);
    });
    socket.on('connect', () => {
      const bar = document.getElementById('offline-banner');
      if (bar) bar.remove();
    });
  }

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
    if (serverMissing) return; // banner already explains why nothing loads
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
