// Music & Count screen: load audio, draw waveform, pitch-preserving slow-down, loop region, count tags.
const Music = (() => {
  const el = {};
  let currentSong = null; // { id, name, blob, duration, peaks }
  let objectUrl = null;
  let loopStart = null;
  let loopEnd = null;
  let currentTags = [];

  const BEAT_HUD_SETTINGS_KEY = 'dance-toolkit-beathud-settings';
  let beatHud = { visible: false, x: null, y: null };

  function loadBeatHudSettings() {
    try {
      const raw = localStorage.getItem(BEAT_HUD_SETTINGS_KEY);
      if (raw) Object.assign(beatHud, JSON.parse(raw));
    } catch (err) { /* ignore */ }
  }

  function saveBeatHudSettings() {
    try { localStorage.setItem(BEAT_HUD_SETTINGS_KEY, JSON.stringify(beatHud)); } catch (err) { /* ignore */ }
  }

  function activeMedia() {
    return currentSong && currentSong.kind === 'video' ? el.video : el.audio;
  }

  function probeVideoDuration(blob) {
    return new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = URL.createObjectURL(blob);
      probe.onloadedmetadata = () => {
        const duration = probe.duration;
        URL.revokeObjectURL(probe.src);
        resolve(duration);
      };
    });
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function fmtTimePrecise(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return m + ':' + s;
  }

  function cacheEls() {
    el.songSelect = document.getElementById('song-select');
    el.songFile = document.getElementById('song-file');
    el.waveform = document.getElementById('waveform');
    el.waveWrap = document.querySelector('.waveform-wrap');
    el.loopRegion = document.getElementById('loop-region');
    el.loopInMarker = document.getElementById('loop-in-marker');
    el.loopOutMarker = document.getElementById('loop-out-marker');
    el.playhead = document.getElementById('playhead');
    el.scrubMarker = document.getElementById('scrub-marker');
    el.scrubTooltip = document.getElementById('scrub-tooltip');
    el.timeCurrent = document.getElementById('time-current');
    el.timeTotal = document.getElementById('time-total');
    el.btnPlay = document.getElementById('btn-play');
    el.btnLoopStart = document.getElementById('btn-loop-start');
    el.btnLoopEnd = document.getElementById('btn-loop-end');
    el.loopEnabled = document.getElementById('loop-enabled');
    el.btnClearLoop = document.getElementById('btn-clear-loop');
    el.speedSlider = document.getElementById('speed-slider');
    el.speedValue = document.getElementById('speed-value');
    el.speedChips = Array.from(document.querySelectorAll('.speed-chip'));
    el.tagCustomLabel = document.getElementById('tag-custom-label');
    el.btnTagCustom = document.getElementById('btn-tag-custom');
    el.tagNumBtns = Array.from(document.querySelectorAll('.tag-num'));
    el.tagList = document.getElementById('tag-list');
    el.audio = document.getElementById('audio-player');
    el.video = document.getElementById('video-player');
    el.btnDeleteSong = document.getElementById('btn-delete-song');
    el.nudgeInMinus = document.getElementById('btn-nudge-in-minus');
    el.nudgeInPlus = document.getElementById('btn-nudge-in-plus');
    el.nudgeOutMinus = document.getElementById('btn-nudge-out-minus');
    el.nudgeOutPlus = document.getElementById('btn-nudge-out-plus');
    el.loopInTime = document.getElementById('loop-in-time');
    el.loopOutTime = document.getElementById('loop-out-time');
    el.beatHud = document.getElementById('beat-hud');
    el.beatHudValue = document.getElementById('beat-hud-value');
    el.btnToggleBeatHud = document.getElementById('btn-toggle-beathud');
  }

  async function decodePeaks(arrayBuffer, buckets = 320) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const audioBuf = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const data = audioBuf.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(data.length / buckets));
      const peaks = [];
      for (let i = 0; i < buckets; i++) {
        let max = 0;
        const start = i * blockSize;
        const end = Math.min(data.length, start + blockSize);
        for (let j = start; j < end; j++) {
          const v = Math.abs(data[j]);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      return { peaks, duration: audioBuf.duration };
    } finally {
      ctx.close();
    }
  }

  function drawWaveform(peaks) {
    const canvas = el.waveform;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!peaks || !peaks.length) return;
    const mid = rect.height / 2;
    const barW = rect.width / peaks.length;
    ctx.fillStyle = '#a855f7';
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(2, peaks[i] * rect.height * 0.92);
      ctx.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 1), h);
    }
  }

  function redrawWaveformIfNeeded() {
    if (currentSong && currentSong.peaks) drawWaveform(currentSong.peaks);
  }

  async function populateSongSelect(selectId) {
    const songs = await DB.getAll('songs');
    el.songSelect.innerHTML = '<option value="">No song loaded</option>' +
      songs.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    if (selectId) el.songSelect.value = selectId;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function loadSong(id) {
    if (!id) {
      currentSong = null;
      el.audio.removeAttribute('src');
      el.video.removeAttribute('src');
      el.video.hidden = true;
      el.waveform.hidden = false;
      el.btnPlay.disabled = true;
      drawWaveform([]);
      renderTags([]);
      return;
    }
    const song = await DB.get('songs', id);
    if (!song) return;
    currentSong = song;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(song.blob);
    const isVideo = song.kind === 'video';
    const media = isVideo ? el.video : el.audio;
    (isVideo ? el.audio : el.video).removeAttribute('src');
    media.src = objectUrl;
    media.playbackRate = Number(el.speedSlider.value) / 100;
    media.preservesPitch = true;
    media.mozPreservesPitch = true;
    media.webkitPreservesPitch = true;
    el.video.hidden = !isVideo;
    el.waveform.hidden = isVideo;
    el.btnPlay.disabled = false;
    el.btnPlay.textContent = '▶';
    loopStart = null;
    loopEnd = null;
    el.loopEnabled.checked = false;
    hideLoopRegion();
    drawWaveform(isVideo ? [] : song.peaks);
    el.timeTotal.textContent = fmtTime(song.duration);
    const tags = await DB.getAllByIndex('counts', 'bySong', song.id);
    renderTags(tags.sort((a, b) => a.time - b.time));
  }

  // Lets another screen (a Reference note linking to a video moment) load a song and jump
  // straight to a timestamp. Setting .currentTime right after assigning .src can be ignored
  // by the browser before metadata has loaded, so this waits for that when necessary.
  async function loadAndSeek(id, time) {
    await loadSong(id);
    el.songSelect.value = id;
    const media = activeMedia();
    const seek = () => { media.currentTime = time; };
    if (media.readyState >= 1) seek();
    else media.addEventListener('loadedmetadata', seek, { once: true });
  }

  function updateNudgeButtonsState() {
    el.nudgeInMinus.disabled = loopStart == null;
    el.nudgeInPlus.disabled = loopStart == null;
    el.nudgeOutMinus.disabled = loopEnd == null;
    el.nudgeOutPlus.disabled = loopEnd == null;
    el.loopInTime.textContent = loopStart == null ? '--' : fmtTimePrecise(loopStart);
    el.loopOutTime.textContent = loopEnd == null ? '--' : fmtTimePrecise(loopEnd);
  }

  function hideLoopRegion() {
    el.loopRegion.hidden = true;
    el.loopInMarker.hidden = true;
    el.loopOutMarker.hidden = true;
    updateNudgeButtonsState();
  }

  function updateLoopRegionUI() {
    if (!currentSong) { hideLoopRegion(); return; }
    const dur = currentSong.duration || 1;
    updateNudgeButtonsState();

    if (loopStart != null && loopEnd != null) {
      el.loopInMarker.hidden = true;
      el.loopOutMarker.hidden = true;
      const left = (Math.min(loopStart, loopEnd) / dur) * 100;
      const width = (Math.abs(loopEnd - loopStart) / dur) * 100;
      el.loopRegion.style.left = left + '%';
      el.loopRegion.style.width = width + '%';
      el.loopRegion.hidden = false;
      return;
    }

    el.loopRegion.hidden = true;
    if (loopStart != null) {
      el.loopInMarker.style.left = ((loopStart / dur) * 100) + '%';
      el.loopInMarker.hidden = false;
    } else {
      el.loopInMarker.hidden = true;
    }
    if (loopEnd != null) {
      el.loopOutMarker.style.left = ((loopEnd / dur) * 100) + '%';
      el.loopOutMarker.hidden = false;
    } else {
      el.loopOutMarker.hidden = true;
    }
  }

  function nudgeLoopPoint(which, delta) {
    if (!currentSong) return;
    const dur = currentSong.duration || 0;
    if (which === 'in') {
      if (loopStart == null) return;
      const maxVal = loopEnd != null ? Math.max(0, loopEnd - 0.05) : dur;
      loopStart = Math.min(maxVal, Math.max(0, loopStart + delta));
      activeMedia().currentTime = loopStart;
    } else {
      if (loopEnd == null) return;
      const minVal = loopStart != null ? Math.min(dur, loopStart + 0.05) : 0;
      loopEnd = Math.max(minVal, Math.min(dur, loopEnd + delta));
      activeMedia().currentTime = loopEnd;
    }
    updateLoopRegionUI();
  }

  let scrubbing = false;
  let scrubTime = 0;

  function showScrubAt(clientX) {
    if (!currentSong) return;
    const rect = el.waveWrap.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    scrubTime = pct * currentSong.duration;
    el.scrubMarker.style.left = (pct * 100) + '%';
    el.scrubTooltip.style.left = (pct * 100) + '%';
    el.scrubTooltip.textContent = fmtTime(scrubTime);
  }

  function renderTags(tags) {
    currentTags = tags;
    updateBeatHudVisibility();
    if (!tags.length) {
      el.tagList.innerHTML = '<div class="empty-state">No count markers yet. Play the song and tap a number above.</div>';
      return;
    }
    el.tagList.innerHTML = tags.map((t) => `
      <div class="tag-item" data-id="${t.id}">
        <button class="tag-main" data-seek="${t.time}">
          <span>${escapeHtml(t.label)}</span>
          <span class="tag-time">${fmtTime(t.time)}</span>
        </button>
        <button class="tag-del" data-del="${t.id}">✕</button>
      </div>
    `).join('');
  }

  // Beat HUD: a small floating, draggable counter so a dancer can glance at the current
  // count without looking back at the (often off-screen, while dancing) tag list.
  function updateBeatHudVisibility() {
    const shouldShow = beatHud.visible && currentTags.length > 0;
    el.beatHud.hidden = !shouldShow;
    el.btnToggleBeatHud.textContent = beatHud.visible ? '👁 Hide floating counter' : '👁 Show floating counter';
    if (shouldShow) updateBeatHudValue(activeMedia().currentTime);
  }

  function updateBeatHudValue(currentTime) {
    let active = null;
    for (const t of currentTags) {
      if (t.time <= currentTime) active = t; else break;
    }
    el.beatHudValue.textContent = active ? active.label : '–';
  }

  function applyBeatHudPosition() {
    if (beatHud.x == null || beatHud.y == null) return;
    el.beatHud.style.left = beatHud.x + 'px';
    el.beatHud.style.top = beatHud.y + 'px';
    el.beatHud.style.right = 'auto';
    el.beatHud.style.bottom = 'auto';
  }

  function clampHudPosition(x, y) {
    const rect = el.beatHud.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width);
    const maxY = Math.max(0, window.innerHeight - rect.height);
    return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
  }

  function wireBeatHudDrag() {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    el.beatHud.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.beatHud.classList.add('dragging');
      const rect = el.beatHud.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      try { el.beatHud.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.beatHud.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, y] = clampHudPosition(e.clientX - offsetX, e.clientY - offsetY);
      el.beatHud.style.left = x + 'px';
      el.beatHud.style.top = y + 'px';
      el.beatHud.style.right = 'auto';
      el.beatHud.style.bottom = 'auto';
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      el.beatHud.classList.remove('dragging');
      beatHud.x = parseFloat(el.beatHud.style.left);
      beatHud.y = parseFloat(el.beatHud.style.top);
      saveBeatHudSettings();
    };
    el.beatHud.addEventListener('pointerup', endDrag);
    el.beatHud.addEventListener('pointercancel', endDrag);
  }

  async function addTag(label) {
    if (!currentSong) return;
    const tag = { id: DB.uid(), songId: currentSong.id, time: activeMedia().currentTime, label };
    await DB.put('counts', tag);
    const tags = await DB.getAllByIndex('counts', 'bySong', currentSong.id);
    renderTags(tags.sort((a, b) => a.time - b.time));
  }

  function setSpeed(pct) {
    pct = Math.min(100, Math.max(50, Number(pct)));
    el.speedSlider.value = pct;
    el.speedValue.textContent = pct + '%';
    el.audio.playbackRate = pct / 100;
    el.video.playbackRate = pct / 100;
    el.speedChips.forEach((c) => c.classList.toggle('active', Number(c.dataset.speed) === pct));
  }

  function wireEvents() {
    el.songFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const isVideo = file.type.startsWith('video/');
      let peaks = [];
      let duration;
      if (isVideo) {
        duration = await probeVideoDuration(file);
      } else {
        const arrayBuffer = await file.arrayBuffer();
        ({ peaks, duration } = await decodePeaks(arrayBuffer));
      }
      const song = {
        id: DB.uid(),
        name: file.name.replace(/\.[a-zA-Z0-9]+$/, ''),
        blob: file,
        kind: isVideo ? 'video' : 'audio',
        duration,
        peaks,
      };
      await DB.put('songs', song);
      await populateSongSelect(song.id);
      await loadSong(song.id);
      e.target.value = '';
    });

    el.songSelect.addEventListener('change', () => loadSong(el.songSelect.value));

    el.btnPlay.addEventListener('click', () => {
      const media = activeMedia();
      if (media.paused) {
        media.play();
        el.btnPlay.textContent = '⏸';
      } else {
        media.pause();
        el.btnPlay.textContent = '▶';
      }
    });

    const handleEnded = () => { el.btnPlay.textContent = '▶'; };
    el.audio.addEventListener('ended', handleEnded);
    el.video.addEventListener('ended', handleEnded);

    const handleTimeUpdate = () => {
      const media = activeMedia();
      el.timeCurrent.textContent = fmtTime(media.currentTime);
      if (currentSong && currentSong.duration) {
        const pct = (media.currentTime / currentSong.duration) * 100;
        el.playhead.style.left = pct + '%';
        el.playhead.hidden = false;
      }
      if (el.loopEnabled.checked && loopStart != null && loopEnd != null) {
        const hi = Math.max(loopStart, loopEnd);
        const lo = Math.min(loopStart, loopEnd);
        if (media.currentTime >= hi || media.currentTime < lo) {
          media.currentTime = lo;
        }
      }
      if (!el.beatHud.hidden) updateBeatHudValue(media.currentTime);
    };
    el.audio.addEventListener('timeupdate', handleTimeUpdate);
    el.video.addEventListener('timeupdate', handleTimeUpdate);

    el.waveWrap.addEventListener('pointerdown', (e) => {
      if (!currentSong) return;
      scrubbing = true;
      el.scrubMarker.hidden = false;
      el.scrubTooltip.hidden = false;
      showScrubAt(e.clientX);
      try { el.waveWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.waveWrap.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      showScrubAt(e.clientX);
    });
    el.waveWrap.addEventListener('pointerup', () => {
      if (!scrubbing) return;
      scrubbing = false;
      el.scrubMarker.hidden = true;
      el.scrubTooltip.hidden = true;
      activeMedia().currentTime = scrubTime;
    });
    el.waveWrap.addEventListener('pointercancel', () => {
      scrubbing = false;
      el.scrubMarker.hidden = true;
      el.scrubTooltip.hidden = true;
    });

    el.btnLoopStart.addEventListener('click', () => {
      if (!currentSong) return;
      loopStart = activeMedia().currentTime;
      updateLoopRegionUI();
    });
    el.btnLoopEnd.addEventListener('click', () => {
      if (!currentSong) return;
      loopEnd = activeMedia().currentTime;
      updateLoopRegionUI();
    });
    el.btnClearLoop.addEventListener('click', () => {
      loopStart = null; loopEnd = null;
      el.loopEnabled.checked = false;
      hideLoopRegion();
    });

    el.nudgeInMinus.addEventListener('click', () => nudgeLoopPoint('in', -0.1));
    el.nudgeInPlus.addEventListener('click', () => nudgeLoopPoint('in', 0.1));
    el.nudgeOutMinus.addEventListener('click', () => nudgeLoopPoint('out', -0.1));
    el.nudgeOutPlus.addEventListener('click', () => nudgeLoopPoint('out', 0.1));

    el.speedSlider.addEventListener('input', () => setSpeed(el.speedSlider.value));
    el.speedChips.forEach((chip) => {
      chip.addEventListener('click', () => setSpeed(chip.dataset.speed));
    });

    el.tagNumBtns.forEach((btn) => {
      btn.addEventListener('click', () => addTag(btn.dataset.count));
    });
    el.btnTagCustom.addEventListener('click', () => {
      const label = el.tagCustomLabel.value.trim();
      if (!label) return;
      addTag(label);
      el.tagCustomLabel.value = '';
    });

    el.tagList.addEventListener('click', (e) => {
      const seekBtn = e.target.closest('[data-seek]');
      if (seekBtn) {
        activeMedia().currentTime = Number(seekBtn.dataset.seek);
        return;
      }
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        DB.delete('counts', delBtn.dataset.del).then(async () => {
          const tags = await DB.getAllByIndex('counts', 'bySong', currentSong.id);
          renderTags(tags.sort((a, b) => a.time - b.time));
        });
      }
    });

    el.btnDeleteSong.addEventListener('click', async () => {
      if (!currentSong) return;
      if (!confirm(`Delete "${currentSong.name}" and its count markers? This can't be undone.`)) return;
      const tags = await DB.getAllByIndex('counts', 'bySong', currentSong.id);
      for (const t of tags) await DB.delete('counts', t.id);
      await DB.delete('songs', currentSong.id);
      await populateSongSelect();
      await loadSong('');
    });

    window.addEventListener('resize', redrawWaveformIfNeeded);

    el.btnToggleBeatHud.addEventListener('click', () => {
      beatHud.visible = !beatHud.visible;
      saveBeatHudSettings();
      updateBeatHudVisibility();
    });
    wireBeatHudDrag();
  }

  async function init() {
    cacheEls();
    wireEvents();
    setSpeed(100);
    loadBeatHudSettings();
    applyBeatHudPosition();
    updateBeatHudVisibility();
    await populateSongSelect();
  }

  return { init, onShow: redrawWaveformIfNeeded, loadAndSeek };
})();
