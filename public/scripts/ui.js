// Shared UI helpers: toasts, big notices, side notices, animated show/hide,
// clock formatting and the "points count up" animation.
// Needs no socket - it is loaded by every page that shows messages or pop-ups.
// All styling lives in main.css (no inline styles are written from here).
window.UI = (function () {
  const reduceMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function layer(id, className) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = className;
      document.body.appendChild(el);
    }
    return el;
  }

  // Plays the element's "leaving" animation (class .leaving), then removes it.
  function leaveAndRemove(el, done) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.remove();
      if (done) done();
    };
    el.classList.add('leaving');
    el.addEventListener('animationend', (e) => { if (e.target === el) finish(); });
    setTimeout(finish, 450); // safety net
  }

  // ---------------------------------------------------------------- toasts
  // Small message that drops in from the top: "Not in word list", "You got it!" ...
  function toast(message, options) {
    const opts = options || {};
    const stack = layer('toast-stack', 'toast-stack');
    while (stack.children.length >= 3) stack.firstChild.remove();

    const el = document.createElement('div');
    el.className = 'toast' + (opts.type ? ' ' + opts.type : '');
    el.textContent = message;
    stack.appendChild(el);

    setTimeout(() => leaveAndRemove(el), opts.duration || 2000);
    return el;
  }

  // ----------------------------------------------------------- big notices
  // Large pop-ups shown one after another: a new one appears only after the
  // previous one has been hidden.
  const noticeQueue = [];
  let noticeShowing = false;

  function drainNotices() {
    if (noticeShowing) return;
    const n = noticeQueue.shift();
    if (!n) return;
    noticeShowing = true;

    const host = layer('big-notice-layer', 'big-notice-layer');
    const el = document.createElement('div');
    el.className = 'big-notice' + (n.type ? ' ' + n.type : '');
    const title = document.createElement('div');
    title.className = 'notice-title';
    title.textContent = n.title;
    el.appendChild(title);
    if (n.sub) {
      const sub = document.createElement('div');
      sub.className = 'notice-sub';
      sub.textContent = n.sub;
      el.appendChild(sub);
    }
    host.appendChild(el);

    setTimeout(() => {
      leaveAndRemove(el, () => {
        noticeShowing = false;
        drainNotices();
      });
    }, n.duration || 2400);
  }

  function notice(n) {
    noticeQueue.push(n);
    drainNotices();
  }

  function clearNotices() {
    noticeQueue.length = 0;
    const host = document.getElementById('big-notice-layer');
    if (host) host.querySelectorAll('.big-notice').forEach((el) => { if (!el.classList.contains('leaving')) leaveAndRemove(el, () => { noticeShowing = false; }); });
  }

  // ---------------------------------------------------------- side notices
  // Small text that slides in at the bottom-left: "Player x has left the lobby"
  function sideNotice(message, duration) {
    const stack = layer('side-stack', 'side-stack');
    while (stack.children.length >= 4) stack.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'side-notice';
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => leaveAndRemove(el), duration || 4500);
  }

  // ------------------------------------------------------- show / hide
  // Elements start with the `hidden` attribute in the HTML. show() plays their
  // entrance animation (defined in CSS); hide() plays the exit one first.
  function show(el) {
    if (!el) return;
    el.classList.remove('leaving');
    el.hidden = false;
  }

  function hide(el) {
    if (!el || el.hidden) return;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.hidden = true;
      el.classList.remove('leaving');
    };
    el.classList.add('leaving');
    el.addEventListener('animationend', (e) => { if (e.target === el) finish(); });
    setTimeout(finish, 350); // safety net
  }

  // ------------------------------------------------------------- clocks
  // 83400 -> "1:23.4"  (tenths optional: "1:23")
  function formatTime(ms, withTenths) {
    const safe = Math.max(0, Math.floor(ms || 0));
    const totalSeconds = Math.floor(safe / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const base = m + ':' + String(s).padStart(2, '0');
    return withTenths ? base + '.' + Math.floor((safe % 1000) / 100) : base;
  }

  // ------------------------------------------------------- count-up
  // Counts a number from `from` to `to`: very fast at first, then slowing down
  // (exponential ease-out) until it lands exactly on `to`.
  function countUp(el, from, to, durationMs, done) {
    if (reduceMotion() || from === to) {
      el.textContent = Number(to).toLocaleString('en-US');
      if (done) done();
      return;
    }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(frame);
      else {
        el.textContent = Number(to).toLocaleString('en-US');
        if (done) done();
      }
    }
    requestAnimationFrame(frame);
  }

  // Runs fn after the browser has painted the current state (lets CSS transitions start).
  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  return { toast, notice, clearNotices, sideNotice, show, hide, formatTime, countUp, nextFrame, reduceMotion };
})();
