// Countdown screen: a spoken battle-round timer for street dance freestyle practice.
// Opens every round with a traditional dance count-in (silent 1-2-3-4, spoken "5, 6, 7, 8"),
// runs silently, then calls out the final seconds out loud (10 seconds, then 5-4-3-2-1) so a
// dancer can stay locked in on the floor without watching the screen. Speech uses the
// browser's built-in Web Speech API and the end buzzer is synthesized via Web Audio (the
// same oscillator-based approach as the Metronome's clicks) -- no audio files to bundle.
const Countdown = (() => {
  const SETTINGS_KEY = 'dance-toolkit-countdown-settings';
  const PRESETS = [45, 60];
  const DEFAULT_DURATION = 45;
  const LEADIN_COUNT_MS = 450; // cadence of each of the 8 lead-in counts
  const TICK_MS = 100; // display/threshold-check resolution during the running phase
  const ANNOUNCE_THRESHOLDS = [10, 5, 4, 3, 2, 1];

  let root;
  let state = { duration: DEFAULT_DURATION, phase: 'idle', leadinCount: 0, remaining: DEFAULT_DURATION };
  let audioCtx = null;
  let wakeLock = null;
  let tickTimer = null;
  let leadinTimers = [];
  let runStartTime = 0;
  let announced = new Set();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved.duration) && saved.duration > 0) state.duration = saved.duration;
    } catch (err) { /* ignore */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ duration: state.duration })); } catch (err) { /* ignore */ }
  }

  // ---------- Speech + buzzer ----------

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1;
    speechSynthesis.speak(utter);
  }

  function cancelSpeech() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function ensureAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playBuzzer() {
    const ctx = ensureAudioContext();
    [0, 0.18].forEach((offset) => {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, t);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    });
  }

  // ---------- Wake lock ----------

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { /* not supported, denied, or tab not visible — fine either way */ }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  // ---------- Timer phases ----------

  function clearAllTimers() {
    leadinTimers.forEach((id) => clearTimeout(id));
    leadinTimers = [];
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function startLeadin() {
    ensureAudioContext();
    state.phase = 'leadin';
    state.leadinCount = 0;
    render();
    requestWakeLock();

    for (let i = 1; i <= 8; i++) {
      const id = setTimeout(() => {
        state.leadinCount = i;
        if (i >= 5) speak(String(i));
        updateLeadinDisplay();
        if (i === 8) {
          leadinTimers.push(setTimeout(startRunning, LEADIN_COUNT_MS));
        }
      }, i * LEADIN_COUNT_MS);
      leadinTimers.push(id);
    }
  }

  function startRunning() {
    state.phase = 'running';
    state.remaining = state.duration;
    announced = new Set();
    runStartTime = performance.now();
    render();
    tickTimer = setInterval(tick, TICK_MS);
  }

  function tick() {
    const elapsed = (performance.now() - runStartTime) / 1000;
    const remaining = Math.max(0, Math.ceil(state.duration - elapsed));
    if (remaining !== state.remaining) {
      state.remaining = remaining;
      updateRunningDisplay();
      if (ANNOUNCE_THRESHOLDS.includes(remaining) && !announced.has(remaining)) {
        announced.add(remaining);
        speak(remaining === 10 ? '10 seconds' : String(remaining));
      }
      if (remaining === 0) finishRun();
    }
  }

  function finishRun() {
    clearAllTimers();
    state.phase = 'done';
    speak('Time');
    playBuzzer();
    releaseWakeLock();
    render();
  }

  function startCountdown() {
    cancelSpeech();
    clearAllTimers();
    startLeadin();
  }

  function stopCountdown() {
    cancelSpeech();
    clearAllTimers();
    releaseWakeLock();
    state.phase = 'idle';
    state.remaining = state.duration;
    render();
  }

  function resetCountdown() {
    stopCountdown();
  }

  // ---------- Render ----------

  function setDuration(value) {
    const clamped = Math.max(5, Math.min(600, Math.round(value)));
    state.duration = clamped;
    state.remaining = clamped;
    saveSettings();
    render();
  }

  function phaseLabel() {
    if (state.phase === 'leadin') return 'Get ready…';
    if (state.phase === 'running') return 'Go!';
    if (state.phase === 'done') return 'Time!';
    return 'Pick a duration and start';
  }

  function displayValue() {
    if (state.phase === 'leadin') return String(state.leadinCount || '');
    if (state.phase === 'running' || state.phase === 'done') return formatTime(state.remaining);
    return formatTime(state.duration);
  }

  function render() {
    const urgent = state.phase === 'running' && state.remaining <= 10;
    root.innerHTML = `
      <div class="card">
        <div class="section-title" style="margin-top:0;">⏱️ Countdown</div>
        <div class="tag-label" style="text-align:center;">${phaseLabel()}</div>
        <div class="countdown-display ${urgent ? 'urgent' : ''}" id="countdown-value">${displayValue()}</div>

        ${state.phase === 'idle' ? `
          <div class="tag-buttons" style="justify-content:center;">
            ${PRESETS.map((p) => `<button class="chip ${state.duration === p ? 'active' : ''}" data-preset="${p}">${p}s</button>`).join('')}
          </div>
          <div class="add-row" style="margin-top:10px;">
            <input type="number" id="countdown-custom-input" placeholder="Custom seconds" min="5" max="600" value="${PRESETS.includes(state.duration) ? '' : state.duration}" />
            <button class="btn btn-small" data-action="set-custom-duration">Set</button>
          </div>
        ` : ''}

        <div class="metro-transport">
          ${state.phase === 'idle'
            ? '<button class="btn btn-play" data-action="start-countdown">▶</button>'
            : `<button class="btn btn-small btn-danger" data-action="stop-countdown">${state.phase === 'done' ? 'Reset' : 'Stop'}</button>`}
        </div>
      </div>
    `;
  }

  function updateLeadinDisplay() {
    const el = document.getElementById('countdown-value');
    if (el) el.textContent = displayValue();
    const label = root.querySelector('.tag-label');
    if (label) label.textContent = phaseLabel();
  }

  function updateRunningDisplay() {
    const el = document.getElementById('countdown-value');
    if (!el) return;
    el.textContent = displayValue();
    el.classList.toggle('urgent', state.remaining <= 10);
  }

  // ---------- Events ----------

  function handleClick(e) {
    const preset = e.target.closest('[data-preset]')?.dataset.preset;
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (preset) {
      return setDuration(Number(preset));
    }

    switch (action) {
      case 'set-custom-duration': {
        const input = document.getElementById('countdown-custom-input');
        const value = Number(input.value);
        if (Number.isFinite(value) && value > 0) setDuration(value);
        return;
      }
      case 'start-countdown':
        return startCountdown();
      case 'stop-countdown':
        return stopCountdown();
    }
  }

  async function init() {
    root = document.getElementById('countdown-root');
    loadSettings();
    root.addEventListener('click', handleClick);
  }

  return { init, onShow: () => render() };
})();
