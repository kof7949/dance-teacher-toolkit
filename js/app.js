(async function () {
  await ensureSeedData();
  await Music.init();
  await Progress.init();

  const tabs = Array.from(document.querySelectorAll('.tab'));
  const titleEl = document.getElementById('appbar-title');
  const titles = { music: 'Music & Count', progress: 'Progress Tracker' };
  const ACTIVE_TAB_KEY = 'dance-toolkit-active-tab';

  function activateTab(target) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.screen === target));
    document.querySelectorAll('.screen').forEach((s) => {
      s.classList.toggle('active', s.id === 'screen-' + target);
    });
    titleEl.textContent = titles[target];
    if (target === 'music') Music.onShow();
    if (target === 'progress') Progress.onShow();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.screen;
      activateTab(target);
      try { localStorage.setItem(ACTIVE_TAB_KEY, target); } catch (err) { /* ignore */ }
    });
  });

  let initialTab = 'music';
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    if (stored && titles[stored]) initialTab = stored;
  } catch (err) { /* ignore */ }
  activateTab(initialTab);

  const mainEl = document.getElementById('main');
  const backToTopBtn = document.getElementById('btn-back-to-top');
  mainEl.addEventListener('scroll', () => {
    backToTopBtn.hidden = mainEl.scrollTop < 300;
  });
  backToTopBtn.addEventListener('click', () => {
    mainEl.scrollTo({ top: 0, behavior: 'smooth' });
  });

  if ('serviceWorker' in navigator) {
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // Cache-first service workers can otherwise keep serving stale JS for a long time:
        // explicitly ask the browser to check for a new sw.js on every launch, rather than
        // waiting for its own internal update schedule.
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }

  window.forceAppUpdate = async function forceAppUpdate() {
    if (!('serviceWorker' in navigator)) {
      window.location.reload();
      return;
    }
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) await reg.unregister();
    const names = await caches.keys();
    for (const name of names) await caches.delete(name);
    window.location.reload();
  };
})();
