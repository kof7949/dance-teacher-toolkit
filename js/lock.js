// Simple passcode gate shown before the app itself. This is a deterrent against
// casual access when the link/APK is shared, not real security: the app is static
// files in a public repo, so a determined person could find or brute-force a
// 4-digit code. The correct code is stored as a SHA-256 hash rather than plain
// text so it isn't immediately visible in the source.
(function () {
  const PASSCODE_HASH = '74bb05d20f937f744cbf930cc6174146b830b9cf0a7ba01d0ba3c11b613adcba';
  const UNLOCK_KEY = 'dance-toolkit-unlocked';
  const CODE_LENGTH = 4;

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function reveal() {
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) lockScreen.hidden = true;
    if (window.startApp) window.startApp();
  }

  async function init() {
    let unlocked = false;
    try { unlocked = localStorage.getItem(UNLOCK_KEY) === '1'; } catch (err) { /* ignore */ }
    if (unlocked) { reveal(); return; }

    const lockScreen = document.getElementById('lock-screen');
    const dotsWrap = document.getElementById('lock-dots');
    const dots = dotsWrap ? Array.from(dotsWrap.querySelectorAll('.lock-dot')) : [];
    let entered = '';

    function renderDots() {
      dots.forEach((dot, i) => dot.classList.toggle('filled', i < entered.length));
    }

    async function submit() {
      const hash = await sha256Hex(entered);
      if (hash === PASSCODE_HASH) {
        try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (err) { /* ignore */ }
        reveal();
        return;
      }
      dotsWrap.classList.add('lock-error');
      setTimeout(() => {
        dotsWrap.classList.remove('lock-error');
        entered = '';
        renderDots();
      }, 400);
    }

    lockScreen.addEventListener('click', (e) => {
      const key = e.target.closest('.lock-key');
      if (!key) return;
      const value = key.dataset.key;
      if (value === 'back') {
        entered = entered.slice(0, -1);
        renderDots();
        return;
      }
      if (entered.length >= CODE_LENGTH) return;
      entered += value;
      renderDots();
      if (entered.length === CODE_LENGTH) submit();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
