window.UI=(function(){
  function layer(id, className){
    let el=document.getElementById(id);
    if (!el){
      el=document.createElement('div');
      el.id=id;
      el.className=className;
      document.body.appendChild(el);
    }
    return el;
  }
  function leaveAndRemove(el, done){
    let finished=false;
    const finish=()=>{
      if (finished) return;
      finished=true;
      el.remove();
      if (done) done();
    };
    el.classList.add('leaving');
    el.addEventListener('animationend', (e) => { if (e.target === el) finish(); });
    setTimeout(finish, 450);
  }
  function toast(message, options){
    const opts=options || {};
    const stack=layer('toast-stack', 'toast-stack');
    while (stack.children.length>=3) stack.firstChild.remove();
    const el=document.createElement('div');
    el.className='toast'+(opts.type ? ' ' + opts.type : '');
    el.textContent=message;
    stack.appendChild(el);
    setTimeout(()=>leaveAndRemove(el), opts.duration || 2000);
    return el;
  }
  const noticeQueue = [];
  let noticeShowing=false;
  function drainNotices(){
    if (noticeShowing) return;
    const n=noticeQueue.shift();
    if (!n) return;
    noticeShowing = true;
    const host =layer('big-notice-layer', 'big-notice-layer');
    const el=document.createElement('div');
    el.className = 'big-notice'+(n.type ? ' ' + n.type : '');
    const title = document.createElement('div');
    title.className = 'notice-title';
    title.textContent=n.title;
    el.appendChild(title);
    if (n.sub){
      const sub=document.createElement('div');
      sub.className = 'notice-sub';
      sub.textContent = n.sub;
      el.appendChild(sub);
    }
    host.appendChild(el);
    setTimeout(()=>{
      leaveAndRemove(el, ()=>{
        noticeShowing=false;
        drainNotices();
      });
    }, n.duration || 2400);
  }
  function notice(n){
    noticeQueue.push(n);
    drainNotices();
  }
  function clearNotices(){
    noticeQueue.length = 0;
    const host = document.getElementById('big-notice-layer');
    if (host) host.querySelectorAll('.big-notice').forEach((el)=>{
       if (!el.classList.contains('leaving')) leaveAndRemove(el, ()=>{ 
        noticeShowing=false; 
      }); 
    });
  }
  function sideNotice(message, duration){
    const stack = layer('side-stack', 'side-stack');
    while (stack.children.length >= 4) stack.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'side-notice';
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(()=>leaveAndRemove(el), duration || 4500);
  }
  function show(el){
    if (!el) return;
    el.classList.remove('leaving');
    el.hidden = false;
  }
  function hide(el){
    if (!el || el.hidden) return;
    let finished = false;
    const finish=()=>{
      if (finished) return;
      finished = true;
      el.hidden = true;
      el.classList.remove('leaving');
    };
    el.classList.add('leaving');
    el.addEventListener('animationend', (e)=>{ 
      if (e.target === el) finish(); 
    });
    setTimeout(finish, 350);
  }
  function formatTime(ms, withTenths){
    const safe = Math.max(0, Math.floor(ms || 0));
    const totalSeconds = Math.floor(safe/1000);
    const m = Math.floor(totalSeconds/60);
    const s = totalSeconds%60;
    const base = m + ':' + String(s).padStart(2, '0');
    return withTenths ? base + '.' + Math.floor((safe%1000)/100):base;
  }
  function countUp(el, from, to, durationMs, done){
    if (from === to){
      el.textContent=Number(to).toLocaleString('en-US');
      if (done) done();
      return;
    }
    const start=performance.now();
    function frame(now){
      const t = Math.min(1, (now-start)/durationMs);
      const eased = t >= 1 ? 1 : 1 - Math.pow(2, -10*t);
      el.textContent = Math.round(from+(to-from)*eased).toLocaleString('en-US');
      if (t<1) requestAnimationFrame(frame);
      else {
        el.textContent = Number(to).toLocaleString('en-US');
        if (done) done();
      }
    }
    requestAnimationFrame(frame);
  }
  function nextFrame(fn){
    requestAnimationFrame(()=>requestAnimationFrame(fn));
  }
  return { 
    toast, notice, clearNotices, 
    sideNotice, show, hide, 
    formatTime, countUp, nextFrame 
  };
})();
