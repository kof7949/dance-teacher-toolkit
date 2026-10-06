// Team Formation screen: build routines containing a sequence of stage formations.
// Dancers are positioned by dragging dots on a stage; switching formations (Prev/Next/Play)
// animates each dot's glide via a CSS transition on left/top, no animation library needed.
const Formation = (() => {
  const COLORS = ['#a855f7', '#ec4899', '#22d3ee', '#fbbf24', '#34d399', '#f87171', '#60a5fa', '#f472b6', '#fb923c', '#a3e635'];

  let root;
  let state = { view: 'list', routineId: null, currentFormationId: null, newDancerColor: COLORS[0], selectedDancerId: null, playing: false, editingFormationName: false };
  let cache = { routines: [], dancers: [], formations: [], positions: {} }; // positions keyed by formationId -> array
  let dragInfo = null;
  let playTimer = null;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function loadRoutines() {
    cache.routines = (await DB.getAll('routines')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function loadRoutineData(routineId) {
    cache.dancers = (await DB.getAllByIndex('dancers', 'byRoutine', routineId)).sort((a, b) => a.order - b.order);
    cache.formations = (await DB.getAllByIndex('formations', 'byRoutine', routineId)).sort((a, b) => a.order - b.order);
    cache.positions = {};
    for (const f of cache.formations) {
      cache.positions[f.id] = await DB.getAllByIndex('positions', 'byFormation', f.id);
    }
    if (!state.currentFormationId || !cache.formations.some((f) => f.id === state.currentFormationId)) {
      state.currentFormationId = cache.formations[0] ? cache.formations[0].id : null;
    }
  }

  async function ensurePositionsForFormation(formationId) {
    if (!formationId) return;
    const existing = cache.positions[formationId] || [];
    const existingDancerIds = new Set(existing.map((p) => p.dancerId));
    for (const dancer of cache.dancers) {
      if (!existingDancerIds.has(dancer.id)) {
        const pos = { id: DB.uid(), formationId, dancerId: dancer.id, x: 50, y: 50, note: '' };
        await DB.put('positions', pos);
        existing.push(pos);
      }
    }
    cache.positions[formationId] = existing;
  }

  function getPosition(formationId, dancerId) {
    const list = cache.positions[formationId] || [];
    return list.find((p) => p.dancerId === dancerId) || { x: 50, y: 50, note: '' };
  }

  // ---------- List view ----------

  function renderList() {
    const rows = cache.routines.map((r) => `
      <div class="student-card" data-open-routine="${r.id}">
        <div>
          <div class="name">${escapeHtml(r.name)}</div>
        </div>
        <button class="btn btn-small" data-open-routine="${r.id}">Open</button>
      </div>
    `).join('') || '<div class="empty-state">No routines yet. Add one below to start planning formations.</div>';

    return `
      <div class="add-row">
        <input type="text" id="new-routine-name" placeholder="New routine name, e.g. Recital 2026" />
      </div>
      <button class="btn btn-small" data-action="add-routine" style="margin-bottom:16px;">Add routine</button>
      <div class="student-list">${rows}</div>
    `;
  }

  // ---------- Editor view ----------

  function stageHtml() {
    const formation = cache.formations.find((f) => f.id === state.currentFormationId);
    const dots = cache.dancers.map((d) => {
      const pos = formation ? getPosition(formation.id, d.id) : { x: 50, y: 50 };
      const selected = state.selectedDancerId === d.id;
      return `
        <div class="dancer-dot ${selected ? 'selected' : ''}" data-dancer-dot="${d.id}"
             style="left:${pos.x}%; top:${pos.y}%; background:${d.color};" title="${escapeHtml(d.name)}">
          <span class="dancer-dot-label">${escapeHtml(d.name)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="stage-wrap">
        <div class="stage" id="stage">
          <div class="stage-label stage-label-up">UPSTAGE</div>
          <div class="stage-label stage-label-down">DOWNSTAGE (audience)</div>
          <div class="stage-label stage-label-sr">STAGE RIGHT</div>
          <div class="stage-label stage-label-sl">STAGE LEFT</div>
          <div class="stage-centerline-v"></div>
          <div class="stage-centerline-h"></div>
          ${dots}
        </div>
      </div>
    `;
  }

  function formationStripHtml() {
    const tabs = cache.formations.map((f, i) => `
      <button class="chip formation-chip ${f.id === state.currentFormationId ? 'active' : ''}" data-open-formation="${f.id}">
        ${escapeHtml(f.label || `Formation ${i + 1}`)}
      </button>
    `).join('');
    return `
      <div class="tag-buttons" style="margin-bottom:10px;" id="formation-strip">
        ${tabs}
        <button class="chip" data-action="add-formation">+ Add formation</button>
      </div>
    `;
  }

  function dancerRosterHtml() {
    const chips = cache.dancers.map((d) => `
      <div class="dancer-chip" style="border-color:${d.color};">
        <span class="dancer-chip-swatch" style="background:${d.color};"></span>
        <span>${escapeHtml(d.name)}</span>
        <button class="dancer-chip-del" data-del-dancer="${d.id}" title="Remove dancer">✕</button>
      </div>
    `).join('') || '<div class="empty-state">No dancers yet. Add one below.</div>';

    const swatches = COLORS.map((c) => `
      <button class="color-swatch ${state.newDancerColor === c ? 'active' : ''}" data-pick-color="${c}" style="background:${c};"></button>
    `).join('');

    return `
      <div class="dancer-roster">${chips}</div>
      <div class="add-row">
        <input type="text" id="new-dancer-name" placeholder="Dancer name" />
        <button class="btn btn-small" data-action="add-dancer">Add</button>
      </div>
      <div class="color-swatches">${swatches}</div>
    `;
  }

  function formationHeaderHtml(formation) {
    if (!formation) return '';
    if (state.editingFormationName) {
      return `
        <div class="add-row" style="margin-bottom:10px;">
          <input type="text" id="edit-formation-name" value="${escapeHtml(formation.label)}" />
          <button class="btn btn-small" data-action="save-formation-name" data-id="${formation.id}">Save</button>
          <button class="btn btn-small btn-text" data-action="cancel-rename-formation">Cancel</button>
        </div>
      `;
    }
    return `
      <div class="back-row" style="margin-bottom:10px;">
        <strong>${escapeHtml(formation.label)}</strong>
        <div style="flex:1"></div>
        <button class="btn btn-small" data-action="rename-formation">✎ Rename</button>
        <button class="btn btn-small btn-danger" data-action="delete-formation" data-id="${formation.id}">🗑 Delete</button>
      </div>
    `;
  }

  function selectedDancerNoteHtml() {
    if (!state.selectedDancerId || !state.currentFormationId) return '';
    const dancer = cache.dancers.find((d) => d.id === state.selectedDancerId);
    if (!dancer) return '';
    const pos = getPosition(state.currentFormationId, dancer.id);
    return `
      <div class="add-row" style="margin-top:10px;">
        <input type="text" id="dancer-note-input" placeholder="Note for ${escapeHtml(dancer.name)}, e.g. 'face downstage'" value="${escapeHtml(pos.note || '')}" />
      </div>
    `;
  }

  function renderEditor() {
    const routine = cache.routines.find((r) => r.id === state.routineId);
    if (!routine) { state.view = 'list'; return renderList(); }
    const formation = cache.formations.find((f) => f.id === state.currentFormationId);

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="back-to-routines">← Back</button>
        <div style="flex:1"></div>
        <button class="btn btn-small btn-danger" data-action="delete-routine" data-id="${routine.id}">Delete routine</button>
      </div>
      <div class="section-title" style="margin-top:0;">${escapeHtml(routine.name)}</div>

      <div class="card">
        <div class="section-title" style="margin-top:0;">Dancers</div>
        ${dancerRosterHtml()}
      </div>

      <div class="card">
        <div class="section-title" style="margin-top:0;">Formations</div>
        ${formationStripHtml()}
        <div id="formation-header-wrap">${formationHeaderHtml(formation)}</div>
        ${cache.dancers.length === 0
          ? '<div class="empty-state">Add some dancers above before building a formation.</div>'
          : (!formation ? '<div class="empty-state">Tap "+ Add formation" to place your first formation.</div>' : stageHtml())}
        ${formation ? `
          <div class="transport-row" style="margin-top:14px;">
            <button class="btn btn-ghost" data-action="prev-formation" ${cache.formations.length < 2 ? 'disabled' : ''}>◀ Prev</button>
            <button class="btn btn-play" data-action="toggle-play" ${cache.formations.length < 2 ? 'disabled' : ''}>${state.playing ? '⏸' : '▶'}</button>
            <button class="btn btn-ghost" data-action="next-formation" ${cache.formations.length < 2 ? 'disabled' : ''}>Next ▶</button>
          </div>
          <div class="tag-label" style="text-align:center;margin-top:6px;">Tap a dancer dot to add a note for this formation</div>
          <div id="formation-note-wrap">${selectedDancerNoteHtml()}</div>
        ` : ''}
      </div>

      ${formation ? `
        <div class="card">
          <div class="section-title" style="margin-top:0;">Export</div>
          <button class="btn btn-small" data-action="export-formation-pdf">⬇ Download PDF (all formations)</button>
          <div id="formation-export-output"></div>
        </div>
      ` : ''}
    `;
  }

  async function render() {
    if (state.view === 'editor' && state.routineId) {
      await loadRoutineData(state.routineId);
      await ensurePositionsForFormation(state.currentFormationId);
      root.innerHTML = renderEditor();
    } else {
      state.view = 'list';
      await loadRoutines();
      root.innerHTML = renderList();
    }
  }

  // ---------- Playback / switching ----------

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    state.playing = false;
  }

  async function switchToFormation(formationId) {
    state.currentFormationId = formationId;
    state.selectedDancerId = null;
    state.editingFormationName = false;
    await ensurePositionsForFormation(formationId);

    // Update each existing dot's left/top in place (rather than recreating the stage)
    // so the CSS left/top transition actually has a prior value to animate from.
    const stage = document.getElementById('stage');
    if (stage) {
      cache.dancers.forEach((d) => {
        const dot = stage.querySelector(`[data-dancer-dot="${d.id}"]`);
        if (!dot) return;
        const pos = getPosition(formationId, d.id);
        dot.style.left = pos.x + '%';
        dot.style.top = pos.y + '%';
        dot.classList.remove('selected');
      });
    }

    const strip = document.getElementById('formation-strip');
    if (strip) strip.outerHTML = formationStripHtml();
    const headerWrap = document.getElementById('formation-header-wrap');
    if (headerWrap) headerWrap.innerHTML = formationHeaderHtml(cache.formations.find((f) => f.id === formationId));
    const noteWrap = document.getElementById('formation-note-wrap');
    if (noteWrap) noteWrap.innerHTML = selectedDancerNoteHtml();
  }

  function stepFormation(delta) {
    if (cache.formations.length < 2) return;
    const idx = cache.formations.findIndex((f) => f.id === state.currentFormationId);
    const nextIdx = (idx + delta + cache.formations.length) % cache.formations.length;
    switchToFormation(cache.formations[nextIdx].id);
  }

  function togglePlay() {
    if (state.playing) { stopPlay(); render(); return; }
    if (cache.formations.length < 2) return;
    state.playing = true;
    playTimer = setInterval(() => stepFormation(1), 2200);
    render();
  }

  // ---------- Dragging dots ----------

  function wireDrag() {
    root.addEventListener('pointerdown', (e) => {
      const dot = e.target.closest('.dancer-dot');
      if (!dot) return;
      const stage = document.getElementById('stage');
      if (!stage) return;
      e.preventDefault();
      dot.classList.add('dragging');
      dragInfo = { dancerId: dot.dataset.dancerDot, stage, dot };
      try { dot.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd, { once: true });
    });
  }

  function onDragMove(e) {
    if (!dragInfo) return;
    const rect = dragInfo.stage.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    dragInfo.dot.style.left = x + '%';
    dragInfo.dot.style.top = y + '%';
  }

  async function onDragEnd() {
    document.removeEventListener('pointermove', onDragMove);
    if (!dragInfo) return;
    const { dancerId, dot } = dragInfo;
    dragInfo = null;
    dot.classList.remove('dragging');
    const x = parseFloat(dot.style.left);
    const y = parseFloat(dot.style.top);
    const pos = getPosition(state.currentFormationId, dancerId);
    const updated = { ...pos, id: pos.id || DB.uid(), formationId: state.currentFormationId, dancerId, x, y };
    await DB.put('positions', updated);
    const list = cache.positions[state.currentFormationId] || [];
    const idx = list.findIndex((p) => p.dancerId === dancerId);
    if (idx === -1) list.push(updated); else list[idx] = updated;
    cache.positions[state.currentFormationId] = list;
  }

  // ---------- PDF export ----------

  function generateRoutinePdf(routine) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 48;
    const stageTop = 120;
    const stageW = pageWidth - marginX * 2;
    const stageH = 320;

    cache.formations.forEach((formation, idx) => {
      if (idx > 0) doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(124, 58, 237);
      doc.text(routine.name, marginX, 50);
      doc.setTextColor(20, 20, 20);
      doc.setFontSize(13);
      doc.text(formation.label || `Formation ${idx + 1}`, marginX, 74);

      doc.setDrawColor(180, 180, 180);
      doc.rect(marginX, stageTop, stageW, stageH);
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text('UPSTAGE', pageWidth / 2, stageTop - 6, { align: 'center' });
      doc.text('DOWNSTAGE (audience)', pageWidth / 2, stageTop + stageH + 14, { align: 'center' });
      doc.text('STAGE RIGHT', marginX - 4, stageTop + stageH / 2, { align: 'right' });
      doc.text('STAGE LEFT', marginX + stageW + 4, stageTop + stageH / 2, { align: 'left' });
      doc.setTextColor(20, 20, 20);

      const notes = [];
      cache.dancers.forEach((d) => {
        const pos = getPosition(formation.id, d.id);
        const px = marginX + (pos.x / 100) * stageW;
        const py = stageTop + (pos.y / 100) * stageH;
        const [r, g, b] = hexToRgb(d.color);
        doc.setFillColor(r, g, b);
        doc.circle(px, py, 7, 'F');
        doc.setFontSize(8);
        doc.setTextColor(20, 20, 20);
        doc.text(d.name, px, py + 18, { align: 'center' });
        if (pos.note) notes.push(`${d.name}: ${pos.note}`);
      });

      if (notes.length) {
        let y = stageTop + stageH + 40;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Notes', marginX, y);
        y += 14;
        doc.setFont('helvetica', 'normal');
        notes.forEach((n) => { doc.text(`• ${n}`, marginX + 8, y); y += 14; });
      }
    });

    return doc;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [168, 85, 247];
  }

  // ---------- Events ----------

  function wireEvents() {
    wireDrag();

    root.addEventListener('click', async (e) => {
      const openRoutineId = e.target.closest('[data-open-routine]')?.dataset.openRoutine;
      const openFormationId = e.target.closest('[data-open-formation]')?.dataset.openFormation;
      const delDancerId = e.target.closest('[data-del-dancer]')?.dataset.delDancer;
      const pickColor = e.target.closest('[data-pick-color]')?.dataset.pickColor;
      const dotId = e.target.closest('[data-dancer-dot]')?.dataset.dancerDot;
      const action = e.target.closest('[data-action]')?.dataset.action;

      if (openRoutineId) {
        state.view = 'editor';
        state.routineId = openRoutineId;
        state.currentFormationId = null;
        state.selectedDancerId = null;
        state.editingFormationName = false;
        return render();
      }
      if (openFormationId) {
        stopPlay();
        return switchToFormation(openFormationId);
      }
      if (delDancerId) {
        if (!confirm('Remove this dancer from the routine? This removes them from every formation.')) return;
        await DB.delete('dancers', delDancerId);
        const allPositions = await DB.getAll('positions');
        for (const p of allPositions) if (p.dancerId === delDancerId) await DB.delete('positions', p.id);
        return render();
      }
      if (pickColor) {
        state.newDancerColor = pickColor;
        return render();
      }
      if (dotId) {
        state.selectedDancerId = state.selectedDancerId === dotId ? null : dotId;
        return render();
      }

      switch (action) {
        case 'add-routine': {
          const input = document.getElementById('new-routine-name');
          const name = input.value.trim();
          if (!name) return;
          const routine = { id: DB.uid(), name, createdAt: Date.now() };
          await DB.put('routines', routine);
          cache.routines.push(routine);
          state.view = 'editor';
          state.routineId = routine.id;
          return render();
        }
        case 'back-to-routines':
          stopPlay();
          state.view = 'list';
          state.routineId = null;
          state.editingFormationName = false;
          return render();
        case 'delete-routine': {
          const id = e.target.closest('[data-id]').dataset.id;
          if (!confirm('Delete this routine, its dancers, and all its formations? This cannot be undone.')) return;
          const dancers = await DB.getAllByIndex('dancers', 'byRoutine', id);
          const formations = await DB.getAllByIndex('formations', 'byRoutine', id);
          const allPositions = await DB.getAll('positions');
          const formationIds = new Set(formations.map((f) => f.id));
          for (const p of allPositions) if (formationIds.has(p.formationId)) await DB.delete('positions', p.id);
          for (const f of formations) await DB.delete('formations', f.id);
          for (const d of dancers) await DB.delete('dancers', d.id);
          await DB.delete('routines', id);
          stopPlay();
          state.view = 'list';
          state.routineId = null;
          return render();
        }
        case 'add-dancer': {
          const input = document.getElementById('new-dancer-name');
          const name = input.value.trim();
          if (!name) return;
          await DB.put('dancers', { id: DB.uid(), routineId: state.routineId, name, color: state.newDancerColor, order: cache.dancers.length });
          return render();
        }
        case 'add-formation': {
          const newFormation = { id: DB.uid(), routineId: state.routineId, label: `Formation ${cache.formations.length + 1}`, order: cache.formations.length };
          await DB.put('formations', newFormation);
          const sourcePositions = cache.positions[state.currentFormationId] || [];
          for (const dancer of cache.dancers) {
            const src = sourcePositions.find((p) => p.dancerId === dancer.id);
            await DB.put('positions', {
              id: DB.uid(), formationId: newFormation.id, dancerId: dancer.id,
              x: src ? src.x : 50, y: src ? src.y : 50, note: '',
            });
          }
          state.currentFormationId = newFormation.id;
          state.editingFormationName = false;
          return render();
        }
        case 'rename-formation':
          state.editingFormationName = true;
          return render();
        case 'cancel-rename-formation':
          state.editingFormationName = false;
          return render();
        case 'save-formation-name': {
          const id = e.target.closest('[data-id]').dataset.id;
          const input = document.getElementById('edit-formation-name');
          const label = input.value.trim();
          if (!label) return;
          const formationToRename = cache.formations.find((f) => f.id === id);
          if (!formationToRename) return;
          formationToRename.label = label;
          await DB.put('formations', formationToRename);
          state.editingFormationName = false;
          return render();
        }
        case 'delete-formation': {
          const id = e.target.closest('[data-id]').dataset.id;
          if (!confirm('Delete this formation? This cannot be undone.')) return;
          stopPlay();
          const positionsToDelete = cache.positions[id] || [];
          for (const p of positionsToDelete) await DB.delete('positions', p.id);
          await DB.delete('formations', id);
          delete cache.positions[id];
          cache.formations = cache.formations.filter((f) => f.id !== id);
          if (state.currentFormationId === id) {
            state.currentFormationId = cache.formations[0] ? cache.formations[0].id : null;
          }
          state.selectedDancerId = null;
          state.editingFormationName = false;
          return render();
        }
        case 'prev-formation':
          stopPlay();
          stepFormation(-1);
          return;
        case 'next-formation':
          stopPlay();
          stepFormation(1);
          return;
        case 'toggle-play':
          return togglePlay();
        case 'export-formation-pdf': {
          const routine = cache.routines.find((r) => r.id === state.routineId);
          const doc = generateRoutinePdf(routine);
          const blob = doc.output('blob');
          const fileName = `${routine.name.replace(/[^a-z0-9]+/gi, '_')}_formations.pdf`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = fileName;
          document.body.appendChild(a); a.click(); a.remove();
          const out = document.getElementById('formation-export-output');
          if (out) {
            out.innerHTML = `
              <div class="summary-box" style="padding:0;overflow:hidden;margin-top:10px;">
                <iframe src="${url}" style="width:100%;height:420px;border:0;display:block;"></iframe>
              </div>
            `;
          }
          return;
        }
      }
    });

    root.addEventListener('change', async (e) => {
      if (e.target.id === 'dancer-note-input') {
        const dancer = cache.dancers.find((d) => d.id === state.selectedDancerId);
        if (!dancer || !state.currentFormationId) return;
        const pos = getPosition(state.currentFormationId, dancer.id);
        const updated = { ...pos, id: pos.id || DB.uid(), formationId: state.currentFormationId, dancerId: dancer.id, note: e.target.value.trim() };
        await DB.put('positions', updated);
        const list = cache.positions[state.currentFormationId] || [];
        const idx = list.findIndex((p) => p.dancerId === dancer.id);
        if (idx === -1) list.push(updated); else list[idx] = updated;
        cache.positions[state.currentFormationId] = list;
      }
    });
  }

  async function init() {
    root = document.getElementById('formation-root');
    wireEvents();
    await loadRoutines();
  }

  return { init, onShow: () => render() };
})();
