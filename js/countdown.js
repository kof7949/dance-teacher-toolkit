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
  const LEADIN_COUNT_MS = 450; // default cadence of each of the 8 lead-in counts
  const DEFAULT_LEADIN_BPM = 130; // ~ matches the default 450ms cadence (60000/450 ≈ 133)
  const MIN_LEADIN_BPM = 60;
  const MAX_LEADIN_BPM = 200;
  // Speech rate at MIN_LEADIN_BPM / MAX_LEADIN_BPM. Floored at a brisk 1.1 rather than slowed
  // below normal -- a slow chosen tempo still needs each word short enough to finish well
  // before the next count, not deliberately drawn out (a drawn-out "5" was bleeding into the
  // next beat and reading as if the count had already moved on).
  const MIN_LEADIN_RATE = 1.5;
  const MAX_LEADIN_RATE = 4;
  const LEADIN_SPEECH_RESTART_DELAY_MS = 30; // gap after cancel() before the next speak()
  const TICK_MS = 100; // display/threshold-check resolution during the running phase
  const ANNOUNCE_THRESHOLDS = [10, 5, 4, 3, 2, 1];

  let root;
  let state = {
    duration: DEFAULT_DURATION,
    phase: 'idle',
    leadinCount: 0,
    remaining: DEFAULT_DURATION,
    customLeadin: false,
    leadinBpm: DEFAULT_LEADIN_BPM,
  };
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
      if (typeof saved.customLeadin === 'boolean') state.customLeadin = saved.customLeadin;
      if (Number.isFinite(saved.leadinBpm)) state.leadinBpm = clampLeadinBpm(saved.leadinBpm);
    } catch (err) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        duration: state.duration,
        customLeadin: state.customLeadin,
        leadinBpm: state.leadinBpm,
      }));
    } catch (err) { /* ignore */ }
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

  // A precise, audible beat marker for the custom-tempo lead-in. Web Audio's scheduling is
  // sample-accurate, unlike speech synthesis (whose own timing can't be trusted to lock to a
  // beat -- see the comment on runLeadinStep), so this tick is what actually lets the dancer
  // feel the chosen BPM; the spoken numbers are a secondary cue layered on top of it.
  function playLeadinTick() {
    const ctx = ensureAudioContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, t);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
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
    runLeadinStep(1);
  }

  function clampLeadinBpm(value) {
    return Math.max(MIN_LEADIN_BPM, Math.min(MAX_LEADIN_BPM, Math.round(value)));
  }

  function leadinIntervalMs() {
    return state.customLeadin ? Math.round(60000 / state.leadinBpm) : LEADIN_COUNT_MS;
  }

  // Linearly maps the chosen BPM onto a speech rate, so the spoken "5,6,7,8" audibly speeds
  // up or slows down as the slider moves -- a flat ratio against the default BPM (tried
  // earlier) stayed too close to 1 across this narrower 60-200 range to really notice.
  function leadinSpeechRate() {
    const span = MAX_LEADIN_BPM - MIN_LEADIN_BPM;
    const progress = (state.leadinBpm - MIN_LEADIN_BPM) / span;
    return MIN_LEADIN_RATE + progress * (MAX_LEADIN_RATE - MIN_LEADIN_RATE);
  }

  // Cuts off whatever's still playing and speaks the given count, so the voice always matches
  // the number currently on screen instead of trailing behind it. speechSynthesis.cancel()
  // called in the same tick as the next speak() can make some browsers silently drop that next
  // utterance (and even leave the engine in a paused state) -- resume() plus a short delay
  // before speaking again avoids that.
  function speakLeadinWord(i) {
    cancelSpeech();
    const utter = new SpeechSynthesisUtterance(String(i));
    utter.rate = leadinSpeechRate();
    leadinTimers.push(setTimeout(() => {
      if (state.phase !== 'leadin') return;
      speechSynthesis.resume();
      speechSynthesis.speak(utter);
    }, LEADIN_SPEECH_RESTART_DELAY_MS));
  }

  // Counts 1-4 are silent, so they can safely advance on a fixed timer. Counts 5-8 are
  // spoken, and speech synthesis takes a variable, device-dependent amount of time to
  // actually finish playing -- advancing those on the same fixed timer let the internal
  // clock (and the "running" phase it kicks off) get ahead of what the user actually hears,
  // so the countdown could already be ticking before "8" finished playing. By default each
  // spoken count waits for its own utterance to genuinely end before moving on.
  //
  // A custom lead-in tempo needs the dancer to actually *feel* the chosen BPM, and to hear
  // the right word the instant the count turns -- not a stale word still finishing from the
  // beat before. The exact beat itself comes from a short tick (playLeadinTick, Web Audio,
  // sample-accurate) fired on every one of the 8 counts. The spoken word is cut off and
  // restarted on every count too (speakLeadinWord), so it's always current; just calling
  // speechSynthesis.cancel() immediately before speak() made some browsers silently drop the
  // next word at a fast cadence, so cancel() is followed by resume() and a short delay before
  // the next speak() -- see speakLeadinWord. The rate is also scaled with the BPM
  // (leadinSpeechRate) so each word is short enough to usually finish on its own before the
  // next count, keeping the forced restarts rare rather than the norm.
  function runLeadinStep(i) {
    if (state.phase !== 'leadin') return; // cancelled mid-sequence
    state.leadinCount = i;
    updateLeadinDisplay();
    const intervalMs = leadinIntervalMs();
    if (state.customLeadin) playLeadinTick();

    if (i < 5) {
      leadinTimers.push(setTimeout(() => advanceLeadin(i), intervalMs));
      return;
    }
    if (!('speechSynthesis' in window)) {
      leadinTimers.push(setTimeout(() => advanceLeadin(i), intervalMs));
      return;
    }
    if (state.customLeadin) {
      speakLeadinWord(i);
      leadinTimers.push(setTimeout(() => advanceLeadin(i), intervalMs));
      return;
    }
    const utter = new SpeechSynthesisUtterance(String(i));
    utter.rate = 1;
    utter.onend = () => advanceLeadin(i);
    utter.onerror = () => advanceLeadin(i); // don't get stuck if speech fails
    speechSynthesis.speak(utter);
  }

  function advanceLeadin(i) {
    if (state.phase !== 'leadin') return;
    if (i >= 8) startRunning();
    else runLeadinStep(i + 1);
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

  function startCountdownNow() {
    cancelSpeech();
    clearAllTimers();
    ensureAudioContext();
    requestWakeLock();
    startRunning();
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

  function setCustomLeadin(enabled) {
    state.customLeadin = enabled;
    saveSettings();
    render();
  }

  function setLeadinBpm(value) {
    state.leadinBpm = clampLeadinBpm(value);
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

          <div class="tag-label" style="margin-top:14px;">Lead-in count-in</div>
          <label class="switch">
            <input type="checkbox" id="countdown-custom-leadin-toggle" ${state.customLeadin ? 'checked' : ''} />
            <span>Custom lead-in tempo</span>
          </label>
          ${state.customLeadin ? `
            <div class="add-row" style="margin-top:8px;">
              <input type="number" id="countdown-leadin-bpm-input" min="${MIN_LEADIN_BPM}" max="${MAX_LEADIN_BPM}" value="${state.leadinBpm}" />
              <span class="tag-label" style="white-space:nowrap;">BPM for "5, 6, 7, 8"</span>
            </div>
          ` : ''}
        ` : ''}

        <div class="metro-transport">
          ${state.phase === 'idle'
            ? `
              <button class="btn btn-play" data-action="start-countdown" title="Start with the 5,6,7,8 lead-in">▶</button>
              <button class="btn btn-small" data-action="start-countdown-now" title="Skip the lead-in and start the countdown immediately">Start now</button>
            `
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
      case 'start-countdown-now':
        return startCountdownNow();
      case 'stop-countdown':
        return stopCountdown();
    }
  }

  function handleChange(e) {
    if (e.target.id === 'countdown-custom-leadin-toggle') {
      return setCustomLeadin(e.target.checked);
    }
    if (e.target.id === 'countdown-leadin-bpm-input') {
      const value = Number(e.target.value);
      if (Number.isFinite(value)) setLeadinBpm(value);
    }
  }

  async function init() {
    root = document.getElementById('countdown-root');
    loadSettings();
    root.addEventListener('click', handleClick);
    root.addEventListener('change', handleChange);
  }

  return { init, onShow: () => render() };
})();
