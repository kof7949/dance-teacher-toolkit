// Music & Count screen: load audio, draw waveform, pitch-preserving slow-down, loop region, count tags.
const Music = (() => {
  const el = {};
  let currentSong = null; // { id, name, blob, duration, peaks }
  let objectUrl = null;
  let loopStart = null;
  let loopEnd = null;

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
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
    el.btnDeleteSong = document.getElementById('btn-delete-song');
    el.nudgeInMinus = document.getElementById('btn-nudge-in-minus');
    el.nudgeInPlus = document.getElementById('btn-nudge-in-plus');
    el.nudgeOutMinus = document.getElementById('btn-nudge-out-minus');
    el.nudgeOutPlus = document.getElementById('btn-nudge-out-plus');
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
    el.audio.src = objectUrl;
    el.audio.playbackRate = Number(el.speedSlider.value) / 100;
    el.audio.preservesPitch = true;
    el.audio.mozPreservesPitch = true;
    el.audio.webkitPreservesPitch = true;
    el.btnPlay.disabled = false;
    el.btnPlay.textContent = '▶';
    loopStart = null;
    loopEnd = null;
    el.loopEnabled.checked = false;
    hideLoopRegion();
    drawWaveform(song.peaks);
    el.timeTotal.textContent = fmtTime(song.duration);
    const tags = await DB.getAllByIndex('counts', 'bySong', song.id);
    renderTags(tags.sort((a, b) => a.time - b.time));
  }

  function updateNudgeButtonsState() {
    el.nudgeInMinus.disabled = loopStart == null;
    el.nudgeInPlus.disabled = loopStart == null;
    el.nudgeOutMinus.disabled = loopEnd == null;
    el.nudgeOutPlus.disabled = loopEnd == null;
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
      el.audio.currentTime = loopStart;
    } else {
      if (loopEnd == null) return;
      const minVal = loopStart != null ? Math.min(dur, loopStart + 0.05) : 0;
      loopEnd = Math.max(minVal, Math.min(dur, loopEnd + delta));
      el.audio.currentTime = loopEnd;
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

  async function addTag(label) {
    if (!currentSong) return;
    const tag = { id: DB.uid(), songId: currentSong.id, time: el.audio.currentTime, label };
    await DB.put('counts', tag);
    const tags = await DB.getAllByIndex('counts', 'bySong', currentSong.id);
    renderTags(tags.sort((a, b) => a.time - b.time));
  }

  function setSpeed(pct) {
    pct = Math.min(100, Math.max(50, Number(pct)));
    el.speedSlider.value = pct;
    el.speedValue.textContent = pct + '%';
    el.audio.playbackRate = pct / 100;
    el.speedChips.forEach((c) => c.classList.toggle('active', Number(c.dataset.speed) === pct));
  }

  function wireEvents() {
    el.songFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const arrayBuffer = await file.arrayBuffer();
      const { peaks, duration } = await decodePeaks(arrayBuffer);
      const song = {
        id: DB.uid(),
        name: file.name.replace(/\.[a-zA-Z0-9]+$/, ''),
        blob: file,
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
      if (el.audio.paused) {
        el.audio.play();
        el.btnPlay.textContent = '⏸';
      } else {
        el.audio.pause();
        el.btnPlay.textContent = '▶';
      }
    });

    el.audio.addEventListener('ended', () => { el.btnPlay.textContent = '▶'; });

    el.audio.addEventListener('timeupdate', () => {
      el.timeCurrent.textContent = fmtTime(el.audio.currentTime);
      if (currentSong && currentSong.duration) {
        const pct = (el.audio.currentTime / currentSong.duration) * 100;
        el.playhead.style.left = pct + '%';
        el.playhead.hidden = false;
      }
      if (el.loopEnabled.checked && loopStart != null && loopEnd != null) {
        const hi = Math.max(loopStart, loopEnd);
        const lo = Math.min(loopStart, loopEnd);
        if (el.audio.currentTime >= hi || el.audio.currentTime < lo) {
          el.audio.currentTime = lo;
        }
      }
    });

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
      el.audio.currentTime = scrubTime;
    });
    el.waveWrap.addEventListener('pointercancel', () => {
      scrubbing = false;
      el.scrubMarker.hidden = true;
      el.scrubTooltip.hidden = true;
    });

    el.btnLoopStart.addEventListener('click', () => {
      if (!currentSong) return;
      loopStart = el.audio.currentTime;
      updateLoopRegionUI();
    });
    el.btnLoopEnd.addEventListener('click', () => {
      if (!currentSong) return;
      loopEnd = el.audio.currentTime;
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
        el.audio.currentTime = Number(seekBtn.dataset.seek);
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
  }

  async function init() {
    cacheEls();
    wireEvents();
    setSpeed(100);
    await populateSongSelect();
  }

  return { init, onShow: redrawWaveformIfNeeded };
})();
