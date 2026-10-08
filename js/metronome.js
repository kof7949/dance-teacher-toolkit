// Metronome screen: a Web Audio click track (no audio files — every sound is synthesized
// live with oscillators/noise so the app's size never grows) plus a Rhythm Example video
// section. Timing uses the standard lookahead-scheduler technique: a fast setInterval just
// checks which beats are due in the next instant and schedules them against the
// AudioContext's own clock, so playback stays sample-accurate instead of drifting the way a
// plain setInterval-triggered sound would over a long session.
const Metronome = (() => {
  const SETTINGS_KEY = 'dance-toolkit-metronome-settings';
  // Each kit is a genre-flavored set of synthesized sounds (see SOUND_FNS below for the
  // actual oscillator/noise synthesis per sound) -- picking a kit narrows which sounds show
  // up, since not every kit has the same roles (e.g. Vogue is just a single accent stab).
  const KITS = [
    { id: 'classic', label: 'Classic', sounds: [
      { id: 'kick', label: 'Kick' },
      { id: 'bass', label: 'Bass' },
      { id: 'hihat', label: 'Hi-Hat' },
      { id: 'snare', label: 'Snare' },
    ] },
    { id: 'hiphop', label: 'Hip-Hop', sounds: [
      { id: 'kick', label: 'Kick' },
      { id: 'snare', label: 'Snare' },
      { id: 'hihat', label: 'Hi-Hat' },
    ] },
    { id: 'funk', label: 'Funk', sounds: [
      { id: 'kick', label: 'Kick' },
      { id: 'snare', label: 'Snare' },
      { id: 'hihat', label: 'Hi-Hat' },
    ] },
    { id: 'disco', label: 'Disco', sounds: [
      { id: 'kick', label: 'Kick' },
      { id: 'clap', label: 'Clap' },
      { id: 'hihat', label: 'Hi-Hat' },
    ] },
    { id: 'house', label: 'House', sounds: [
      { id: 'kick', label: 'Kick' },
      { id: 'clap', label: 'Clap' },
      { id: 'hihat', label: 'Hi-Hat' },
    ] },
    { id: 'vogue', label: 'Vogue', sounds: [
      { id: 'stab', label: 'Stab' },
    ] },
  ];
  const MIN_BPM = 10;
  const MAX_BPM = 500;
  const DEFAULT_BPM = 100;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.1;
  const COUNT_LENGTHS = [4, 8, 16];
  const DEFAULT_COUNT_LENGTH = 8;
  const TAP_RESET_MS = 2000;
  const TAP_HISTORY_SIZE = 8;

  let root;
  let state = { bpm: DEFAULT_BPM, kit: 'classic', sound: 'kick', countLength: DEFAULT_COUNT_LENGTH, playing: false, videoExpanded: false };
  let audioCtx = null;
  let schedulerTimer = null;
  let nextNoteTime = 0;
  let beatCounter = 0;
  let wakeLock = null;
  let pulseEl = null;
  let countEl = null;

  function findKit(kitId) {
    return KITS.find((k) => k.id === kitId);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved.bpm)) state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, saved.bpm));
      if (COUNT_LENGTHS.includes(saved.countLength)) state.countLength = saved.countLength;
      const kit = findKit(saved.kit);
      if (kit) {
        state.kit = kit.id;
        state.sound = kit.sounds.some((s) => s.id === saved.sound) ? saved.sound : kit.sounds[0].id;
      }
    } catch (err) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bpm: state.bpm, kit: state.kit, sound: state.sound, countLength: state.countLength }));
    } catch (err) { /* ignore */ }
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

  // --- Hip-Hop: deep 808-style sub kick (long pitched sustain), a crisper layered snare ---
  function playHipHopKick(ctx, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.15);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.56);
  }

  function playHipHopSnare(ctx, time) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, time);
    filter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.13);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    oscGain.gain.setValueAtTime(0.4, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.09);
  }

  function playHipHopHiHat(ctx, time) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(9000, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.04);
  }

  // --- Funk: tight punchy kick, bright rimshot-flavored snare, crisp closed hat ---
  function playFunkKick(ctx, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(55, time + 0.06);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  function playFunkSnare(ctx, time) {
    // Two tight overlapping noise bursts for a crisp funk "pop" -- no tonal oscillator
    // layer, since a short square-wave blip reads as a generic metronome tick rather than
    // a snare crack.
    [{ offset: 0, decay: 0.03, level: 0.7 }, { offset: 0.016, decay: 0.09, level: 1 }].forEach(({ offset, decay, level }) => {
      const t = time + offset;
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3200, t);
      filter.Q.value = 1.6;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start(t);
      noise.stop(t + decay + 0.01);
    });
  }

  function playFunkHiHat(ctx, time) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.035);
  }

  // --- Disco / House: four-on-the-floor kick with a click transient, analog-style clap
  // (three quick overlapping noise bursts -- the classic way to fake a hand clap), shimmer hat ---
  function playFourOnFloorKick(ctx, time, { startFreq, endFreq, decay }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + decay * 0.4);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + decay + 0.01);

    // Short filtered-noise transient for a natural percussive attack (like a kick beater
    // thump) instead of a tonal click, which read as a generic metronome tick rather than
    // part of the kick drum.
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(900, time);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.025);
  }

  function playDiscoKick(ctx, time) { playFourOnFloorKick(ctx, time, { startFreq: 160, endFreq: 50, decay: 0.22 }); }
  function playHouseKick(ctx, time) { playFourOnFloorKick(ctx, time, { startFreq: 145, endFreq: 42, decay: 0.2 }); }

  function playClap(ctx, time, { spread, filterFreq, decay }) {
    const bursts = 3;
    for (let i = 0; i < bursts; i++) {
      const t = time + i * spread;
      const isLast = i === bursts - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(filterFreq, t);
      filter.Q.value = 1.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (isLast ? decay : 0.03));
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start(t);
      noise.stop(t + (isLast ? decay + 0.01 : 0.04));
    }
  }

  function playDiscoClap(ctx, time) { playClap(ctx, time, { spread: 0.012, filterFreq: 1400, decay: 0.18 }); }
  function playHouseClap(ctx, time) { playClap(ctx, time, { spread: 0.008, filterFreq: 1700, decay: 0.14 }); }

  function playOpenHiHat(ctx, time, { highpass, decay }) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(highpass, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + decay + 0.01);
  }

  function playDiscoHiHat(ctx, time) { playOpenHiHat(ctx, time, { highpass: 6500, decay: 0.12 }); }
  function playHouseHiHat(ctx, time) { playOpenHiHat(ctx, time, { highpass: 8500, decay: 0.045 }); }

  // --- Vogue: a single sharp, loud accent stab (noise burst + a falling sawtooth for weight) --
  // the real "Ha" vogue sound everyone knows is a specific copyrighted vocal sample, so this is
  // a generic accent hit in the same rhythmic role rather than an attempt to copy it.
  function playVogueStab(ctx, time) {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, time);
    filter.Q.value = 1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(1, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.11);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(90, time + 0.05);
    oscGain.gain.setValueAtTime(0.6, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  const SOUND_FNS = {
    'classic:kick': playKick,
    'classic:bass': playBass,
    'classic:hihat': playHiHat,
    'classic:snare': playSnare,
    'hiphop:kick': playHipHopKick,
    'hiphop:snare': playHipHopSnare,
    'hiphop:hihat': playHipHopHiHat,
    'funk:kick': playFunkKick,
    'funk:snare': playFunkSnare,
    'funk:hihat': playFunkHiHat,
    'disco:kick': playDiscoKick,
    'disco:clap': playDiscoClap,
    'disco:hihat': playDiscoHiHat,
    'house:kick': playHouseKick,
    'house:clap': playHouseClap,
    'house:hihat': playHouseHiHat,
    'vogue:stab': playVogueStab,
  };

  function playClick(time) {
    const fn = SOUND_FNS[`${state.kit}:${state.sound}`];
    if (fn) fn(audioCtx, time);
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

  function scheduleCountDisplay(time, count) {
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (countEl) countEl.textContent = count;
    }, delayMs);
  }

  function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      playClick(nextNoteTime);
      schedulePulse(nextNoteTime);
      beatCounter = (beatCounter % state.countLength) + 1;
      scheduleCountDisplay(nextNoteTime, beatCounter);
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
    beatCounter = 0;
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
    if (countEl) countEl.textContent = '–';
  }

  function togglePlay() {
    if (state.playing) stopPlaying(); else startPlaying();
  }

  function setBpm(value) {
    state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, value));
    saveSettings();
    render();
  }

  // ---------- Tap tempo ----------

  let tapTimestamps = [];

  function handleTapTempo() {
    const now = performance.now();
    // A long gap since the last tap means this is a fresh attempt, not a continuation --
    // start the average over rather than let a stale old tap skew it.
    if (tapTimestamps.length && now - tapTimestamps[tapTimestamps.length - 1] > TAP_RESET_MS) {
      tapTimestamps = [];
    }
    tapTimestamps.push(now);
    if (tapTimestamps.length > TAP_HISTORY_SIZE) tapTimestamps.shift();

    if (tapTimestamps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimestamps.length; i++) intervals.push(tapTimestamps[i] - tapTimestamps[i - 1]);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.round(60000 / avgMs));
    }
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
    const currentKit = findKit(state.kit) || KITS[0];
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

        <div class="metro-tap-row">
          <button class="btn-tap" data-action="tap-tempo">TAP</button>
        </div>
        <div class="tag-label" style="text-align:center;">Tap at least twice in rhythm to set the tempo</div>

        <div class="tag-label" style="text-align:center;">Kit</div>
        <div class="tag-buttons" style="justify-content:center;">
          ${KITS.map((k) => `<button class="chip ${state.kit === k.id ? 'active' : ''}" data-kit="${k.id}">${k.label}</button>`).join('')}
        </div>

        <div class="tag-label" style="text-align:center;">Sound</div>
        <div class="tag-buttons" style="justify-content:center;">
          ${currentKit.sounds.map((s) => `<button class="chip ${state.sound === s.id ? 'active' : ''}" data-sound="${s.id}">${s.label}</button>`).join('')}
        </div>

        <div class="tag-label" style="text-align:center;">Count</div>
        <div class="tag-buttons" style="justify-content:center;">
          ${COUNT_LENGTHS.map((n) => `<button class="chip ${state.countLength === n ? 'active' : ''}" data-count-length="${n}">${n}-count</button>`).join('')}
        </div>

        <div class="metro-count-display">
          <span class="metro-count-value" id="metro-count-value">–</span>
          <span class="metro-count-label">/ ${state.countLength}</span>
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
    countEl = document.getElementById('metro-count-value');
    if (state.videoExpanded) setupRhythmVideo();
  }

  // ---------- Events ----------

  function handleClick(e) {
    const kitId = e.target.closest('[data-kit]')?.dataset.kit;
    const soundId = e.target.closest('[data-sound]')?.dataset.sound;
    const countLength = e.target.closest('[data-count-length]')?.dataset.countLength;
    const bpmDelta = e.target.closest('[data-bpm-delta]')?.dataset.bpmDelta;
    const rhythmSpeed = e.target.closest('[data-rhythm-speed]')?.dataset.rhythmSpeed;
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (kitId) {
      const kit = findKit(kitId);
      if (!kit) return;
      state.kit = kit.id;
      if (!kit.sounds.some((s) => s.id === state.sound)) state.sound = kit.sounds[0].id;
      saveSettings();
      return render();
    }
    if (soundId) {
      state.sound = soundId;
      saveSettings();
      return render();
    }
    if (countLength) {
      state.countLength = Number(countLength);
      beatCounter = 0;
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
      case 'tap-tempo':
        return handleTapTempo();
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
