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
  const COUNT_LENGTHS = [4, 8, 16];
  const DEFAULT_COUNT_LENGTH = 8;
  const TAP_RESET_MS = 2000;
  const TAP_HISTORY_SIZE = 8;

  // ---------- Groove Lab ----------
  // A second metronome mode (opt-in, Classic stays the default) that plays real curated or
  // user-built 16-step drum patterns instead of a single click, using short licensed CC0
  // samples fetched from their original public source repos (see audio/groove/SOURCES.txt) --
  // not extracted from any other app.
  const GROOVE_CUSTOM_PRESETS_KEY = 'dance-toolkit-groove-custom-presets';
  const STEPS_PER_BAR = 16;
  const SWING_OPTIONS = [0, 0.08, 0.16, 0.25];
  const GROOVE_ROLES = ['kick', 'snare', 'hat', 'fx'];
  const GROOVE_ROLE_LABELS = { kick: 'Kick', snare: 'Snare', hat: 'Hat', fx: 'FX' };
  const GROOVE_SAMPLES = [
    { id: 'kick-vintage', role: 'kick', label: 'Vintage', url: 'audio/groove/kick-vintage.wav' },
    { id: 'kick-damped', role: 'kick', label: 'Damped', url: 'audio/groove/kick-damped.wav' },
    { id: 'snare-dusty', role: 'snare', label: 'Dusty', url: 'audio/groove/snare-dusty.wav' },
    { id: 'snare-handclap', role: 'snare', label: 'Handclap', url: 'audio/groove/snare-handclap.wav' },
    { id: 'snare-tamb', role: 'snare', label: 'Tambo', url: 'audio/groove/snare-tamb.wav' },
    { id: 'hat-vintage', role: 'hat', label: 'Vintage', url: 'audio/groove/hat-vintage.wav' },
    { id: 'hat-brush', role: 'hat', label: 'Brush', url: 'audio/groove/hat-brush.wav' },
    { id: 'fx-tambourine', role: 'fx', label: 'Tambourine', url: 'audio/groove/fx-tambourine.wav' },
    { id: 'fx-cabasa', role: 'fx', label: 'Cabasa', url: 'audio/groove/fx-cabasa.wav' },
    { id: 'fx-conga', role: 'fx', label: 'Conga', url: 'audio/groove/fx-conga.wav' },
    { id: 'fx-claves', role: 'fx', label: 'Claves', url: 'audio/groove/fx-claves.wav' },
    { id: 'fx-snap', role: 'fx', label: 'Snap', url: 'audio/groove/fx-snap.wav' },
  ];
  const ROLE_SAMPLE_OPTIONS = {
    kick: ['kick-vintage', 'kick-damped'],
    snare: ['snare-dusty', 'snare-handclap', 'snare-tamb'],
    hat: ['hat-vintage', 'hat-brush'],
    fx: ['fx-tambourine', 'fx-cabasa', 'fx-conga', 'fx-claves', 'fx-snap'],
  };

  // Each step stores a velocity (0 = off, otherwise the sample's playback gain) rather than a
  // plain boolean, so a tap cycles through off -> soft -> medium -> accent -> off instead of
  // just on/off -- no drag gesture needed, which would be fiddly on small touch targets.
  // Wide enough to make "accent" actually pop against "medium" (previously 0.8 -> 1 was only
  // ~2dB, barely audible). A shared limiter on the groove bus (see ensureGrooveMaster) keeps
  // the louder end from clipping even though it nominally exceeds the samples' normalized peak.
  const VELOCITY_LEVELS = [0, 0.35, 0.75, 1.6];
  const VELOCITY_SOFT = VELOCITY_LEVELS[1];
  const VELOCITY_MEDIUM = VELOCITY_LEVELS[2];
  const VELOCITY_ACCENT = VELOCITY_LEVELS[3];

  function emptySteps() { return new Array(STEPS_PER_BAR).fill(0); }
  function stepsAt(indices, velocity = VELOCITY_MEDIUM) {
    const s = emptySteps();
    indices.forEach((i) => { s[i] = velocity; });
    return s;
  }
  function mergeSteps(...groups) {
    const s = emptySteps();
    groups.forEach(([indices, velocity]) => indices.forEach((i) => { s[i] = velocity; }));
    return s;
  }
  function grooveVelocityClass(v) {
    if (!v) return '';
    if (v >= VELOCITY_ACCENT) return 'vel-accent';
    if (v >= VELOCITY_MEDIUM) return 'vel-medium';
    return 'vel-soft';
  }

  // Original patterns authored for this app -- standard genre rhythm idioms (four-on-the-floor,
  // boom-bap, etc.) are generic musical conventions, not copied step data from any other app.
  const BUILTIN_GROOVE_PRESETS = [
    {
      id: 'house-four-floor', name: 'Four on the Floor', genre: 'House', bpm: 124, swing: 0,
      tracks: [
        { role: 'kick', sampleId: 'kick-vintage', steps: mergeSteps([[0], VELOCITY_ACCENT], [[4, 8, 12], VELOCITY_MEDIUM]) },
        { role: 'snare', sampleId: 'snare-handclap', steps: stepsAt([4, 12]) },
        { role: 'hat', sampleId: 'hat-vintage', steps: stepsAt([2, 6, 10, 14]) },
        { role: 'fx', sampleId: 'fx-claves', steps: emptySteps() },
      ],
    },
    {
      id: 'hiphop-boom-bap', name: 'Boom Bap', genre: 'Hip-Hop', bpm: 90, swing: 0.08,
      tracks: [
        { role: 'kick', sampleId: 'kick-damped', steps: stepsAt([0, 6, 10]) },
        { role: 'snare', sampleId: 'snare-dusty', steps: stepsAt([4, 12]) },
        { role: 'hat', sampleId: 'hat-brush', steps: stepsAt([0, 2, 4, 6, 8, 10, 12, 14]) },
        { role: 'fx', sampleId: 'fx-snap', steps: emptySteps() },
      ],
    },
    {
      id: 'funk-pocket', name: 'Funk Pocket', genre: 'Funk', bpm: 104, swing: 0.16,
      tracks: [
        { role: 'kick', sampleId: 'kick-vintage', steps: stepsAt([0, 3, 8, 11]) },
        { role: 'snare', sampleId: 'snare-tamb', steps: mergeSteps([[4, 12], VELOCITY_ACCENT], [[14], VELOCITY_SOFT]) },
        { role: 'hat', sampleId: 'hat-vintage', steps: stepsAt([0, 2, 4, 6, 8, 10, 12, 14]) },
        { role: 'fx', sampleId: 'fx-cabasa', steps: stepsAt([6]) },
      ],
    },
    {
      id: 'garage-skip', name: 'Garage Skip', genre: 'UK Garage', bpm: 130, swing: 0.2,
      tracks: [
        { role: 'kick', sampleId: 'kick-damped', steps: stepsAt([0, 7, 10]) },
        { role: 'snare', sampleId: 'snare-handclap', steps: stepsAt([4, 12]) },
        { role: 'hat', sampleId: 'hat-brush', steps: stepsAt([2, 6, 10, 14]) },
        { role: 'fx', sampleId: 'fx-conga', steps: stepsAt([9]) },
      ],
    },
  ];

  function cloneGroovePattern(p) {
    return {
      id: p.id, name: p.name, genre: p.genre, bpm: p.bpm, swing: p.swing,
      tracks: p.tracks.map((t) => ({ role: t.role, sampleId: t.sampleId, steps: t.steps.slice() })),
    };
  }

  let root;
  let state = { bpm: DEFAULT_BPM, sound: 'kick', countLength: DEFAULT_COUNT_LENGTH, playing: false, videoExpanded: false, mode: 'classic', grooveAccentMode: false };
  let audioCtx = null;
  let schedulerTimer = null;
  let nextNoteTime = 0;
  let beatCounter = 0;
  let wakeLock = null;
  let pulseEl = null;
  let countEl = null;
  let groovePattern = cloneGroovePattern(BUILTIN_GROOVE_PRESETS[0]);
  let grooveActivePresetId = BUILTIN_GROOVE_PRESETS[0].id;
  let customGroovePresets = [];
  let grooveStepIndex = 0;
  let grooveBuffers = {};
  let grooveBuffersLoading = null;
  let grooveMasterNode = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Number.isFinite(saved.bpm)) state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, saved.bpm));
        if (saved.sound && SOUNDS.some((s) => s.id === saved.sound)) state.sound = saved.sound;
        if (COUNT_LENGTHS.includes(saved.countLength)) state.countLength = saved.countLength;
        if (saved.mode === 'groove' || saved.mode === 'classic') state.mode = saved.mode;
        if (typeof saved.grooveAccentMode === 'boolean') state.grooveAccentMode = saved.grooveAccentMode;
        if (saved.groovePattern && Array.isArray(saved.groovePattern.tracks)) {
          groovePattern = saved.groovePattern;
          grooveActivePresetId = saved.grooveActivePresetId || null;
        }
      }
    } catch (err) { /* ignore */ }
    try {
      const rawPresets = localStorage.getItem(GROOVE_CUSTOM_PRESETS_KEY);
      if (rawPresets) customGroovePresets = JSON.parse(rawPresets);
    } catch (err) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        bpm: state.bpm, sound: state.sound, countLength: state.countLength,
        mode: state.mode, grooveAccentMode: state.grooveAccentMode, groovePattern, grooveActivePresetId,
      }));
    } catch (err) { /* ignore */ }
  }

  function saveCustomGroovePresets() {
    try { localStorage.setItem(GROOVE_CUSTOM_PRESETS_KEY, JSON.stringify(customGroovePresets)); } catch (err) { /* ignore */ }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Sound synthesis ----------

  function ensureAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // A single limiter all Groove samples route through, so an accented hit (deliberately
  // louder than the samples' own normalized peak, to make it actually sound accented) gets
  // caught cleanly instead of clipping, rather than needing to keep every velocity level
  // conservative enough to never exceed 0dBFS on its own.
  function ensureGrooveMaster() {
    if (grooveMasterNode) return grooveMasterNode;
    const ctx = ensureAudioContext();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-6, ctx.currentTime);
    limiter.knee.setValueAtTime(0, ctx.currentTime);
    limiter.ratio.setValueAtTime(20, ctx.currentTime);
    limiter.attack.setValueAtTime(0.001, ctx.currentTime);
    limiter.release.setValueAtTime(0.1, ctx.currentTime);
    limiter.connect(ctx.destination);
    grooveMasterNode = limiter;
    return grooveMasterNode;
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

  // ---------- Groove sample playback ----------

  function ensureGrooveBuffersLoaded() {
    if (grooveBuffersLoading) return grooveBuffersLoading;
    const ctx = ensureAudioContext();
    grooveBuffersLoading = Promise.all(GROOVE_SAMPLES.map(async (s) => {
      if (grooveBuffers[s.id]) return;
      const res = await fetch(s.url);
      const arrayBuffer = await res.arrayBuffer();
      grooveBuffers[s.id] = await ctx.decodeAudioData(arrayBuffer);
    }));
    return grooveBuffersLoading;
  }

  function playGrooveSample(sampleId, time, velocity = VELOCITY_ACCENT) {
    const buffer = grooveBuffers[sampleId];
    if (!buffer) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(velocity, time);
    src.connect(gain).connect(ensureGrooveMaster());
    src.start(time);
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

  // Highlights every cell in one column of the step grid (across all roles) so the dancer
  // can see exactly which 16th note is sounding right now, not just which beat (1-4).
  // Queried fresh each time rather than cached, since render() fully replaces the grid's DOM
  // on every edit.
  function updateGroovePlayheadColumn(idx) {
    document.querySelectorAll('.groove-step.playhead-col').forEach((el) => el.classList.remove('playhead-col'));
    if (idx == null) return;
    document.querySelectorAll(`[data-groove-step$=":${idx}"]`).forEach((el) => el.classList.add('playhead-col'));
  }

  function scheduleGroovePlayhead(time, idx) {
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => updateGroovePlayheadColumn(idx), delayMs);
  }

  function scheduler() {
    if (state.mode === 'groove') return schedulerGroove();
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      playClick(nextNoteTime);
      schedulePulse(nextNoteTime);
      beatCounter = (beatCounter % state.countLength) + 1;
      scheduleCountDisplay(nextNoteTime, beatCounter);
      nextNoteTime += 60 / state.bpm;
    }
  }

  // A 16th-note step sequencer instead of one sound per beat: each step looks up which
  // role-tracks are active in the current pattern and fires each one's sample. Swing keeps
  // each on/off-beat 16th pair summing to exactly 2 * interval (so tempo never drifts) while
  // delaying every off-beat step by the swing fraction, the standard shuffle technique.
  function schedulerGroove() {
    const interval = 60 / state.bpm / 4;
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      const idx = grooveStepIndex % STEPS_PER_BAR;
      for (const track of groovePattern.tracks) {
        const velocity = track.steps[idx];
        if (velocity) playGrooveSample(track.sampleId, nextNoteTime, velocity);
      }
      if (idx % 4 === 0) schedulePulse(nextNoteTime);
      scheduleCountDisplay(nextNoteTime, Math.floor(idx / 4) + 1);
      scheduleGroovePlayhead(nextNoteTime, idx);
      const swing = groovePattern.swing || 0;
      nextNoteTime += (idx % 2 === 0) ? interval * (1 + swing) : interval * (1 - swing);
      grooveStepIndex++;
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

  async function startPlaying() {
    ensureAudioContext();
    if (state.mode === 'groove') {
      await ensureGrooveBuffersLoaded();
      grooveStepIndex = 0;
    } else {
      beatCounter = 0;
    }
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
    if (countEl) countEl.textContent = '–';
    updateGroovePlayheadColumn(null);
  }

  function togglePlay() {
    if (state.playing) stopPlaying(); else startPlaying();
  }

  function setBpm(value) {
    state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, value));
    saveSettings();
    render();
  }

  // ---------- Groove Lab editing ----------

  function setMetroMode(mode) {
    if (state.mode === mode) return;
    if (state.playing) stopPlaying();
    state.mode = mode;
    saveSettings();
    render();
  }

  function cycleGrooveStep(role, index) {
    const track = groovePattern.tracks.find((t) => t.role === role);
    if (!track) return;
    if (state.grooveAccentMode) {
      const current = VELOCITY_LEVELS.indexOf(track.steps[index]);
      const nextIdx = ((current === -1 ? 0 : current) + 1) % VELOCITY_LEVELS.length;
      track.steps[index] = VELOCITY_LEVELS[nextIdx];
    } else {
      // Plain on/off: one tap to add a beat, one tap to remove it, instead of cycling
      // through every velocity tier to get back to off.
      track.steps[index] = track.steps[index] ? 0 : VELOCITY_MEDIUM;
    }
    grooveActivePresetId = null;
    saveSettings();
    render();
  }

  function cycleGrooveSample(role) {
    const track = groovePattern.tracks.find((t) => t.role === role);
    if (!track) return;
    const options = ROLE_SAMPLE_OPTIONS[role];
    const idx = options.indexOf(track.sampleId);
    track.sampleId = options[(idx + 1) % options.length];
    grooveActivePresetId = null;
    saveSettings();
    render();
  }

  function loadGroovePreset(id) {
    const preset = BUILTIN_GROOVE_PRESETS.find((p) => p.id === id) || customGroovePresets.find((p) => p.id === id);
    if (!preset) return;
    groovePattern = cloneGroovePattern(preset);
    grooveActivePresetId = id;
    state.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, preset.bpm));
    saveSettings();
    render();
  }

  function clearGroovePattern() {
    groovePattern.tracks.forEach((t) => { t.steps = emptySteps(); });
    grooveActivePresetId = null;
    saveSettings();
    render();
  }

  function setGrooveSwing(value) {
    groovePattern.swing = value;
    grooveActivePresetId = null;
    saveSettings();
    render();
  }

  function setGrooveAccentMode(enabled) {
    state.grooveAccentMode = enabled;
    saveSettings();
    render();
  }

  function saveCurrentAsGroovePreset() {
    const name = prompt('Name this pattern:', 'My Pattern');
    if (!name || !name.trim()) return;
    const preset = {
      id: 'custom-' + DB.uid(),
      name: name.trim(),
      genre: 'Custom',
      bpm: state.bpm,
      swing: groovePattern.swing || 0,
      tracks: groovePattern.tracks.map((t) => ({ role: t.role, sampleId: t.sampleId, steps: t.steps.slice() })),
    };
    customGroovePresets.push(preset);
    saveCustomGroovePresets();
    grooveActivePresetId = preset.id;
    saveSettings();
    render();
  }

  function deleteCustomGroovePreset(id) {
    if (!confirm('Delete this preset? This can\'t be undone.')) return;
    customGroovePresets = customGroovePresets.filter((p) => p.id !== id);
    saveCustomGroovePresets();
    if (grooveActivePresetId === id) {
      grooveActivePresetId = null;
      saveSettings();
    }
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

  function classicSectionHtml() {
    return `
      <div class="metro-tap-row">
        <button class="btn-tap" data-action="tap-tempo">TAP</button>
      </div>
      <div class="tag-label" style="text-align:center;">Tap at least twice in rhythm to set the tempo</div>

      <div class="tag-label" style="text-align:center;">Sound</div>
      <div class="tag-buttons" style="justify-content:center;">
        ${SOUNDS.map((s) => `<button class="chip ${state.sound === s.id ? 'active' : ''}" data-sound="${s.id}">${s.label}</button>`).join('')}
      </div>

      <div class="tag-label" style="text-align:center;">Count</div>
      <div class="tag-buttons" style="justify-content:center;">
        ${COUNT_LENGTHS.map((n) => `<button class="chip ${state.countLength === n ? 'active' : ''}" data-count-length="${n}">${n}-count</button>`).join('')}
      </div>
    `;
  }

  function grooveSectionHtml() {
    const allPresets = [...BUILTIN_GROOVE_PRESETS, ...customGroovePresets];
    return `
      <div class="tag-label" style="text-align:center;">Preset</div>
      <div class="tag-buttons" style="justify-content:center;">
        ${allPresets.map((p) => {
          const chipBtn = `<button class="chip ${grooveActivePresetId === p.id ? 'active' : ''}" data-groove-preset="${p.id}">${escapeHtml(p.name)}</button>`;
          const isCustom = customGroovePresets.some((cp) => cp.id === p.id);
          if (!isCustom) return chipBtn;
          return `<span class="groove-preset-chip">${chipBtn}<button class="chip-del" data-groove-preset-del="${p.id}" title="Delete preset">✕</button></span>`;
        }).join('')}
      </div>

      <div class="tag-label" style="text-align:center;">Swing</div>
      <div class="tag-buttons" style="justify-content:center;">
        ${SWING_OPTIONS.map((s) => `<button class="chip ${Math.abs((groovePattern.swing || 0) - s) < 0.001 ? 'active' : ''}" data-groove-swing="${s}">${Math.round(s * 100)}%</button>`).join('')}
      </div>

      <div style="display:flex; justify-content:center; margin:12px 0 2px;">
        <label class="switch">
          <input type="checkbox" id="groove-accent-toggle" ${state.grooveAccentMode ? 'checked' : ''} />
          <span>Accent levels</span>
        </label>
      </div>
      <div class="tag-label" style="text-align:center;">
        ${state.grooveAccentMode ? 'Tap a step to cycle: off → soft → medium → accent' : 'Tap a step to toggle it on or off'}
      </div>
      <div class="groove-grid">
        ${GROOVE_ROLES.map((role) => {
          const track = groovePattern.tracks.find((t) => t.role === role);
          const sampleLabel = GROOVE_SAMPLES.find((s) => s.id === track.sampleId)?.label || '';
          return `
            <div class="groove-row">
              <button class="groove-role-label" data-groove-cycle-sample="${role}">
                <span class="groove-role-name">${GROOVE_ROLE_LABELS[role]}</span>
                <span class="groove-sample-name">${escapeHtml(sampleLabel)}</span>
              </button>
              <div class="groove-steps">
                ${track.steps.map((v, i) => `<button class="groove-step ${grooveVelocityClass(v)} ${i % 4 === 0 ? 'groove-step-beat' : ''}" data-groove-step="${role}:${i}"></button>`).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="metro-transport" style="margin-top: 4px; gap: 10px;">
        <button class="btn btn-small" data-action="clear-groove-pattern">Clear</button>
        <button class="btn btn-small" data-action="save-groove-preset">Save as preset</button>
      </div>
    `;
  }

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

        <div class="tag-buttons" style="justify-content:center; margin: 14px 0 4px;">
          <button class="chip ${state.mode === 'classic' ? 'active' : ''}" data-metro-mode="classic">Classic</button>
          <button class="chip ${state.mode === 'groove' ? 'active' : ''}" data-metro-mode="groove">Groove</button>
        </div>

        ${state.mode === 'groove' ? grooveSectionHtml() : classicSectionHtml()}

        <div class="metro-count-display">
          <span class="metro-count-value" id="metro-count-value">–</span>
          <span class="metro-count-label">/ ${state.mode === 'groove' ? 4 : state.countLength}</span>
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
    const soundId = e.target.closest('[data-sound]')?.dataset.sound;
    const countLength = e.target.closest('[data-count-length]')?.dataset.countLength;
    const bpmDelta = e.target.closest('[data-bpm-delta]')?.dataset.bpmDelta;
    const rhythmSpeed = e.target.closest('[data-rhythm-speed]')?.dataset.rhythmSpeed;
    const metroMode = e.target.closest('[data-metro-mode]')?.dataset.metroMode;
    const groovePreset = e.target.closest('[data-groove-preset]')?.dataset.groovePreset;
    const groovePresetDel = e.target.closest('[data-groove-preset-del]')?.dataset.groovePresetDel;
    const grooveSwing = e.target.closest('[data-groove-swing]')?.dataset.grooveSwing;
    const grooveStep = e.target.closest('[data-groove-step]')?.dataset.grooveStep;
    const grooveCycleSample = e.target.closest('[data-groove-cycle-sample]')?.dataset.grooveCycleSample;
    const action = e.target.closest('[data-action]')?.dataset.action;

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
    if (metroMode) {
      return setMetroMode(metroMode);
    }
    if (groovePresetDel) {
      return deleteCustomGroovePreset(groovePresetDel);
    }
    if (groovePreset) {
      return loadGroovePreset(groovePreset);
    }
    if (grooveSwing != null) {
      return setGrooveSwing(Number(grooveSwing));
    }
    if (grooveStep) {
      const [role, idx] = grooveStep.split(':');
      return cycleGrooveStep(role, Number(idx));
    }
    if (grooveCycleSample) {
      return cycleGrooveSample(grooveCycleSample);
    }

    switch (action) {
      case 'toggle-metro-play':
        return togglePlay();
      case 'tap-tempo':
        return handleTapTempo();
      case 'toggle-rhythm-example':
        state.videoExpanded = !state.videoExpanded;
        return render();
      case 'clear-groove-pattern':
        return clearGroovePattern();
      case 'save-groove-preset':
        return saveCurrentAsGroovePreset();
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
    if (e.target.id === 'groove-accent-toggle') {
      setGrooveAccentMode(e.target.checked);
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
