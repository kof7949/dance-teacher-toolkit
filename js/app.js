async function startApp() {
  await ensureSeedData();
  await Music.init();
  await Progress.init();
  await Formation.init();
  await Metronome.init();
  await Countdown.init();

  const tabs = Array.from(document.querySelectorAll('.tab'));
  const titleEl = document.getElementById('appbar-title');
  const titles = { music: 'Music & Count', progress: 'Progress Tracker', formation: 'Team Formation', metronome: 'Metronome', countdown: 'Countdown' };
  const ACTIVE_TAB_KEY = 'dance-toolkit-active-tab';

  function activateTab(target) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.screen === target));
    document.querySelectorAll('.screen').forEach((s) => {
      s.classList.toggle('active', s.id === 'screen-' + target);
    });
    titleEl.textContent = titles[target];
    if (target === 'music') Music.onShow();
    if (target === 'progress') Progress.onShow();
    if (target === 'formation') Formation.onShow();
    if (target === 'metronome') Metronome.onShow();
    if (target === 'countdown') Countdown.onShow();
  }

  // Exposed so another screen (a Reference note linking to a video moment) can switch tabs
  // the same way a real tab click would, including remembering it as the active tab.
  window.switchAppTab = (target) => {
    activateTab(target);
    try { localStorage.setItem(ACTIVE_TAB_KEY, target); } catch (err) { /* ignore */ }
  };

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
    const registerSw = () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // Cache-first service workers can otherwise keep serving stale JS for a long time:
        // explicitly ask the browser to check for a new sw.js on every launch, rather than
        // waiting for its own internal update schedule.
        reg.update().catch(() => {});
      }).catch(() => {});
    };
    // startApp() only runs after the lock screen is dismissed, and awaits several IndexedDB
    // opens before reaching here -- by then the window's own 'load' event may have already
    // fired (the page's own assets can finish before those DB opens do), in which case
    // addEventListener('load', ...) would never call back and the service worker -- and so
    // all offline support -- would silently never get installed. Register immediately when
    // the page is already done loading instead of only ever waiting for that event.
    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw);
    }
  }

  window.forceAppUpdate = async function forceAppUpdate() {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
      const names = await caches.keys();
      for (const name of names) await caches.delete(name);
    }
    // A plain reload() is still a "normal" navigation: with the service worker and its cache
    // gone, the next request can still be served stale by the browser's own HTTP cache (or
    // GitHub Pages' CDN cache) for several minutes, since nothing about the URL changed. A
    // cache-busting query string makes this a URL the browser has never seen, forcing a real
    // network fetch of the latest index.html (which in turn references versioned, equally
    // cache-proof ?v= asset URLs) instead of waiting out that cache's lifetime.
    window.location.href = window.location.pathname + '?cachebust=' + Date.now();
  };
}

window.startApp = startApp;
