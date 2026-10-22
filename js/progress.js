// Progress Tracker screen: students (assigned to Locking/House), per-skill checklist filtered
// by the student's style(s), history, and a shareable summary.
const Progress = (() => {
  const LEVELS = [
    { value: 0, label: 'Not started' },
    { value: 1, label: 'Learning' },
    { value: 2, label: 'Solid' },
    { value: 3, label: 'Ready' },
  ];
  const APP_URL = 'https://kof7949.github.io/dance-teacher-toolkit/';
  const PROGRESS_MODE_KEY = 'dance-toolkit-progress-mode';

  let root;
  let state = {
    view: 'list', studentId: null, newStudentStyles: new Set(), manageStyle: null, addingNewCategory: false, newSkillCategoryValue: '', studentSearchQuery: '', addingNewStyle: false,
    mode: 'students', trainingView: 'home', trainingAddingNewCategory: false, trainingNewSkillCategoryValue: '',
  };
  let cache = {
    students: [], skills: [], styles: [], categoryOrder: {}, progressByStudent: {}, historyByStudent: {},
    trainingSkills: [], trainingProgress: {}, trainingHistory: [], trainingJournal: [], trainingGoals: [],
  };

  function styleIds() { return cache.styles.map((s) => s.id); }
  function styleMeta(id) { return cache.styles.find((s) => s.id === id) || { id, label: id, emoji: '⭐' }; }
  function slugify(label) {
    const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'style';
    let id = base;
    let n = 2;
    while (cache.styles.some((s) => s.id === id)) { id = `${base}-${n++}`; }
    return id;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function styleBadges(styles) {
    if (!styles || !styles.length) return '<span class="sub">No style set</span>';
    return styles.map((s) => `<span class="sub">${escapeHtml(styleMeta(s).emoji)} ${escapeHtml(styleMeta(s).label)}</span>`).join(' ');
  }

  async function loadAll() {
    cache.students = (await DB.getAll('students')).sort((a, b) => a.name.localeCompare(b.name));
    cache.skills = (await DB.getAll('skills')).sort((a, b) => a.order - b.order);
    cache.styles = (await DB.getAll('styles')).sort((a, b) => a.order - b.order);
    const orderRecords = await DB.getAll('categoryOrder');
    cache.categoryOrder = {};
    orderRecords.forEach((r) => { cache.categoryOrder[r.id] = r.order; });
  }

  async function saveCategoryOrder(style, orderedCatNames) {
    cache.categoryOrder[style] = orderedCatNames;
    await DB.put('categoryOrder', { id: style, order: orderedCatNames });
  }

  async function loadStudentData(studentId) {
    const progressList = await DB.getAllByIndex('progress', 'byStudent', studentId);
    const map = {};
    progressList.forEach((p) => { map[p.skillId] = p; });
    cache.progressByStudent[studentId] = map;
    const history = await DB.getAllByIndex('history', 'byStudent', studentId);
    cache.historyByStudent[studentId] = history.sort((a, b) => b.date - a.date).slice(0, 8);
  }

  async function loadTrainingAll() {
    cache.trainingSkills = (await DB.getAll('trainingSkills')).sort((a, b) => a.order - b.order);
    const progressList = await DB.getAll('trainingProgress');
    const map = {};
    progressList.forEach((p) => { map[p.skillId] = p; });
    cache.trainingProgress = map;
    const history = await DB.getAll('trainingHistory');
    cache.trainingHistory = history.sort((a, b) => b.date - a.date).slice(0, 8);
    cache.trainingJournal = (await DB.getAll('trainingJournal')).sort((a, b) => b.date - a.date);
    cache.trainingGoals = (await DB.getAll('trainingGoals')).sort((a, b) => a.order - b.order);
  }

  function isGoalComplete(goal) {
    return goal.milestones.length ? goal.milestones.every((m) => m.done) : !!goal.completed;
  }

  // Incomplete goals first (soonest target date first, undated goals last among them),
  // completed goals sink to the bottom (most recently created first) rather than vanishing.
  function sortedTrainingGoals() {
    const incomplete = [];
    const complete = [];
    cache.trainingGoals.forEach((g) => (isGoalComplete(g) ? complete : incomplete).push(g));
    incomplete.sort((a, b) => (a.targetDate ?? Infinity) - (b.targetDate ?? Infinity) || a.createdAt - b.createdAt);
    complete.sort((a, b) => b.createdAt - a.createdAt);
    return incomplete.concat(complete);
  }

  // Groups trainingSkills by category only (no per-style dimension -- there's one "trainee").
  // Categories appear in first-appearance order; no saved custom order for v1.
  function groupTrainingSkillsByCategory() {
    const groups = {};
    cache.trainingSkills.forEach((s) => {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    });
    return groups;
  }

  // Returns { locking: { 'Foundations': [skill,...], ... }, house: {...} }
  // Category key order within each style follows the saved categoryOrder (drag-to-reorder),
  // falling back to first-appearance order for any category not yet in that saved list.
  function groupSkillsByStyleAndCategory() {
    const unordered = {};
    styleIds().forEach((s) => { unordered[s] = {}; });
    cache.skills.forEach((s) => {
      if (!unordered[s.style]) unordered[s.style] = {};
      if (!unordered[s.style][s.category]) unordered[s.style][s.category] = [];
      unordered[s.style][s.category].push(s);
    });

    const groups = {};
    styleIds().forEach((styleKey) => {
      const catMap = unordered[styleKey] || {};
      const savedOrder = cache.categoryOrder[styleKey] || [];
      const orderedNames = [
        ...savedOrder.filter((c) => catMap[c]),
        ...Object.keys(catMap).filter((c) => !savedOrder.includes(c)),
      ];
      groups[styleKey] = {};
      orderedNames.forEach((c) => { groups[styleKey][c] = catMap[c]; });
    });
    return groups;
  }

  function styleChipsHtml(selectedSet, dataAttr) {
    return styleIds().map((s) => `
      <button class="chip style-chip ${selectedSet.has(s) ? 'active' : ''}" data-${dataAttr}="${s}">
        ${escapeHtml(styleMeta(s).emoji)} ${escapeHtml(styleMeta(s).label)}
      </button>
    `).join('');
  }

  function studentRowsHtml(query) {
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? cache.students.filter((s) => s.name.toLowerCase().includes(q)) : cache.students;
    return filtered.map((s) => `
      <div class="student-card" data-open="${s.id}">
        <div>
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="sub">${styleBadges(s.styles)}</div>
        </div>
        <button class="btn btn-small" data-open="${s.id}">Open</button>
      </div>
    `).join('') || (q
      ? `<div class="empty-state">No students match "${escapeHtml(query)}".</div>`
      : '<div class="empty-state">No students yet. Add one below to start tracking progress.</div>');
  }

  function modeToggleHtml() {
    return `
      <div class="tag-buttons" style="margin-bottom:14px;">
        <button class="chip ${state.mode === 'students' ? 'active' : ''}" data-progress-mode="students">👥 Students</button>
        <button class="chip ${state.mode === 'training' ? 'active' : ''}" data-progress-mode="training">🧑‍🏫 My Training</button>
      </div>
    `;
  }

  function globalSettingsCardsHtml() {
    return `
      <div class="card" style="margin-top:16px;">
        <div class="section-title" style="margin-top:0;">Backup</div>
        <div class="tag-label">Skills, students and progress are only saved on this device/browser. Export a backup here, then import it on your phone to bring everything over.</div>
        <div class="tag-buttons">
          <button class="btn btn-small" data-action="export-backup">⬇ Export backup</button>
          <label class="btn btn-small" for="import-backup-file">⬆ Import backup</label>
          <input type="file" id="import-backup-file" accept="application/json" hidden />
        </div>
        <div id="backup-output"></div>
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0;">Share this app</div>
        <div class="tag-label">Send this link to other instructors so they can open (and install) the app themselves.</div>
        <div class="summary-box" style="word-break:break-all;">${APP_URL}</div>
        <div class="tag-buttons" style="margin-top:10px;">
          <button class="btn btn-small" data-action="share-app-link">🔗 Share app link</button>
        </div>
        <div id="share-app-output"></div>
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0;">App updates</div>
        <div class="tag-label">This app caches itself for offline use, so a new fix can sometimes take a while to reach your phone on its own. Tap this if something I fixed doesn't seem to show up yet — it only refreshes the app's code, your students/progress/skills are never touched.</div>
        <button class="btn btn-small" data-action="force-update">🔄 Check for updates</button>
      </div>
    `;
  }

  function renderList() {
    return `
      ${modeToggleHtml()}
      <div class="add-row">
        <input type="text" id="new-student-name" placeholder="New student name" />
      </div>
      <div class="tag-buttons" style="margin-bottom:10px;">
        ${styleChipsHtml(state.newStudentStyles, 'new-style')}
      </div>
      <button class="btn btn-small" data-action="add-student" style="margin-bottom:16px;">Add student</button>
      <div class="add-row" style="margin-bottom:10px;">
        <input type="text" id="student-search" placeholder="🔍 Search students…" value="${escapeHtml(state.studentSearchQuery || '')}" />
      </div>
      <div class="student-list" id="student-list-container">${studentRowsHtml(state.studentSearchQuery)}</div>
      <div class="tag-buttons" style="margin-bottom:8px;">
        <button class="btn btn-text" data-action="manage-skills">Edit skill checklist</button>
        <button class="btn btn-text" data-action="manage-styles">Manage dance styles</button>
      </div>
      ${globalSettingsCardsHtml()}
    `;
  }

  function renderStudent(studentId) {
    const student = cache.students.find((s) => s.id === studentId);
    if (!student) { state.view = 'list'; return renderList(); }
    const progress = cache.progressByStudent[studentId] || {};
    const allGroups = groupSkillsByStyleAndCategory();
    const studentStyles = student.styles || [];

    const styleTogglesHtml = `
      <div class="tag-buttons" style="margin-bottom:14px;">
        ${styleIds().map((s) => `
          <button class="chip style-chip ${studentStyles.includes(s) ? 'active' : ''}" data-toggle-style="${s}">
            ${escapeHtml(styleMeta(s).emoji)} ${escapeHtml(styleMeta(s).label)}
          </button>
        `).join('')}
      </div>
    `;

    let skillsHtml;
    if (!studentStyles.length) {
      skillsHtml = '<div class="empty-state">Select Locking and/or House above to load the matching skill checklist.</div>';
    } else {
      skillsHtml = studentStyles.map((styleKey) => {
        const categories = allGroups[styleKey] || {};
        const catNames = Object.keys(categories);
        if (!catNames.length) return '';
        const catsHtml = catNames.map((cat) => `
          <div class="skill-category">
            <h4>${escapeHtml(cat)}</h4>
            ${categories[cat].map((skill) => {
              const level = progress[skill.id] ? progress[skill.id].level : -1;
              return `
                <div class="skill-row">
                  <div class="skill-name">${escapeHtml(skill.name)}</div>
                  <div class="level-segment" data-skill="${skill.id}">
                    ${LEVELS.map((l) => `
                      <button class="level-btn ${level === l.value ? 'active' : ''}" data-set-level="${skill.id}:${l.value}">${l.label}</button>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `).join('');
        return `<div class="section-title" style="margin-top:6px;">${escapeHtml(styleMeta(styleKey).emoji)} ${escapeHtml(styleMeta(styleKey).label)}</div>${catsHtml}`;
      }).join('');
    }

    const history = cache.historyByStudent[studentId] || [];
    const historyHtml = history.length
      ? history.map((h) => {
          const skill = cache.skills.find((s) => s.id === h.skillId);
          const levelLabel = LEVELS.find((l) => l.value === h.level)?.label || h.level;
          return `<div>${fmtDate(h.date)} — ${escapeHtml(skill ? skill.name : 'Skill')}: <b>${levelLabel}</b></div>`;
        }).join('')
      : '<div class="empty-state">No updates logged yet.</div>';

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="back-to-list">← Back</button>
        <div style="flex:1"></div>
        <button class="btn btn-small btn-danger" data-action="remove-student" data-id="${student.id}">Remove</button>
      </div>
      <div class="section-title" style="display:flex;align-items:center;gap:8px;">
        ${state.editingName ? `
          <input type="text" id="edit-student-name" value="${escapeHtml(student.name)}" style="flex:1;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 10px;font-size:0.95rem;" />
          <button class="btn btn-small" data-action="save-student-name" data-id="${student.id}">Save</button>
          <button class="btn btn-small btn-text" data-action="cancel-edit-name">Cancel</button>
        ` : `
          <span style="flex:1;">${escapeHtml(student.name)}</span>
          <button class="btn btn-small" data-action="edit-student-name">✏️ Edit</button>
        `}
      </div>
      ${styleTogglesHtml}
      ${skillsHtml}
      <div class="section-title">Recent updates</div>
      <div class="summary-box">${historyHtml}</div>
      <div class="section-title">Share progress</div>
      <button class="btn btn-small" data-action="share-summary" data-id="${student.id}">Download PDF report</button>
      <div id="share-output"></div>
    `;
  }

  function renderManageSkills() {
    const allGroups = groupSkillsByStyleAndCategory();
    const activeStyle = state.manageStyle || styleIds()[0];
    const categories = allGroups[activeStyle] || {};
    const catNames = Object.keys(categories);
    const selectedCatValue = (state.newSkillCategoryValue && (catNames.includes(state.newSkillCategoryValue) || state.newSkillCategoryValue === '__new__'))
      ? state.newSkillCategoryValue
      : (catNames[0] || '__new__');
    const catsHtml = catNames.map((cat) => `
      <div class="skill-category" data-category-drop="${escapeHtml(cat)}" data-category-block="${escapeHtml(cat)}">
        <h4 style="display:flex;align-items:center;gap:6px;">
          <span class="drag-handle category-drag-handle" data-drag-category="${escapeHtml(cat)}" title="Drag to reorder this category">⠿</span>
          ${escapeHtml(cat)}
        </h4>
        ${categories[cat].map((s) => `
          <div class="skill-row drag-row" data-skill-row="${s.id}" style="flex-direction:row;align-items:center;justify-content:space-between;">
            <span class="drag-handle" data-drag-skill="${s.id}" title="Drag to reorder or move to another category">⠿</span>
            <span class="skill-name" style="flex:1;margin:0 8px;">${escapeHtml(s.name)}</span>
            <button class="btn btn-small btn-danger" data-del-skill="${s.id}">Remove</button>
          </div>
        `).join('')}
      </div>
    `).join('') || '<div class="empty-state">No skills yet for this style.</div>';

    const styleTabsHtml = styleIds().map((s) => `
      <button class="chip style-chip ${activeStyle === s ? 'active' : ''}" data-manage-style="${s}">
        ${escapeHtml(styleMeta(s).emoji)} ${escapeHtml(styleMeta(s).label)}
      </button>
    `).join('');

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="back-to-list">← Back</button>
      </div>
      <div class="section-title">Edit skill checklist</div>
      <div class="tag-buttons" style="margin-bottom:14px;">${styleTabsHtml}</div>
      <div class="tag-label">Drag ⠿ on a move to reorder it or drop it into another category. Drag ⠿ on a category heading to reorder categories.</div>
      <div class="add-row">
        <select id="new-skill-category-select" class="song-select" style="flex:0 0 45%">
          ${catNames.map((c) => `<option value="${escapeHtml(c)}" ${selectedCatValue === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          <option value="__new__" ${selectedCatValue === '__new__' ? 'selected' : ''}>+ New category</option>
        </select>
        <input type="text" id="new-skill-name" placeholder="Skill name" />
      </div>
      ${selectedCatValue === '__new__' ? `
        <div class="add-row">
          <input type="text" id="new-skill-category-new" placeholder="New category name" />
        </div>
      ` : ''}
      <button class="btn btn-small" data-action="add-skill" style="margin-bottom:16px;">Add skill to ${escapeHtml(styleMeta(activeStyle).label)}</button>
      ${catsHtml}
    `;
  }

  function renderManageStyles() {
    const rows = cache.styles.map((s) => {
      const skillCount = cache.skills.filter((sk) => sk.style === s.id).length;
      return `
        <div class="student-card">
          <div>
            <div class="name">${escapeHtml(s.emoji)} ${escapeHtml(s.label)}</div>
            <div class="sub">${skillCount} skill${skillCount === 1 ? '' : 's'}</div>
          </div>
          <button class="btn btn-small btn-danger" data-del-style="${s.id}">Remove</button>
        </div>
      `;
    }).join('') || '<div class="empty-state">No styles yet.</div>';

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="back-to-list">← Back</button>
      </div>
      <div class="section-title">Manage dance styles</div>
      <div class="tag-label">Each style gets its own skill checklist and its own tab when assigning students. After adding a style here, use "Edit skill checklist" to build out its categories and skills.</div>
      <div class="student-list" style="margin-bottom:16px;">${rows}</div>
      <div class="add-row">
        <input type="text" id="new-style-label" placeholder="Style name, e.g. Popping" />
        <input type="text" id="new-style-emoji" placeholder="Icon" style="flex:0 0 70px;" maxlength="4" />
      </div>
      <button class="btn btn-small" data-action="add-style">Add style</button>
    `;
  }

  function goalCardHtml(goal) {
    const complete = isGoalComplete(goal);
    const total = goal.milestones.length;
    const done = goal.milestones.filter((m) => m.done).length;
    const titleStyle = complete ? 'text-decoration:line-through;color:var(--text-dim);' : '';
    const milestonesHtml = total ? `
      <div style="height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden;margin:4px 0;">
        <div style="height:100%;width:${Math.round((done / total) * 100)}%;background:var(--accent);"></div>
      </div>
      ${goal.milestones.map((m) => `
        <label style="display:flex;align-items:center;gap:8px;padding:4px 0;">
          <input type="checkbox" data-toggle-milestone="${goal.id}:${m.id}" ${m.done ? 'checked' : ''} />
          <span style="flex:1;white-space:pre-wrap;${m.done ? 'text-decoration:line-through;color:var(--text-dim);' : ''}">${escapeHtml(m.text)}</span>
          <button class="dancer-chip-del" data-del-milestone="${goal.id}:${m.id}" title="Remove milestone">✕</button>
        </label>
      `).join('')}
      <div class="sub">${done}/${total} milestones</div>
    ` : '';

    return `
      <div class="student-card" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div class="name" style="${titleStyle}">${escapeHtml(goal.title)}</div>
            ${goal.targetDate ? `<div class="sub">Target: ${fmtDate(goal.targetDate)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${!total ? `<button class="btn btn-small" data-toggle-goal-complete="${goal.id}">${complete ? '↺ Reopen' : '✓ Mark complete'}</button>` : ''}
            <button class="dancer-chip-del" data-del-goal="${goal.id}" title="Delete goal">✕</button>
          </div>
        </div>
        ${milestonesHtml}
        <div class="add-row" style="margin-bottom:0;">
          <textarea id="milestone-input-${goal.id}" placeholder="Add a milestone…" rows="1"></textarea>
          <button class="btn btn-small" data-add-milestone="${goal.id}">+</button>
        </div>
      </div>
    `;
  }

  function renderTrainingGrid() {
    const tiles = [
      { id: 'goals', icon: '🎯', label: 'Goals' },
      { id: 'skills', icon: '🧑‍🏫', label: 'My Skills' },
      { id: 'journal', icon: '📓', label: 'Training Journal' },
    ];
    const tilesHtml = tiles.map((t) => `
      <button class="training-tile" data-training-tile="${t.id}">
        <span class="training-tile-icon">${t.icon}</span>
        <span class="training-tile-label">${t.label}</span>
      </button>
    `).join('');

    return `
      ${modeToggleHtml()}
      <div class="training-tile-grid">${tilesHtml}</div>
      ${globalSettingsCardsHtml()}
    `;
  }

  function renderTrainingGoals() {
    const goalsHtml = cache.trainingGoals.length
      ? sortedTrainingGoals().map(goalCardHtml).join('')
      : '<div class="empty-state">No goals yet. Set one below.</div>';

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="training-back-to-home">← Back</button>
      </div>
      <div class="section-title" style="margin-top:0;">🎯 Goals</div>
      <div class="student-list">${goalsHtml}</div>
      <div class="add-row" style="margin-top:12px;">
        <textarea id="new-goal-title" placeholder="New goal, e.g. 'Clean triple pirouette'" rows="1"></textarea>
        <input type="date" id="new-goal-date" style="flex:0 0 140px;" />
      </div>
      <button class="btn btn-small" data-action="add-goal">Add goal</button>
    `;
  }

  function renderTrainingSkills() {
    const groups = groupTrainingSkillsByCategory();
    const catNames = Object.keys(groups);
    const skillsHtml = catNames.length
      ? catNames.map((cat) => `
          <div class="skill-category">
            <h4>${escapeHtml(cat)}</h4>
            ${groups[cat].map((skill) => {
              const level = cache.trainingProgress[skill.id] ? cache.trainingProgress[skill.id].level : -1;
              return `
                <div class="skill-row">
                  <div class="skill-name">${escapeHtml(skill.name)}</div>
                  <div class="level-segment" data-skill="${skill.id}">
                    ${LEVELS.map((l) => `
                      <button class="level-btn ${level === l.value ? 'active' : ''}" data-set-training-level="${skill.id}:${l.value}">${l.label}</button>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `).join('')
      : '<div class="empty-state">No training skills yet. Use "Edit my skills checklist" below to add your first one.</div>';

    const historyHtml = cache.trainingHistory.length
      ? cache.trainingHistory.map((h) => {
          const skill = cache.trainingSkills.find((s) => s.id === h.skillId);
          const levelLabel = LEVELS.find((l) => l.value === h.level)?.label || h.level;
          return `<div>${fmtDate(h.date)} — ${escapeHtml(skill ? skill.name : 'Skill')}: <b>${levelLabel}</b></div>`;
        }).join('')
      : '<div class="empty-state">No updates logged yet.</div>';

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="training-back-to-home">← Back</button>
      </div>
      <div class="section-title" style="margin-top:0;">🧑‍🏫 My Skills</div>
      ${skillsHtml}
      <button class="btn btn-text" data-action="training-manage-skills" style="margin-top:8px;">Edit my skills checklist</button>
      <div class="section-title">Recent updates</div>
      <div class="summary-box">${historyHtml}</div>
    `;
  }

  function renderTrainingJournal() {
    const journalHtml = cache.trainingJournal.length
      ? cache.trainingJournal.map((j) => `
          <div class="student-card">
            <div>
              <div class="sub">${fmtDate(j.date)}</div>
              <div class="name">${escapeHtml(j.text)}</div>
            </div>
            <button class="dancer-chip-del" data-del-journal="${j.id}" title="Delete entry">✕</button>
          </div>
        `).join('')
      : '<div class="empty-state">No journal entries yet. Log what you worked on above.</div>';

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="training-back-to-home">← Back</button>
      </div>
      <div class="section-title" style="margin-top:0;">📓 Training Journal</div>
      <div class="add-row">
        <textarea id="training-journal-input" placeholder="What did you work on today?" rows="3"></textarea>
      </div>
      <button class="btn btn-small" data-action="add-journal-entry" style="margin-bottom:12px;">Add entry</button>
      <div class="student-list">${journalHtml}</div>
    `;
  }

  function renderTrainingManageSkills() {
    const groups = groupTrainingSkillsByCategory();
    const catNames = Object.keys(groups);
    const selectedCatValue = (state.trainingNewSkillCategoryValue && (catNames.includes(state.trainingNewSkillCategoryValue) || state.trainingNewSkillCategoryValue === '__new__'))
      ? state.trainingNewSkillCategoryValue
      : (catNames[0] || '__new__');

    const catsHtml = catNames.map((cat) => `
      <div class="skill-category">
        <h4>${escapeHtml(cat)}</h4>
        ${groups[cat].map((s) => `
          <div class="skill-row" style="flex-direction:row;align-items:center;justify-content:space-between;">
            <span class="skill-name" style="flex:1;margin-right:8px;">${escapeHtml(s.name)}</span>
            <button class="btn btn-small btn-danger" data-del-training-skill="${s.id}">Remove</button>
          </div>
        `).join('')}
      </div>
    `).join('') || '<div class="empty-state">No training skills yet.</div>';

    return `
      <div class="back-row">
        <button class="btn btn-small" data-action="training-back-to-skills">← Back</button>
      </div>
      <div class="section-title">Edit my skills checklist</div>
      <div class="add-row">
        <select id="new-training-skill-category-select" class="song-select" style="flex:0 0 45%">
          ${catNames.map((c) => `<option value="${escapeHtml(c)}" ${selectedCatValue === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          <option value="__new__" ${selectedCatValue === '__new__' ? 'selected' : ''}>+ New category</option>
        </select>
        <textarea id="new-training-skill-name" placeholder="Skill or concept name" rows="1"></textarea>
      </div>
      ${selectedCatValue === '__new__' ? `
        <div class="add-row">
          <textarea id="new-training-skill-category-new" placeholder="New category name" rows="1"></textarea>
        </div>
      ` : ''}
      <button class="btn btn-small" data-action="add-training-skill" style="margin-bottom:16px;">Add skill</button>
      ${catsHtml}
    `;
  }

  function renderTrainingMode() {
    if (state.trainingView === 'manage-skills') return renderTrainingManageSkills();
    if (state.trainingView === 'goals') return renderTrainingGoals();
    if (state.trainingView === 'skills') return renderTrainingSkills();
    if (state.trainingView === 'journal') return renderTrainingJournal();
    return renderTrainingGrid();
  }

  async function render() {
    if (state.mode === 'training') {
      await loadTrainingAll();
      root.innerHTML = renderTrainingMode();
      return;
    }
    if (state.view === 'student' && state.studentId) {
      await loadStudentData(state.studentId);
      root.innerHTML = renderStudent(state.studentId);
    } else if (state.view === 'manage-skills') {
      root.innerHTML = renderManageSkills();
    } else if (state.view === 'manage-styles') {
      root.innerHTML = renderManageStyles();
    } else {
      state.view = 'list';
      root.innerHTML = renderList();
    }
  }

  function getRecordedProgressData(studentId) {
    const student = cache.students.find((s) => s.id === studentId);
    const progress = cache.progressByStudent[studentId] || {};
    const allGroups = groupSkillsByStyleAndCategory();
    const studentStyles = student.styles || [];
    const styles = [];
    studentStyles.forEach((styleKey) => {
      const categories = allGroups[styleKey] || {};
      const catList = [];
      Object.keys(categories).forEach((cat) => {
        const recordedSkills = categories[cat]
          .filter((skill) => progress[skill.id])
          .map((skill) => ({ name: skill.name, label: LEVELS.find((l) => l.value === progress[skill.id].level).label }));
        if (recordedSkills.length) catList.push({ name: cat, skills: recordedSkills });
      });
      // Not HTML output (used only in the PDF report), so no escaping needed here.
      if (catList.length) styles.push({ key: styleKey, label: styleMeta(styleKey).label, categories: catList });
    });
    return { student, styles };
  }

  function generatePdfReport(studentId) {
    const { student, styles } = getRecordedProgressData(studentId);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 48;
    let y = 56;

    function ensureSpace(lineHeight) {
      if (y + lineHeight > pageHeight - 48) {
        doc.addPage();
        y = 56;
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(124, 58, 237);
    doc.text('Oren_h00ng class programme', marginX, y);
    y += 22;

    doc.setTextColor(20, 20, 20);
    doc.setFontSize(14);
    doc.text(`${student.name} — Progress Report`, marginX, y);
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(110, 110, 110);
    doc.text(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), marginX, y);
    doc.setTextColor(20, 20, 20);
    y += 20;
    doc.setDrawColor(220, 220, 220);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 20;

    if (!styles.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(11);
      doc.text('No progress recorded yet.', marginX, y);
    }

    styles.forEach((style) => {
      ensureSpace(24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12.5);
      doc.setTextColor(124, 58, 237);
      doc.text(style.label, marginX, y);
      doc.setTextColor(20, 20, 20);
      y += 18;

      style.categories.forEach((cat) => {
        ensureSpace(16);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.text(cat.name, marginX + 12, y);
        y += 15;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        cat.skills.forEach((skill) => {
          ensureSpace(14);
          doc.text(`•  ${skill.name}`, marginX + 24, y);
          doc.text(skill.label, pageWidth - marginX, y, { align: 'right' });
          y += 14;
        });
        y += 6;
      });
      y += 6;
    });

    return doc;
  }

  async function setLevel(skillId, level) {
    const studentId = state.studentId;
    const existing = cache.progressByStudent[studentId]?.[skillId];
    if (existing && existing.level === level) {
      // Tapping the already-selected level again clears it back to unset.
      await DB.delete('progress', existing.id);
      await render();
      return;
    }
    const id = existing ? existing.id : DB.uid();
    await DB.put('progress', { id, studentId, skillId, level, updatedAt: Date.now() });
    await DB.put('history', { id: DB.uid(), studentId, skillId, level, date: Date.now() });
    await render();
  }

  async function setTrainingLevel(skillId, level) {
    const existing = cache.trainingProgress[skillId];
    if (existing && existing.level === level) {
      // Tapping the already-selected level again clears it back to unset.
      await DB.delete('trainingProgress', existing.id);
      await render();
      return;
    }
    const id = existing ? existing.id : DB.uid();
    await DB.put('trainingProgress', { id, skillId, level, updatedAt: Date.now() });
    await DB.put('trainingHistory', { id: DB.uid(), skillId, level, date: Date.now() });
    await render();
  }

  async function toggleStudentStyle(studentId, styleKey) {
    const student = cache.students.find((s) => s.id === studentId);
    const styles = new Set(student.styles || []);
    if (styles.has(styleKey)) styles.delete(styleKey); else styles.add(styleKey);
    student.styles = Array.from(styles);
    await DB.put('students', student);
    await render();
  }

  let dragState = null;

  function clearDropHighlights() {
    root.querySelectorAll('.skill-category.drop-target-hover').forEach((el) => el.classList.remove('drop-target-hover'));
    root.querySelectorAll('.skill-row.drag-insert-before, .skill-row.drag-insert-after').forEach((el) => {
      el.classList.remove('drag-insert-before', 'drag-insert-after');
    });
  }

  function onDragPointerMove(e) {
    if (!dragState) return;
    dragState.ghost.style.left = (e.clientX - dragState.offsetX) + 'px';
    dragState.ghost.style.top = (e.clientY - dragState.offsetY) + 'px';
    clearDropHighlights();

    if (dragState.type === 'category') {
      dragState.insertBeforeCategory = null;
      const blocks = Array.from(root.querySelectorAll('.skill-category[data-category-block]'));
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const rect = block.getBoundingClientRect();
        if (e.clientY < rect.top || e.clientY > rect.bottom) continue;
        block.classList.add('drop-target-hover');
        const isTopHalf = e.clientY < rect.top + rect.height / 2;
        dragState.insertBeforeCategory = isTopHalf
          ? block.dataset.categoryBlock
          : (blocks[i + 1] ? blocks[i + 1].dataset.categoryBlock : null);
        break;
      }
      return;
    }

    dragState.targetCategory = null;
    dragState.insertBeforeSkillId = null;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const catBox = under && under.closest('[data-category-drop]');
    if (!catBox) return;
    catBox.classList.add('drop-target-hover');
    dragState.targetCategory = catBox.dataset.categoryDrop;

    const rows = Array.from(catBox.querySelectorAll('.skill-row[data-skill-row]'));
    const rowUnder = under.closest('.skill-row[data-skill-row]');
    if (rowUnder && catBox.contains(rowUnder)) {
      const rect = rowUnder.getBoundingClientRect();
      const isTopHalf = e.clientY < rect.top + rect.height / 2;
      const idx = rows.indexOf(rowUnder);
      if (isTopHalf) {
        rowUnder.classList.add('drag-insert-before');
        dragState.insertBeforeSkillId = rowUnder.dataset.skillRow;
      } else {
        rowUnder.classList.add('drag-insert-after');
        dragState.insertBeforeSkillId = rows[idx + 1] ? rows[idx + 1].dataset.skillRow : null;
      }
    }
  }

  async function onDragPointerUp() {
    document.removeEventListener('pointermove', onDragPointerMove);
    if (!dragState) return;
    const { type, ghost } = dragState;
    clearDropHighlights();
    ghost.remove();

    if (type === 'category') {
      const { category, insertBeforeCategory } = dragState;
      dragState = null;
      const activeStyle = state.manageStyle || styleIds()[0];
      const allGroups = groupSkillsByStyleAndCategory();
      const currentNames = Object.keys(allGroups[activeStyle] || {});
      const reordered = currentNames.filter((c) => c !== category);
      let insertIndex = reordered.length;
      if (insertBeforeCategory) {
        const idx = reordered.indexOf(insertBeforeCategory);
        if (idx !== -1) insertIndex = idx;
      }
      reordered.splice(insertIndex, 0, category);
      await saveCategoryOrder(activeStyle, reordered);
      await render();
      return;
    }

    const { skillId, targetCategory, insertBeforeSkillId } = dragState;
    dragState = null;
    if (!targetCategory) return;

    const skill = cache.skills.find((s) => s.id === skillId);
    if (!skill) return;

    const targetList = cache.skills
      .filter((s) => s.style === skill.style && s.category === targetCategory && s.id !== skillId)
      .sort((a, b) => a.order - b.order);

    let insertIndex = targetList.length;
    if (insertBeforeSkillId) {
      const idx = targetList.findIndex((s) => s.id === insertBeforeSkillId);
      if (idx !== -1) insertIndex = idx;
    }
    targetList.splice(insertIndex, 0, skill);

    let anyChanged = false;
    for (let i = 0; i < targetList.length; i++) {
      const s = targetList[i];
      if (s.order !== i || s.category !== targetCategory) {
        s.order = i;
        s.category = targetCategory;
        await DB.put('skills', s);
        anyChanged = true;
      }
    }
    if (anyChanged) {
      await loadAll();
      await render();
    }
  }

  function wireEvents() {
    root.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      e.preventDefault();

      if (handle.dataset.dragCategory) {
        const category = handle.dataset.dragCategory;
        const block = handle.closest('.skill-category');
        const rect = block.getBoundingClientRect();
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = category;
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        ghost.style.width = rect.width + 'px';
        document.body.appendChild(ghost);
        dragState = { type: 'category', category, ghost, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
      } else {
        const skillId = handle.dataset.dragSkill;
        const row = handle.closest('.skill-row');
        const rect = row.getBoundingClientRect();
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = row.querySelector('.skill-name').textContent;
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        ghost.style.width = rect.width + 'px';
        document.body.appendChild(ghost);
        dragState = { type: 'skill', skillId, ghost, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
      }
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      document.addEventListener('pointermove', onDragPointerMove);
      document.addEventListener('pointerup', onDragPointerUp, { once: true });
    });

    root.addEventListener('input', (e) => {
      if (e.target.id !== 'student-search') return;
      state.studentSearchQuery = e.target.value;
      const container = document.getElementById('student-list-container');
      if (container) container.innerHTML = studentRowsHtml(state.studentSearchQuery);
    });

    root.addEventListener('change', async (e) => {
      if (e.target.id === 'new-skill-category-select') {
        state.newSkillCategoryValue = e.target.value;
        state.addingNewCategory = e.target.value === '__new__';
        render();
      }
      if (e.target.id === 'new-training-skill-category-select') {
        state.trainingNewSkillCategoryValue = e.target.value;
        state.trainingAddingNewCategory = e.target.value === '__new__';
        render();
      }
      if (e.target.id === 'import-backup-file') {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const out = document.getElementById('backup-output');
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (data.type !== 'progress-backup' || !Array.isArray(data.skills) || !Array.isArray(data.students)) {
            throw new Error('This file does not look like a Dance Teacher Toolkit backup.');
          }
          for (const s of (data.styles || [])) await DB.put('styles', s);

          // Any skill already on this device (e.g. seeded defaults on a fresh install)
          // that matches an incoming skill by style+name but has a different id would
          // otherwise sit duplicated alongside the imported one. The imported skill is
          // the one with real progress/history tied to it, so the local duplicate loses.
          const existingSkills = await DB.getAll('skills');
          const incomingKeys = new Set(data.skills.map((s) => `${s.style}::${s.name.trim().toLowerCase()}`));
          const importedIds = new Set(data.skills.map((s) => s.id));
          let removedDupes = 0;
          for (const existing of existingSkills) {
            const key = `${existing.style}::${existing.name.trim().toLowerCase()}`;
            if (incomingKeys.has(key) && !importedIds.has(existing.id)) {
              const allProgress = await DB.getAll('progress');
              for (const p of allProgress) if (p.skillId === existing.id) await DB.delete('progress', p.id);
              const allHistory = await DB.getAll('history');
              for (const h of allHistory) if (h.skillId === existing.id) await DB.delete('history', h.id);
              await DB.delete('skills', existing.id);
              removedDupes++;
            }
          }

          for (const s of data.skills) await DB.put('skills', s);
          for (const c of (data.categoryOrder || [])) await DB.put('categoryOrder', c);
          for (const s of data.students) await DB.put('students', s);
          for (const p of (data.progress || [])) await DB.put('progress', p);
          for (const h of (data.history || [])) await DB.put('history', h);
          for (const r of (data.routines || [])) await DB.put('routines', r);
          for (const d of (data.dancers || [])) await DB.put('dancers', d);
          for (const f of (data.formations || [])) await DB.put('formations', f);
          for (const pos of (data.positions || [])) await DB.put('positions', pos);
          for (const s of (data.trainingSkills || [])) await DB.put('trainingSkills', s);
          for (const p of (data.trainingProgress || [])) await DB.put('trainingProgress', p);
          for (const h of (data.trainingHistory || [])) await DB.put('trainingHistory', h);
          for (const j of (data.trainingJournal || [])) await DB.put('trainingJournal', j);
          for (const g of (data.trainingGoals || [])) await DB.put('trainingGoals', g);

          // Merge by id rather than overwrite, same as everything above -- a restore
          // shouldn't wipe out custom Groove patterns built on this device since the backup
          // was taken.
          let importedGrooveCount = 0;
          if (Array.isArray(data.groovePresets) && data.groovePresets.length) {
            try {
              const raw = localStorage.getItem('dance-toolkit-groove-custom-presets');
              const existing = raw ? JSON.parse(raw) : [];
              const byId = new Map(existing.map((p) => [p.id, p]));
              for (const p of data.groovePresets) byId.set(p.id, p);
              localStorage.setItem('dance-toolkit-groove-custom-presets', JSON.stringify([...byId.values()]));
              importedGrooveCount = data.groovePresets.length;
            } catch (err) { /* ignore */ }
          }

          await loadAll();
          state.view = 'list';
          await render();
          const out2 = document.getElementById('backup-output');
          if (out2) {
            const dupeNote = removedDupes ? ` (removed ${removedDupes} duplicate skill${removedDupes === 1 ? '' : 's'})` : '';
            const grooveNote = importedGrooveCount ? `, ${importedGrooveCount} groove preset(s)` : '';
            const journalCount = (data.trainingJournal || []).length;
            const journalNote = journalCount ? `, ${journalCount} journal entr${journalCount === 1 ? 'y' : 'ies'}` : '';
            out2.innerHTML = `<div class="summary-box">Backup imported: ${data.students.length} student(s), ${data.skills.length} skill(s)${grooveNote}${journalNote}${dupeNote}.</div>`;
          }
        } catch (err) {
          if (out) out.innerHTML = `<div class="summary-box">Import failed: ${escapeHtml(err.message)}</div>`;
        }
      }
    });

    root.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      const openId = e.target.closest('[data-open]')?.dataset.open;
      const setLevelAttr = e.target.closest('[data-set-level]')?.dataset.setLevel;
      const delSkillId = e.target.closest('[data-del-skill]')?.dataset.delSkill;
      const delStyleId = e.target.closest('[data-del-style]')?.dataset.delStyle;
      const newStyleBtn = e.target.closest('[data-new-style]');
      const toggleStyleBtn = e.target.closest('[data-toggle-style]');
      const manageStyleBtn = e.target.closest('[data-manage-style]');
      const progressModeBtn = e.target.closest('[data-progress-mode]');
      const trainingTile = e.target.closest('[data-training-tile]')?.dataset.trainingTile;
      const setTrainingLevelAttr = e.target.closest('[data-set-training-level]')?.dataset.setTrainingLevel;
      const delTrainingSkillId = e.target.closest('[data-del-training-skill]')?.dataset.delTrainingSkill;
      const delJournalId = e.target.closest('[data-del-journal]')?.dataset.delJournal;
      const toggleMilestoneAttr = e.target.closest('[data-toggle-milestone]')?.dataset.toggleMilestone;
      const delMilestoneAttr = e.target.closest('[data-del-milestone]')?.dataset.delMilestone;
      const addMilestoneGoalId = e.target.closest('[data-add-milestone]')?.dataset.addMilestone;
      const delGoalId = e.target.closest('[data-del-goal]')?.dataset.delGoal;
      const toggleGoalCompleteId = e.target.closest('[data-toggle-goal-complete]')?.dataset.toggleGoalComplete;

      if (toggleMilestoneAttr) {
        const [goalId, milestoneId] = toggleMilestoneAttr.split(':');
        const goal = cache.trainingGoals.find((g) => g.id === goalId);
        const milestone = goal?.milestones.find((m) => m.id === milestoneId);
        if (!milestone) return;
        milestone.done = !milestone.done;
        await DB.put('trainingGoals', goal);
        return render();
      }
      if (delMilestoneAttr) {
        const [goalId, milestoneId] = delMilestoneAttr.split(':');
        const goal = cache.trainingGoals.find((g) => g.id === goalId);
        if (!goal) return;
        goal.milestones = goal.milestones.filter((m) => m.id !== milestoneId);
        await DB.put('trainingGoals', goal);
        return render();
      }
      if (addMilestoneGoalId) {
        const goal = cache.trainingGoals.find((g) => g.id === addMilestoneGoalId);
        const input = document.getElementById(`milestone-input-${addMilestoneGoalId}`);
        const text = input ? input.value.trim() : '';
        if (!goal || !text) return;
        goal.milestones.push({ id: DB.uid(), text, done: false });
        await DB.put('trainingGoals', goal);
        return render();
      }
      if (delGoalId) {
        if (!confirm('Delete this goal and its milestones?')) return;
        await DB.delete('trainingGoals', delGoalId);
        return render();
      }
      if (toggleGoalCompleteId) {
        const goal = cache.trainingGoals.find((g) => g.id === toggleGoalCompleteId);
        if (!goal) return;
        goal.completed = !goal.completed;
        await DB.put('trainingGoals', goal);
        return render();
      }
      if (progressModeBtn) {
        state.mode = progressModeBtn.dataset.progressMode;
        try { localStorage.setItem(PROGRESS_MODE_KEY, state.mode); } catch (err) { /* ignore */ }
        return render();
      }
      if (trainingTile) {
        state.trainingView = trainingTile;
        return render();
      }
      if (setTrainingLevelAttr) {
        const [skillId, level] = setTrainingLevelAttr.split(':');
        return setTrainingLevel(skillId, Number(level));
      }
      if (delTrainingSkillId) {
        if (!confirm('Remove this skill from your checklist?')) return;
        const allProgress = await DB.getAll('trainingProgress');
        for (const p of allProgress) if (p.skillId === delTrainingSkillId) await DB.delete('trainingProgress', p.id);
        const allHistory = await DB.getAll('trainingHistory');
        for (const h of allHistory) if (h.skillId === delTrainingSkillId) await DB.delete('trainingHistory', h.id);
        await DB.delete('trainingSkills', delTrainingSkillId);
        return render();
      }
      if (delJournalId) {
        if (!confirm('Delete this journal entry?')) return;
        await DB.delete('trainingJournal', delJournalId);
        return render();
      }
      if (manageStyleBtn) {
        state.manageStyle = manageStyleBtn.dataset.manageStyle;
        state.addingNewCategory = false;
        state.newSkillCategoryValue = '';
        return render();
      }
      if (newStyleBtn) {
        const s = newStyleBtn.dataset.newStyle;
        if (state.newStudentStyles.has(s)) state.newStudentStyles.delete(s); else state.newStudentStyles.add(s);
        return render();
      }
      if (toggleStyleBtn) {
        return toggleStudentStyle(state.studentId, toggleStyleBtn.dataset.toggleStyle);
      }
      if (openId) {
        state.view = 'student';
        state.studentId = openId;
        state.editingName = false;
        return render();
      }
      if (setLevelAttr) {
        const [skillId, level] = setLevelAttr.split(':');
        return setLevel(skillId, Number(level));
      }
      if (delSkillId) {
        if (!confirm('Remove this skill from the checklist for everyone?')) return;
        const allProgress = await DB.getAll('progress');
        for (const p of allProgress) if (p.skillId === delSkillId) await DB.delete('progress', p.id);
        const allHistory = await DB.getAll('history');
        for (const h of allHistory) if (h.skillId === delSkillId) await DB.delete('history', h.id);
        await DB.delete('skills', delSkillId);
        await loadAll();
        return render();
      }
      if (delStyleId) {
        const meta = styleMeta(delStyleId);
        if (!confirm(`Remove "${meta.label}"? This also deletes all of its skills and any recorded progress for them, for every student.`)) return;

        const styleSkills = cache.skills.filter((s) => s.style === delStyleId);
        const skillIds = new Set(styleSkills.map((s) => s.id));
        const allProgress = await DB.getAll('progress');
        for (const p of allProgress) if (skillIds.has(p.skillId)) await DB.delete('progress', p.id);
        const allHistory = await DB.getAll('history');
        for (const h of allHistory) if (skillIds.has(h.skillId)) await DB.delete('history', h.id);
        for (const s of styleSkills) await DB.delete('skills', s.id);
        await DB.delete('categoryOrder', delStyleId);
        for (const student of cache.students) {
          if (student.styles && student.styles.includes(delStyleId)) {
            student.styles = student.styles.filter((s) => s !== delStyleId);
            await DB.put('students', student);
          }
        }
        await DB.delete('styles', delStyleId);
        if (state.manageStyle === delStyleId) state.manageStyle = null;
        await loadAll();
        return render();
      }

      switch (action) {
        case 'add-student': {
          const input = document.getElementById('new-student-name');
          const name = input.value.trim();
          if (!name) return;
          await DB.put('students', { id: DB.uid(), name, styles: Array.from(state.newStudentStyles) });
          state.newStudentStyles = new Set();
          state.studentSearchQuery = '';
          await loadAll();
          return render();
        }
        case 'remove-student': {
          const id = e.target.closest('[data-id]').dataset.id;
          if (!confirm('Remove this student and their progress history?')) return;
          const progressRecords = await DB.getAllByIndex('progress', 'byStudent', id);
          for (const p of progressRecords) await DB.delete('progress', p.id);
          const historyRecords = await DB.getAllByIndex('history', 'byStudent', id);
          for (const h of historyRecords) await DB.delete('history', h.id);
          await DB.delete('students', id);
          state.view = 'list';
          await loadAll();
          return render();
        }
        case 'back-to-list':
          state.view = 'list';
          state.studentId = null;
          state.editingName = false;
          await loadAll();
          return render();
        case 'edit-student-name':
          state.editingName = true;
          return render();
        case 'cancel-edit-name':
          state.editingName = false;
          return render();
        case 'save-student-name': {
          const id = e.target.closest('[data-id]').dataset.id;
          const input = document.getElementById('edit-student-name');
          const name = input.value.trim();
          if (!name) return;
          const student = cache.students.find((s) => s.id === id);
          student.name = name;
          await DB.put('students', student);
          state.editingName = false;
          await loadAll();
          return render();
        }
        case 'manage-skills':
          state.view = 'manage-skills';
          return render();
        case 'manage-styles':
          state.view = 'manage-styles';
          return render();
        case 'training-manage-skills':
          state.trainingView = 'manage-skills';
          state.trainingNewSkillCategoryValue = '';
          return render();
        case 'training-back-to-home':
          state.trainingView = 'home';
          return render();
        case 'training-back-to-skills':
          state.trainingView = 'skills';
          return render();
        case 'add-training-skill': {
          const catSelect = document.getElementById('new-training-skill-category-select');
          const nameInput = document.getElementById('new-training-skill-name');
          const name = nameInput.value.trim();
          if (!name) return;
          let category = catSelect.value;
          if (category === '__new__') {
            const newCatInput = document.getElementById('new-training-skill-category-new');
            category = (newCatInput ? newCatInput.value.trim() : '');
            if (!category) return;
          }
          await DB.put('trainingSkills', { id: DB.uid(), name, category, order: cache.trainingSkills.length });
          state.trainingNewSkillCategoryValue = category;
          return render();
        }
        case 'add-journal-entry': {
          const input = document.getElementById('training-journal-input');
          const text = input.value.trim();
          if (!text) return;
          await DB.put('trainingJournal', { id: DB.uid(), date: Date.now(), text });
          return render();
        }
        case 'add-goal': {
          const titleInput = document.getElementById('new-goal-title');
          const dateInput = document.getElementById('new-goal-date');
          const title = titleInput.value.trim();
          if (!title) return;
          // new Date('YYYY-MM-DD') parses as UTC midnight, which can display as the previous
          // day in negative-UTC-offset timezones -- build it from local-time parts instead.
          let targetDate = null;
          if (dateInput.value) {
            const [y, m, d] = dateInput.value.split('-').map(Number);
            targetDate = new Date(y, m - 1, d).getTime();
          }
          await DB.put('trainingGoals', {
            id: DB.uid(), title, targetDate, completed: false, milestones: [],
            order: cache.trainingGoals.length, createdAt: Date.now(),
          });
          return render();
        }
        case 'add-style': {
          const labelInput = document.getElementById('new-style-label');
          const emojiInput = document.getElementById('new-style-emoji');
          const label = labelInput.value.trim();
          if (!label) return;
          const emoji = emojiInput.value.trim() || '⭐';
          const id = slugify(label);
          await DB.put('styles', { id, label, emoji, order: cache.styles.length });
          await loadAll();
          return render();
        }
        case 'force-update': {
          const btn = e.target.closest('[data-action="force-update"]');
          if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
          if (window.forceAppUpdate) await window.forceAppUpdate();
          return;
        }
        case 'share-app-link': {
          const out = document.getElementById('share-app-output');
          if (navigator.share) {
            try {
              await navigator.share({ title: 'Dance Teacher Toolkit', text: 'Dance Teacher Toolkit — music slow-down/count tool and student progress tracker', url: APP_URL });
              return;
            } catch (err) { /* user cancelled or unsupported, fall through to copy */ }
          }
          if (navigator.clipboard) {
            try {
              await navigator.clipboard.writeText(APP_URL);
              if (out) out.innerHTML = '<div class="summary-box">Link copied to clipboard.</div>';
              return;
            } catch (err) { /* ignore */ }
          }
          if (out) out.innerHTML = `<div class="summary-box">Copy this link: ${escapeHtml(APP_URL)}</div>`;
          return;
        }
        case 'export-backup': {
          const out = document.getElementById('backup-output');
          if (out) out.innerHTML = '<div class="summary-box">Preparing backup…</div>';
          const [skills, categoryOrderRecords, students, progress, history, styles, routines, dancers, formations, positions, trainingSkills, trainingProgress, trainingHistory, trainingJournal, trainingGoals] = await Promise.all([
            DB.getAll('skills'), DB.getAll('categoryOrder'), DB.getAll('students'), DB.getAll('progress'), DB.getAll('history'), DB.getAll('styles'),
            DB.getAll('routines'), DB.getAll('dancers'), DB.getAll('formations'), DB.getAll('positions'),
            DB.getAll('trainingSkills'), DB.getAll('trainingProgress'), DB.getAll('trainingHistory'), DB.getAll('trainingJournal'), DB.getAll('trainingGoals'),
          ]);
          // Groove Lab's custom presets live in localStorage (not IndexedDB, like everything
          // else here), since the Metronome module persists its settings that way -- pull
          // them in too so a backup/restore doesn't silently lose a built pattern.
          let groovePresets = [];
          try {
            const raw = localStorage.getItem('dance-toolkit-groove-custom-presets');
            if (raw) groovePresets = JSON.parse(raw);
          } catch (err) { /* ignore */ }
          const backup = {
            app: 'dance-teacher-toolkit', type: 'progress-backup', version: 6,
            exportedAt: new Date().toISOString(),
            skills, categoryOrder: categoryOrderRecords, students, progress, history, styles,
            routines, dancers, formations, positions, groovePresets,
            trainingSkills, trainingProgress, trainingHistory, trainingJournal, trainingGoals,
          };
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
          const fileName = `dance-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`;
          const url = URL.createObjectURL(blob);
          // Render a real link for the user to tap, rather than auto-triggering a click:
          // that async DB read above breaks the "direct user gesture" chain some mobile
          // browsers require for downloads, so a programmatic click can silently fail there.
          const out2 = document.getElementById('backup-output');
          if (out2) {
            const grooveNote = groovePresets.length ? `, ${groovePresets.length} groove preset(s)` : '';
            const journalNote = trainingJournal.length ? `, ${trainingJournal.length} journal entr${trainingJournal.length === 1 ? 'y' : 'ies'}` : '';
            out2.innerHTML = `
              <div class="summary-box">
                <div style="margin-bottom:10px;">Backup ready: ${students.length} student(s), ${skills.length} skill(s)${grooveNote}${journalNote}.</div>
                <a class="btn btn-small" href="${url}" download="${escapeHtml(fileName)}">⬇ Save backup file</a>
              </div>
            `;
          }
          return;
        }
        case 'add-skill': {
          const catSelect = document.getElementById('new-skill-category-select');
          const catNewInput = document.getElementById('new-skill-category-new');
          const nameInput = document.getElementById('new-skill-name');
          const style = state.manageStyle || styleIds()[0];
          let category = catSelect.value;
          if (category === '__new__') category = (catNewInput?.value || '').trim();
          const name = nameInput.value.trim();
          if (!category || !name) return;
          await DB.put('skills', { id: DB.uid(), name, category, style, order: cache.skills.length });
          state.addingNewCategory = false;
          await loadAll();
          return render();
        }
        case 'share-summary': {
          const id = e.target.closest('[data-id]').dataset.id;
          const student = cache.students.find((s) => s.id === id);
          const out = document.getElementById('share-output');
          const doc = generatePdfReport(id);
          const blob = doc.output('blob');
          const fileName = `${student.name.replace(/[^a-z0-9]+/gi, '_')}_progress.pdf`;

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();

          if (out) {
            out.innerHTML = `
              <div class="summary-box">
                <div style="margin-bottom:10px;">PDF downloaded as <b>${escapeHtml(fileName)}</b>.</div>
                <a class="btn btn-small" href="${url}" target="_blank" rel="noopener">Open PDF in new tab</a>
              </div>
              <div class="summary-box" style="padding:0;overflow:hidden;margin-top:10px;">
                <iframe src="${url}" style="width:100%;height:420px;border:0;display:block;"></iframe>
              </div>
            `;
            out.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          return;
        }
      }
    });
  }

  function loadProgressMode() {
    try {
      const saved = localStorage.getItem(PROGRESS_MODE_KEY);
      if (saved === 'training' || saved === 'students') state.mode = saved;
    } catch (err) { /* ignore */ }
  }

  async function init() {
    root = document.getElementById('progress-root');
    wireEvents();
    loadProgressMode();
    await loadAll();
    await render();
  }

  return { init, onShow: () => {} };
})();
