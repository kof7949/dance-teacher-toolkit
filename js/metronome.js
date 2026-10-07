// Metronome screen: a Web Audio click track (no audio files — every sound is synthesized
// live with oscillators/noise so the app's size never grows) plus a Rhythm Example video
// section. Timing uses the standard lookahead-scheduler technique: a fast setInterval just
// checks which beats are due in the next instant and schedules them against the
// AudioContext's own clock, so playback stays sample-accurate instead of drifting the way a
// plain setInterval-triggered sound would over a long session.
const Metronome = (() => {
  const SETTINGS_KEY = 'dance-toolkit-metronome-settings';
  const SOUNDS = [
    { id: 'kick', label: 'Kick' },
    { id: 'bass', label: 'Bass' },
    { id: 'hihat', label: 'Hi-Hat' },
    { id: 'snare', label: 'Snare' },
  ];
  const MIN_BPM = 10;
  const MAX_BPM = 500;
  const DEFAULT_BPM = 100;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.1;

  let root;
  let state = { bpm: DEFAULT_BPM, sound: 'kick', playing: false, videoExpanded: false };
  let audioCtx = null;
  let schedulerTimer = null;
  let nextNoteTime = 0;
  let wakeLock = null;
  let pulseEl = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved.bpm)) state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, saved.bpm));
      if (saved.sound && SOUNDS.some((s) => s.id === saved.sound)) state.sound = saved.sound;
    } catch (err) { /* ignore */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bpm: state.bpm, sound: state.sound })); } catch (err) { /* ignore */ }
  }

  // ---------- Sound synthesis ----------

  function ensureAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function createNoiseBuffer(ctx) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.3);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playKick(ctx, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.26);
  }

  function playBass(ctx, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, time);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.36);
  }

  function playHiHat(ctx, time) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.06);
  }

  function playSnare(ctx, time) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, time);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.16);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.11);
  }

  function playClick(time) {
    switch (state.sound) {
      case 'kick': return playKick(audioCtx, time);
      case 'bass': return playBass(audioCtx, time);
      case 'hihat': return playHiHat(audioCtx, time);
      case 'snare': return playSnare(audioCtx, time);
    }
  }

  // ---------- Scheduler ----------

  function schedulePulse(time) {
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (!pulseEl) return;
      pulseEl.classList.add('pulse-active');
      setTimeout(() => pulseEl && pulseEl.classList.remove('pulse-active'), 100);
    }, delayMs);
  }

  function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      playClick(nextNoteTime);
      schedulePulse(nextNoteTime);
      nextNoteTime += 60 / state.bpm;
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { /* not supported, denied, or tab not visible — fine either way */ }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function updatePlayButton() {
    const btn = document.getElementById('metro-play-btn');
    if (btn) btn.textContent = state.playing ? '⏸' : '▶';
  }

  function startPlaying() {
    ensureAudioContext();
    state.playing = true;
    nextNoteTime = audioCtx.currentTime + 0.05;
    scheduler();
    schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
    requestWakeLock();
    updatePlayButton();
  }

  function stopPlaying() {
    state.playing = false;
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    releaseWakeLock();
    updatePlayButton();
  }

  function togglePlay() {
    if (state.playing) stopPlaying(); else startPlaying();
  }

  function setBpm(value) {
    state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, value));
    saveSettings();
    render();
  }

  // ---------- Rhythm Example video ----------

  function rhythmExampleBodyHtml() {
    return `
      <div style="padding: 0 2px 14px;">
        <video id="rhythm-video" controls preload="metadata" playsinline
               style="width:100%; display:block; border-radius:10px; background:#000;"></video>
        <div class="empty-state-small" id="rhythm-video-missing" hidden>Rhythm example video coming soon.</div>
        <div class="speed-row" style="margin-top:10px;">
          <span class="speed-label">Speed: <b id="rhythm-speed-value">100%</b></span>
          <input type="range" id="rhythm-speed-slider" min="25" max="200" value="100" step="5" />
          <div class="speed-presets">
            <button class="chip rhythm-speed-chip" data-rhythm-speed="50">50%</button>
            <button class="chip rhythm-speed-chip" data-rhythm-speed="75">75%</button>
            <button class="chip rhythm-speed-chip active" data-rhythm-speed="100">100%</button>
            <button class="chip rhythm-speed-chip" data-rhythm-speed="125">125%</button>
            <button class="chip rhythm-speed-chip" data-rhythm-speed="150">150%</button>
            <button class="chip rhythm-speed-chip" data-rhythm-speed="200">200%</button>
          </div>
        </div>
      </div>
    `;
  }

  function setupRhythmVideo() {
    const video = document.getElementById('rhythm-video');
    const missing = document.getElementById('rhythm-video-missing');
    if (!video || video.dataset.srcSet) return;
    video.dataset.srcSet = '1';
    video.addEventListener('error', () => {
      video.hidden = true;
      if (missing) missing.hidden = false;
    });
    video.src = 'videos/rhythm-example.mp4';
  }

  function applyRhythmSpeed(pct) {
    const video = document.getElementById('rhythm-video');
    if (video) {
      video.playbackRate = pct / 100;
      video.preservesPitch = true;
      video.webkitPreservesPitch = true;
      video.mozPreservesPitch = true;
    }
    const valueEl = document.getElementById('rhythm-speed-value');
    if (valueEl) valueEl.textContent = pct + '%';
    document.querySelectorAll('.rhythm-speed-chip').forEach((c) => {
      c.classList.toggle('active', Number(c.dataset.rhythmSpeed) === pct);
    });
  }

  function setRhythmSpeed(pct) {
    const slider = document.getElementById('rhythm-speed-slider');
    if (slider) slider.value = pct;
    applyRhythmSpeed(pct);
  }

  // ---------- Render ----------

  function render() {
    root.innerHTML = `
      <div class="card">
        <div class="section-title" style="margin-top:0;">🥁 Metronome</div>
        <div class="metro-bpm-display">
          <input type="number" class="metro-bpm-value" id="metro-bpm-input" inputmode="numeric"
                 min="${MIN_BPM}" max="${MAX_BPM}" value="${state.bpm}" />
          <span class="metro-bpm-label">BPM</span>
        </div>
        <input type="range" id="metro-bpm-slider" min="${MIN_BPM}" max="${MAX_BPM}" value="${state.bpm}" />
        <div class="nudge-row">
          <div class="nudge-group">
            <button class="btn btn-small btn-nudge" data-bpm-delta="-5">−5</button>
            <button class="btn btn-small btn-nudge" data-bpm-delta="-1">−1</button>
            <button class="btn btn-small btn-nudge" data-bpm-delta="1">+1</button>
            <button class="btn btn-small btn-nudge" data-bpm-delta="5">+5</button>
          </div>
        </div>

        <div class="tag-label" style="text-align:center;">Sound</div>
        <div class="tag-buttons" style="justify-content:center;">
          ${SOUNDS.map((s) => `<button class="chip ${state.sound === s.id ? 'active' : ''}" data-sound="${s.id}">${s.label}</button>`).join('')}
        </div>

        <div class="metro-transport">
          <div class="metro-pulse" id="metro-pulse"></div>
          <button class="btn btn-play" id="metro-play-btn" data-action="toggle-metro-play">${state.playing ? '⏸' : '▶'}</button>
        </div>
      </div>

      <div class="card">
        <div class="offstage-wrap" id="rhythm-example-wrap">
          <button class="offstage-header" data-action="toggle-rhythm-example">
            <span>${state.videoExpanded ? '▾' : '▸'} Rhythm Example</span>
          </button>
          ${state.videoExpanded ? rhythmExampleBodyHtml() : ''}
        </div>
      </div>
    `;
    pulseEl = document.getElementById('metro-pulse');
    if (state.videoExpanded) setupRhythmVideo();
  }

  // ---------- Events ----------

  function handleClick(e) {
    const soundId = e.target.closest('[data-sound]')?.dataset.sound;
    const bpmDelta = e.target.closest('[data-bpm-delta]')?.dataset.bpmDelta;
    const rhythmSpeed = e.target.closest('[data-rhythm-speed]')?.dataset.rhythmSpeed;
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (soundId) {
      state.sound = soundId;
      saveSettings();
      return render();
    }
    if (bpmDelta) {
      return setBpm(state.bpm + Number(bpmDelta));
    }
    if (rhythmSpeed) {
      return setRhythmSpeed(Number(rhythmSpeed));
    }

    switch (action) {
      case 'toggle-metro-play':
        return togglePlay();
      case 'toggle-rhythm-example':
        state.videoExpanded = !state.videoExpanded;
        return render();
    }
  }

  function handleInput(e) {
    if (e.target.id === 'metro-bpm-slider') {
      state.bpm = Number(e.target.value);
      const input = document.getElementById('metro-bpm-input');
      if (input) input.value = state.bpm;
    }
    if (e.target.id === 'metro-bpm-input') {
      // Don't clamp or touch the field's own value while the user is still typing
      // (e.g. typing "30" toward "300" would otherwise get clamped to 40 mid-keystroke).
      const typed = Number(e.target.value);
      if (Number.isFinite(typed) && e.target.value.trim() !== '') {
        const slider = document.getElementById('metro-bpm-slider');
        if (slider) slider.value = Math.min(MAX_BPM, Math.max(MIN_BPM, typed));
      }
    }
    if (e.target.id === 'rhythm-speed-slider') {
      applyRhythmSpeed(Number(e.target.value));
    }
  }

  function handleChange(e) {
    if (e.target.id === 'metro-bpm-slider') saveSettings();
    if (e.target.id === 'metro-bpm-input') {
      const typed = Number(e.target.value);
      setBpm(Number.isFinite(typed) && e.target.value.trim() !== '' ? typed : state.bpm);
    }
  }

  function handleKeydown(e) {
    if (e.target.id === 'metro-bpm-input' && e.key === 'Enter') {
      e.target.blur();
    }
  }

  async function init() {
    root = document.getElementById('metronome-root');
    loadSettings();
    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('keydown', handleKeydown);
  }

  return { init, onShow: () => render() };
})();
