// ── State ──────────────────────────────────────────────────────────────────────
let currentClassId      = null;
let currentQuestionId   = null;
let currentMaxMarks     = 10;
let addMode             = 'single';
let studentMode         = 'one';
let batchRunning        = false;
let currentSectionId    = null;   // teacher: currently selected section for adding questions
let _sections           = {};     // id -> section object (teacher)
let _deadlineTimers     = [];     // interval ids for countdown timers

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res  = await fetch('/api/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const data = await res.json();
        if (data.role === 'teacher') {
            document.getElementById('teacher-name').textContent = data.username;
            document.getElementById('teacher-view').classList.remove('hidden');
            loadTeacherClasses();
        } else {
            document.getElementById('student-name').textContent = data.username;
            document.getElementById('student-view').classList.remove('hidden');
            loadStudentClasses();
        }
    } catch (e) { window.location.href = '/login'; }
});

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Classes
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTeacherClasses() {
    const list = document.getElementById('t-class-list');
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
        const res     = await fetch('/api/classes');
        const classes = await res.json();
        window._tClasses = {};
        classes.forEach(c => window._tClasses[c.id] = c);
        if (classes.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏫</span><p>No classes yet — create one above!</p></div>`;
            return;
        }
        list.innerHTML = classes.map((c, i) => `
            <div class="class-card" style="animation-delay:${i*60}ms" onclick="openTeacherClass(${c.id})">
                <div class="class-card-icon">📖</div>
                <div class="class-card-info">
                    <strong>${escapeHtml(c.name)}</strong>
                    <span class="muted">${c.question_count} question${c.question_count !== 1 ? 's' : ''}</span>
                </div>
                <div class="class-card-code">${escapeHtml(c.code)}</div>
            </div>`).join('');
    } catch (e) { list.innerHTML = '<p class="error-msg">Failed to load classes.</p>'; }
}

function showCreateClass() {
    document.getElementById('create-class-form').classList.remove('hidden');
    document.getElementById('new-class-name').focus();
}
function hideCreateClass() {
    document.getElementById('create-class-form').classList.add('hidden');
    document.getElementById('new-class-name').value = '';
    clearStatus(document.getElementById('create-class-status'));
}
async function createClass() {
    const name   = document.getElementById('new-class-name').value.trim();
    const status = document.getElementById('create-class-status');
    if (!name) { setStatus(status, '⚠️ Enter a class name.', 'error'); return; }
    clearStatus(status);
    try {
        const res = await fetch('/api/classes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const cls = await res.json();
        if (!res.ok) { setStatus(status, '❌ ' + (cls.err || 'Failed'), 'error'); return; }
        hideCreateClass(); loadTeacherClasses();
    } catch (e) { setStatus(status, '❌ Server error.', 'error'); }
}

async function openTeacherClass(id) {
    currentClassId    = id;
    currentSectionId  = null;
    const cls = window._tClasses[id];
    document.getElementById('t-class-list-view').classList.add('hidden');
    document.getElementById('t-class-detail').classList.remove('hidden');
    document.getElementById('t-class-name').textContent    = cls.name;
    document.getElementById('t-class-teacher').textContent = cls.teacher_name;
    document.getElementById('t-class-code').textContent    = cls.code;
    await loadSections();
    teacherTab('questions');
    loadTeacherQuestions();
}
function backToTeacherClasses() {
    currentClassId = null;
    document.getElementById('t-class-detail').classList.add('hidden');
    document.getElementById('t-class-list-view').classList.remove('hidden');
    loadTeacherClasses();
}
function teacherTab(tab) {
    document.querySelectorAll('#t-class-detail .tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`#t-class-detail .tab[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('t-tab-questions').classList.toggle('hidden', tab !== 'questions');
    document.getElementById('t-tab-results').classList.toggle('hidden',   tab !== 'results');
    document.getElementById('t-tab-analytics').classList.toggle('hidden', tab !== 'analytics');
    document.getElementById('t-question-list').classList.toggle('hidden', tab !== 'questions');
    if (tab === 'results')   loadResults();
    if (tab === 'analytics') loadAnalytics();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Sections
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSections() {
    const sel = document.getElementById('t-section-select');
    try {
        const res  = await fetch(`/api/classes/${currentClassId}/sections`);
        const secs = await res.json();
        _sections  = {};
        secs.forEach(s => _sections[s.id] = s);
        sel.innerHTML = '<option value="">— No Section —</option>' +
            secs.map(s => `<option value="${s.id}">${escapeHtml(s.title)}${s.deadline ? ' ⏰' : ''}</option>`).join('');
        sel.value = currentSectionId || '';
        updateSectionDeadlineEditor();
    } catch(e) {}
}

function onTeacherSectionChange() {
    const val = document.getElementById('t-section-select').value;
    currentSectionId = val ? parseInt(val) : null;
    updateSectionDeadlineEditor();
    loadTeacherQuestions();
}

function updateSectionDeadlineEditor() {
    const row     = document.getElementById('section-deadline-edit');
    const delBtn  = document.getElementById('delete-section-btn');
    if (!currentSectionId) {
        row.classList.add('hidden');
        delBtn.style.display = 'none';
        return;
    }
    const sec = _sections[currentSectionId];
    if (!sec) return;
    row.classList.remove('hidden');
    delBtn.style.display = '';
    const inp = document.getElementById('edit-section-deadline');
    inp.value = sec.deadline ? sec.deadline.slice(0, 16) : '';
    clearStatus(document.getElementById('section-deadline-status'));
}

function showCreateSection() { document.getElementById('create-section-form').classList.remove('hidden'); }
function hideCreateSection() {
    document.getElementById('create-section-form').classList.add('hidden');
    document.getElementById('new-section-title').value    = '';
    document.getElementById('new-section-deadline').value = '';
    clearStatus(document.getElementById('create-section-status'));
}
async function createSection() {
    const title    = document.getElementById('new-section-title').value.trim();
    const deadline = document.getElementById('new-section-deadline').value;
    const status   = document.getElementById('create-section-status');
    if (!title) { setStatus(status, '⚠️ Title required.', 'error'); return; }
    try {
        const res = await fetch(`/api/classes/${currentClassId}/sections`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ title, deadline: deadline || null })
        });
        const sec = await res.json();
        if (!res.ok) { setStatus(status, '❌ ' + (sec.err||'Error'), 'error'); return; }
        hideCreateSection();
        await loadSections();
        document.getElementById('t-section-select').value = sec.id;
        currentSectionId = sec.id;
        updateSectionDeadlineEditor();
        loadTeacherQuestions();
    } catch(e) { setStatus(status, '❌ Server error.', 'error'); }
}
async function saveSectionDeadline() {
    if (!currentSectionId) return;
    const deadline = document.getElementById('edit-section-deadline').value;
    const status   = document.getElementById('section-deadline-status');
    try {
        const res = await fetch(`/api/classes/${currentClassId}/sections/${currentSectionId}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ deadline: deadline || '' })
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, '❌ ' + (data.err||'Error'), 'error'); return; }
        _sections[currentSectionId] = data;
        setStatus(status, '✅ Saved!', 'success');
        setTimeout(() => clearStatus(status), 2500);
        await loadSections();
        document.getElementById('t-section-select').value = currentSectionId;
    } catch(e) { setStatus(status, '❌ Server error.', 'error'); }
}
async function deleteCurrentSection() {
    if (!currentSectionId) return;
    const sec = _sections[currentSectionId];
    if (!confirm(`Delete section "${sec.title}" and all its questions?`)) return;
    try {
        await fetch(`/api/classes/${currentClassId}/sections/${currentSectionId}`, { method: 'DELETE' });
        currentSectionId = null;
        await loadSections();
        loadTeacherQuestions();
    } catch(e) { alert('Failed to delete section.'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Add mode toggle
// ═══════════════════════════════════════════════════════════════════════════════

function setAddMode(mode) {
    addMode = mode;
    document.getElementById('mode-single-btn').classList.toggle('active', mode === 'single');
    document.getElementById('mode-bulk-btn').classList.toggle('active', mode === 'bulk');
    document.getElementById('single-add-panel').classList.toggle('hidden', mode !== 'single');
    document.getElementById('bulk-add-panel').classList.toggle('hidden', mode !== 'bulk');
    if (mode === 'bulk') renderBulkSlots();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Single add
// ═══════════════════════════════════════════════════════════════════════════════

async function postQuestion() {
    const text       = document.getElementById('new-q-text').value.trim();
    const ref_answer = document.getElementById('new-q-ref').value.trim();
    const btn        = document.getElementById('post-btn');
    const status     = document.getElementById('post-status');
    if (!text || !ref_answer) { setStatus(status, '⚠️ Both fields are required.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Adding…'; clearStatus(status);
    try {
        const res = await fetch(`/api/classes/${currentClassId}/questions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, ref_answer, section_id: currentSectionId || null })
        });
        const q = await res.json();
        if (!res.ok) { setStatus(status, '❌ ' + (q.err || 'Failed'), 'error'); return; }
        document.getElementById('new-q-text').value = '';
        document.getElementById('new-q-ref').value  = '';
        setStatus(status, '✅ Question added!', 'success');
        setTimeout(() => clearStatus(status), 3000);
        loadTeacherQuestions();
    } catch (e) { setStatus(status, '❌ Server error.', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Add Question'; }
}

// ── Teacher: Multi-Q&A PDF upload ──────────────────────────────────────────────
async function handleTeacherMultiPdf(input) {
    const status  = document.getElementById('teacher-pdf-status');
    const preview = document.getElementById('teacher-pdf-preview');
    if (!input.files[0]) return;
    setStatus(status, '⏳ Extracting…', '');
    const fd = new FormData(); fd.append('file', input.files[0]);
    try {
        const res  = await fetch('/api/extract-pdf/multi-qa', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) { setStatus(status, '❌ ' + data.err, 'error'); return; }
        const pairs = data.pairs;
        if (!pairs || pairs.length === 0) { setStatus(status, '⚠️ No Q&A pairs found.', 'error'); return; }

        const container = document.getElementById('teacher-pdf-pairs');
        container.innerHTML = pairs.map((p, i) => `
            <div class="pdf-preview-pair" id="pdf-pair-${i}">
                <div class="pdf-pair-num">Pair ${i+1}</div>
                <div class="pdf-preview-cols">
                    <div>
                        <label>Question</label>
                        <textarea id="pdf-pair-q-${i}" rows="2">${escapeHtml(p.question)}</textarea>
                    </div>
                    <div>
                        <label>Reference Answer</label>
                        <textarea id="pdf-pair-ref-${i}" rows="2">${escapeHtml(p.ref_answer)}</textarea>
                    </div>
                </div>
            </div>`).join('');
        container.dataset.count = pairs.length;
        preview.classList.remove('hidden');
        setStatus(status, `✅ Found ${pairs.length} pair${pairs.length>1?'s':''}.`, 'success');
    } catch (e) { setStatus(status, '❌ Server error.', 'error'); }
    input.value = '';
}
function hidePdfPreview() {
    document.getElementById('teacher-pdf-preview').classList.add('hidden');
    document.getElementById('teacher-pdf-pairs').innerHTML = '';
    clearStatus(document.getElementById('teacher-pdf-status'));
}
async function addAllPdfPairs() {
    const container = document.getElementById('teacher-pdf-pairs');
    const n         = parseInt(container.dataset.count || '0');
    const status    = document.getElementById('teacher-pdf-add-status');
    if (n === 0) return;
    const questions = [];
    for (let i = 0; i < n; i++) {
        const q   = (document.getElementById(`pdf-pair-q-${i}`)?.value || '').trim();
        const ref = (document.getElementById(`pdf-pair-ref-${i}`)?.value || '').trim();
        if (q && ref) questions.push({ text: q, ref_answer: ref, slot: i+1 });
    }
    if (questions.length === 0) { setStatus(status, '⚠️ No valid pairs.', 'error'); return; }
    setStatus(status, `⏳ Adding ${questions.length} question${questions.length>1?'s':''}…`, '');
    try {
        const res  = await fetch(`/api/classes/${currentClassId}/questions/bulk`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ questions, section_id: currentSectionId || null })
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, '❌ ' + (data.err||'Error'), 'error'); return; }
        setStatus(status, `✅ ${data.added} question${data.added>1?'s':''} added!`, 'success');
        setTimeout(hidePdfPreview, 2000);
        loadTeacherQuestions();
    } catch(e) { setStatus(status, '❌ Server error.', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Bulk add
// ═══════════════════════════════════════════════════════════════════════════════

function clampCount(input) {
    let v = Math.max(1, Math.min(20, parseInt(input.value) || 1));
    input.value = v; updateBulkCountLabels(v);
}
function changeCount(delta) {
    const input = document.getElementById('bulk-count');
    let v = Math.max(1, Math.min(20, (parseInt(input.value) || 1) + delta));
    input.value = v; updateBulkCountLabels(v); renderBulkSlots();
}
function updateBulkCountLabels(n) {
    document.getElementById('bulk-count-label').textContent = n;
    document.querySelectorAll('.bulk-count-label-2').forEach(el => el.textContent = n);
}
function renderBulkSlots() {
    const n    = Math.max(1, Math.min(20, parseInt(document.getElementById('bulk-count').value) || 3));
    const wrap = document.getElementById('bulk-slots');
    const cur  = wrap.querySelectorAll('.bulk-slot').length;
    updateBulkCountLabels(n);
    for (let i = cur; i < n; i++) {
        const slot = document.createElement('div');
        slot.className = 'bulk-slot'; slot.dataset.slot = i + 1;
        slot.innerHTML = `
            <div class="bulk-slot-header">
                <span class="bulk-slot-num">Question ${i + 1}</span>
                <span class="bulk-slot-status" id="bslot-status-${i+1}"></span>
            </div>
            <label>Question Text</label>
            <textarea id="bslot-q-${i+1}" rows="2" placeholder="Write question ${i+1}…"></textarea>
            <label>Reference Answer</label>
            <textarea id="bslot-ref-${i+1}" rows="3" placeholder="Write the ideal answer…"></textarea>`;
        wrap.appendChild(slot);
    }
    const slots = wrap.querySelectorAll('.bulk-slot');
    for (let i = n; i < slots.length; i++) slots[i].remove();
    hideBulkProgress();
    clearStatus(document.getElementById('bulk-bottom-status'));
}

async function handleBulkMultiPdf(input) {
    const st = document.getElementById('bulk-multi-pdf-status');
    if (!input.files[0]) return;
    setStatus(st, '⏳ Extracting…', '');
    const fd = new FormData(); fd.append('file', input.files[0]);
    try {
        const res  = await fetch('/api/extract-pdf/multi-qa', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) { setStatus(st, '❌ ' + data.err, 'error'); return; }
        const pairs = data.pairs || [];
        if (pairs.length === 0) { setStatus(st, '⚠️ No pairs found.', 'error'); return; }
        // Resize slots to fit
        const needed = pairs.length;
        document.getElementById('bulk-count').value = needed;
        updateBulkCountLabels(needed);
        renderBulkSlots();
        pairs.forEach((p, i) => {
            const qEl  = document.getElementById(`bslot-q-${i+1}`);
            const rEl  = document.getElementById(`bslot-ref-${i+1}`);
            if (qEl)  qEl.value  = p.question;
            if (rEl)  rEl.value  = p.ref_answer;
        });
        setStatus(st, `✅ Filled ${pairs.length} slot${pairs.length>1?'s':''} — review and publish!`, 'success');
    } catch(e) { setStatus(st, '❌ Error.', 'error'); }
    input.value = '';
}

function clearAllSlots() {
    const n = parseInt(document.getElementById('bulk-count').value) || 3;
    for (let i = 1; i <= n; i++) {
        ['bslot-q-','bslot-ref-'].forEach(p => { const el = document.getElementById(p+i); if (el) el.value = ''; });
        const stEl = document.getElementById(`bslot-status-${i}`);
        if (stEl) { stEl.textContent = ''; stEl.className = 'bulk-slot-status'; }
        const slot = document.querySelector(`.bulk-slot[data-slot="${i}"]`);
        if (slot) slot.classList.remove('slot-state-ok','slot-state-error','slot-state-skip');
    }
    hideBulkProgress();
    clearStatus(document.getElementById('bulk-bottom-status'));
}

async function submitBulk() {
    const n   = parseInt(document.getElementById('bulk-count').value) || 3;
    const btn = document.getElementById('bulk-submit-btn');
    const bs  = document.getElementById('bulk-bottom-status');
    const questions = [];
    for (let i = 1; i <= n; i++) questions.push({ slot: i, text: (document.getElementById(`bslot-q-${i}`)?.value||'').trim(), ref_answer: (document.getElementById(`bslot-ref-${i}`)?.value||'').trim() });
    let hasErrors = false;
    questions.forEach(q => {
        const slot = document.querySelector(`.bulk-slot[data-slot="${q.slot}"]`);
        const st   = document.getElementById(`bslot-status-${q.slot}`);
        slot?.classList.remove('slot-state-ok','slot-state-error','slot-state-skip');
        document.getElementById(`bslot-q-${q.slot}`)?.classList.remove('slot-error');
        document.getElementById(`bslot-ref-${q.slot}`)?.classList.remove('slot-error');
        if (!q.text && !q.ref_answer) return;
        if (!q.text) { document.getElementById(`bslot-q-${q.slot}`)?.classList.add('slot-error'); slot?.classList.add('slot-state-error'); if(st){st.textContent='⚠️ Missing question';st.className='bulk-slot-status error';} hasErrors=true; }
        else if (!q.ref_answer) { document.getElementById(`bslot-ref-${q.slot}`)?.classList.add('slot-error'); slot?.classList.add('slot-state-error'); if(st){st.textContent='⚠️ Missing answer';st.className='bulk-slot-status error';} hasErrors=true; }
    });
    if (hasErrors) { setStatus(bs, '⚠️ Fix highlighted slots first.', 'error'); return; }
    if (!questions.some(q => q.text || q.ref_answer)) { setStatus(bs, '⚠️ Fill in at least one question.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Publishing…';
    clearStatus(bs); showBulkProgress(0, questions.filter(q=>q.text||q.ref_answer).length);
    try {
        const res  = await fetch(`/api/classes/${currentClassId}/questions/bulk`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ questions, section_id: currentSectionId || null })
        });
        const data = await res.json();
        if (!res.ok) { setStatus(bs, '❌ ' + (data.err||'Server error'), 'error'); return; }
        const rmap = {}; data.results.forEach(r => rmap[r.slot] = r);
        let added = 0;
        questions.forEach(q => {
            const r    = rmap[q.slot];
            const slot = document.querySelector(`.bulk-slot[data-slot="${q.slot}"]`);
            const st   = document.getElementById(`bslot-status-${q.slot}`);
            if (!r || r.status === 'skipped') { slot?.classList.add('slot-state-skip'); return; }
            if (r.status === 'ok') { slot?.classList.add('slot-state-ok'); if(st){st.textContent='✅ Added';st.className='bulk-slot-status success';} added++; updateBulkProgress(added, data.added); }
            else { slot?.classList.add('slot-state-error'); if(st){st.textContent='❌ '+r.reason;st.className='bulk-slot-status error';} }
        });
        const skipped = data.results.filter(r=>r.status==='skipped').length;
        const errored = data.results.filter(r=>r.status==='error').length;
        let summary = `✅ ${data.added} question${data.added!==1?'s':''} published`;
        if (skipped) summary += ` · ${skipped} skipped`;
        if (errored) summary += ` · ${errored} failed`;
        setStatus(bs, summary, 'success');
        updateBulkProgress(data.added, data.added);
        loadTeacherQuestions();
        setTimeout(() => {
            questions.forEach(q => {
                const r = rmap[q.slot];
                if (!r || r.status==='ok' || r.status==='skipped') {
                    const qEl = document.getElementById(`bslot-q-${q.slot}`); if(qEl) qEl.value='';
                    const rEl = document.getElementById(`bslot-ref-${q.slot}`); if(rEl) rEl.value='';
                    const slot = document.querySelector(`.bulk-slot[data-slot="${q.slot}"]`);
                    slot?.classList.remove('slot-state-ok','slot-state-skip');
                    const st = document.getElementById(`bslot-status-${q.slot}`); if(st){st.textContent='';st.className='bulk-slot-status';}
                }
            });
        }, 2500);
    } catch (e) { setStatus(bs, '❌ Server error.', 'error'); }
    finally { btn.disabled=false; btn.innerHTML=`Publish All <span id="bulk-count-label">${n}</span> Questions`; }
}
function showBulkProgress(d,t) { document.getElementById('bulk-progress-wrap').classList.remove('hidden'); updateBulkProgress(d,t); }
function hideBulkProgress()    { document.getElementById('bulk-progress-wrap').classList.add('hidden'); }
function updateBulkProgress(d,t) {
    const pct = t>0 ? Math.round(d/t*100) : 0;
    document.getElementById('bulk-progress-fill').style.width = pct+'%';
    document.getElementById('bulk-progress-label').textContent = `${d} / ${t} added`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Questions list
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTeacherQuestions() {
    const list = document.getElementById('t-question-list');
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
        const [qRes, secRes] = await Promise.all([
            fetch(`/api/classes/${currentClassId}/questions`),
            fetch(`/api/classes/${currentClassId}/sections`)
        ]);
        const qs   = await qRes.json();
        const secs = await secRes.json();
        window._tQuestions = {}; qs.forEach(q => window._tQuestions[q.id] = q);
        const secMap = {}; secs.forEach(s => secMap[s.id] = s);

        if (qs.length === 0) { list.innerHTML = '<p class="muted" style="margin-top:4px">No questions yet — add one above.</p>'; return; }

        // Group by section
        const grouped = {}; // sectionId (or 'none') -> questions[]
        qs.forEach(q => {
            const key = q.section_id ? String(q.section_id) : 'none';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(q);
        });

        let html = '';
        let globalIdx = 0;

        // First render questions in sections, then unsectioned
        secs.forEach(sec => {
            const sqList = grouped[String(sec.id)] || [];
            html += `<div class="section-group">
                <div class="section-group-header">
                    <span class="section-group-title">${escapeHtml(sec.title)}</span>
                    ${sec.deadline ? `<span class="section-deadline-badge">⏰ ${formatDeadline(sec.deadline)}</span>` : ''}
                    <span class="section-q-count">${sqList.length} question${sqList.length!==1?'s':''}</span>
                </div>`;
            sqList.forEach(q => {
                globalIdx++;
                html += renderTeacherQRow(q, globalIdx);
            });
            html += `</div>`;
        });

        // Unsectioned
        if (grouped['none'] && grouped['none'].length > 0) {
            html += `<div class="section-group">
                <div class="section-group-header"><span class="section-group-title muted">Unsectioned</span></div>`;
            grouped['none'].forEach(q => {
                globalIdx++;
                html += renderTeacherQRow(q, globalIdx);
            });
            html += `</div>`;
        }

        list.innerHTML = `<div class="q-list-header">${qs.length} Question${qs.length!==1?'s':''} in this class</div>` + html;
    } catch (e) { list.innerHTML = '<p class="error-msg">Failed to load questions.</p>'; }
}

function renderTeacherQRow(q, idx) {
    return `<div class="q-row" id="qrow-${q.id}">
        <div class="q-row-num">Q${idx}</div>
        <p class="q-row-text">${escapeHtml(q.text)}</p>
        <button class="btn-delete" onclick="deleteQuestion(${q.id})" title="Delete">✕</button>
    </div>`;
}

async function deleteQuestion(qId) {
    if (!confirm('Delete this question?')) return;
    try { await fetch(`/api/classes/${currentClassId}/questions/${qId}`, { method: 'DELETE' }); loadTeacherQuestions(); }
    catch (e) { alert('Failed to delete.'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Results
// ═══════════════════════════════════════════════════════════════════════════════

async function loadResults() {
    const c = document.getElementById('results-list');
    c.innerHTML = '<p class="muted">Loading…</p>';
    try {
        const res  = await fetch(`/api/classes/${currentClassId}/submissions`);
        const subs = await res.json();
        if (subs.length === 0) { c.innerHTML = '<p class="muted">No submissions yet.</p>'; return; }
        c.innerHTML = subs.map(s => `
            <div class="result-row">
                <div class="result-row-meta">
                    <strong>${escapeHtml(s.student_name)}</strong>
                    <span class="muted q-excerpt">${escapeHtml(s.question_text)}</span>
                    ${s.submitted_at ? `<span class="muted small">${formatDate(s.submitted_at)}</span>` : ''}
                </div>
                <p class="result-row-answer">${escapeHtml(s.answer)}</p>
                <div class="result-row-footer">
                    <span class="score-badge score-${scoreClass(s.score,s.max_marks)}">${s.score}/${s.max_marks}</span>
                    <span class="feedback-text">${escapeHtml(s.feedback)}</span>
                </div>
            </div>`).join('');
    } catch (e) { c.innerHTML = '<p class="error-msg">Failed to load.</p>'; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER — Analytics
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAnalytics() {
    const container = document.getElementById('analytics-container');
    container.innerHTML = '<p class="muted">Loading analytics…</p>';
    try {
        const res  = await fetch(`/api/classes/${currentClassId}/analytics`);
        const data = await res.json();
        if (!res.ok) { container.innerHTML = '<p class="error-msg">Failed to load analytics.</p>'; return; }

        const scoreColor = pct => pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--error)';

        // Distribution bar chart (inline CSS bars)
        const distMax = Math.max(...data.score_distribution, 1);
        const distBars = data.score_distribution.map((v, i) => `
            <div class="dist-bar-item">
                <div class="dist-bar-wrap">
                    <div class="dist-bar-fill" style="height:${Math.round(v/distMax*100)}%;background:${scoreColor([20,40,60,80,100][i])}"></div>
                </div>
                <div class="dist-bar-label">${data.dist_labels[i]}</div>
                <div class="dist-bar-count">${v}</div>
            </div>`).join('');

        // Leaderboard rows
        const lbRows = data.leaderboard.map((s, i) => `
            <div class="lb-row">
                <span class="lb-rank">${i+1}</span>
                <span class="lb-name">${escapeHtml(s.name)}</span>
                <div class="lb-bar-wrap"><div class="lb-bar-fill" style="width:${s.pct}%;background:${scoreColor(s.pct)}"></div></div>
                <span class="lb-pct" style="color:${scoreColor(s.pct)}">${s.pct}%</span>
                <span class="lb-detail muted">${s.total}/${s.max}</span>
            </div>`).join('') || '<p class="muted">No submissions yet.</p>';

        // Per-question performance
        const qRows = data.question_stats.map(q => `
            <div class="q-stat-row">
                <div class="q-stat-text">${escapeHtml(q.text)}${q.section_title ? `<span class="q-stat-section">${escapeHtml(q.section_title)}</span>` : ''}</div>
                <div class="q-stat-bar-wrap"><div class="q-stat-bar-fill" style="width:${q.pct}%;background:${scoreColor(q.pct)}"></div></div>
                <span class="q-stat-pct" style="color:${scoreColor(q.pct)}">${q.pct}%</span>
                <span class="q-stat-count muted">(${q.count} sub.)</span>
            </div>`).join('') || '<p class="muted">No data.</p>';

        // Per-section stats
        const secRows = data.section_stats.map(s => `
            <div class="q-stat-row">
                <div class="q-stat-text">${escapeHtml(s.title)}</div>
                <div class="q-stat-bar-wrap"><div class="q-stat-bar-fill" style="width:${s.pct}%;background:${scoreColor(s.pct)}"></div></div>
                <span class="q-stat-pct" style="color:${scoreColor(s.pct)}">${s.pct}%</span>
                <span class="q-stat-count muted">(${s.submissions} sub.)</span>
            </div>`).join('') || '<p class="muted">No sections.</p>';

        container.innerHTML = `
            <!-- Summary KPIs -->
            <div class="analytics-kpi-row">
                <div class="kpi-card">
                    <div class="kpi-value">${data.total_students}</div>
                    <div class="kpi-label">Students Enrolled</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-value">${data.total_submissions}</div>
                    <div class="kpi-label">Total Submissions</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-value" style="color:${scoreColor(data.overall_pct)}">${data.overall_pct}%</div>
                    <div class="kpi-label">Class Average</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-value">${data.total_questions}</div>
                    <div class="kpi-label">Questions</div>
                </div>
            </div>

            <!-- Score distribution -->
            <div class="analytics-card">
                <div class="analytics-card-title">Score Distribution</div>
                <div class="dist-bars">${distBars}</div>
            </div>

            ${data.section_stats.length > 0 ? `
            <div class="analytics-card">
                <div class="analytics-card-title">Performance by Section</div>
                ${secRows}
            </div>` : ''}

            <!-- Per-question performance -->
            <div class="analytics-card">
                <div class="analytics-card-title">Performance by Question <span class="muted small">(sorted lowest → highest)</span></div>
                ${qRows}
            </div>

            <!-- Leaderboard -->
            <div class="analytics-card">
                <div class="analytics-card-title">Student Leaderboard <span class="muted small">(top 20)</span></div>
                <div class="lb-list">${lbRows}</div>
            </div>`;
    } catch (e) { container.innerHTML = '<p class="error-msg">Failed to load analytics.</p>'; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — Classes + Join
// ═══════════════════════════════════════════════════════════════════════════════

async function loadStudentClasses() {
    const list = document.getElementById('s-class-list');
    list.innerHTML = '<p class="muted">Loading your classes…</p>';
    try {
        const res     = await fetch('/api/classes');
        const classes = await res.json();
        window._sClasses = {}; classes.forEach(c => window._sClasses[c.id] = c);
        if (classes.length === 0) {
            list.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><p>You haven't joined any classes yet.</p><p class="muted">Click <strong>Join a Class</strong> and enter your teacher's code.</p></div>`;
            return;
        }
        list.innerHTML = classes.map((c,i) => `
            <div class="class-card" style="animation-delay:${i*60}ms" onclick="openStudentClass(${c.id})">
                <div class="class-card-icon">📖</div>
                <div class="class-card-info">
                    <strong>${escapeHtml(c.name)}</strong>
                    <span class="muted">by ${escapeHtml(c.teacher_name)} · ${c.question_count} question${c.question_count!==1?'s':''}</span>
                </div>
                <span class="chevron">›</span>
            </div>`).join('');
    } catch (e) { list.innerHTML = '<p class="error-msg">Failed to load classes.</p>'; }
}
function showJoinClass()  { document.getElementById('join-class-form').classList.remove('hidden'); document.getElementById('join-code-input').focus(); }
function hideJoinClass()  { document.getElementById('join-class-form').classList.add('hidden'); document.getElementById('join-code-input').value=''; clearError(document.getElementById('join-error')); }
async function joinClass() {
    const code  = document.getElementById('join-code-input').value.trim().toUpperCase();
    const errEl = document.getElementById('join-error');
    if (!code) { showError(errEl,'Enter a join code.'); return; }
    clearError(errEl);
    try {
        const res  = await fetch('/api/classes/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}) });
        const data = await res.json();
        if (!res.ok) { showError(errEl, data.err||'Failed to join.'); return; }
        hideJoinClass(); loadStudentClasses();
    } catch (e) { showError(errEl,'Server error. Please try again.'); }
}

function openStudentClass(id) {
    currentClassId = id;
    const cls = window._sClasses[id];
    document.getElementById('s-class-list-view').classList.add('hidden');
    document.getElementById('s-class-detail').classList.remove('hidden');
    document.getElementById('s-class-name').textContent    = cls.name;
    document.getElementById('s-class-teacher').textContent = cls.teacher_name;
    studentMode = 'one';
    document.getElementById('s-mode-one-btn').classList.add('active');
    document.getElementById('s-mode-all-btn').classList.remove('active');
    document.getElementById('s-question-list').classList.remove('hidden');
    document.getElementById('s-batch-panel').classList.add('hidden');
    loadStudentQuestions();
}
function backToStudentClasses() {
    clearDeadlineTimers();
    currentClassId = null;
    document.getElementById('s-class-detail').classList.add('hidden');
    document.getElementById('s-class-list-view').classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — Grade history
// ═══════════════════════════════════════════════════════════════════════════════

async function showGradeHistory() {
    document.getElementById('grade-history-overlay').classList.remove('hidden');
    const list = document.getElementById('grade-history-list');
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
        const res  = await fetch('/api/my-grades');
        const data = await res.json();
        if (!res.ok || data.length === 0) {
            list.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><p>No grades yet.</p></div>'; return;
        }
        // Group by class
        const byClass = {};
        data.forEach(g => {
            if (!byClass[g.class_id]) byClass[g.class_id] = { name: g.class_name, grades: [] };
            byClass[g.class_id].grades.push(g);
        });
        list.innerHTML = Object.values(byClass).map(cls => {
            const avg = Math.round(cls.grades.reduce((s,g) => s + g.score/g.max_marks, 0) / cls.grades.length * 100);
            return `<div class="grade-class-group">
                <div class="grade-class-name">${escapeHtml(cls.name)}<span class="grade-avg-badge" style="background:${avg>=80?'var(--success-bg)':avg>=50?'var(--warn-bg)':'var(--error-bg)'}; color:${avg>=80?'var(--success)':avg>=50?'var(--warn)':'var(--error)'}">Avg ${avg}%</span></div>
                ${cls.grades.map(g => `
                    <div class="grade-row">
                        <div class="grade-q-text">${escapeHtml(g.question_text)}${g.question_text.length===120?'…':''}</div>
                        <div class="grade-row-footer">
                            <span class="score-badge score-${scoreClass(g.score,g.max_marks)}">${g.score}/${g.max_marks}</span>
                            <span class="feedback-text">${escapeHtml(g.feedback||'')}</span>
                            ${g.submitted_at ? `<span class="muted small">${formatDate(g.submitted_at)}</span>` : ''}
                        </div>
                    </div>`).join('')}
            </div>`;
        }).join('');
    } catch(e) { list.innerHTML = '<p class="error-msg">Failed to load grades.</p>'; }
}
function hideGradeHistory() { document.getElementById('grade-history-overlay').classList.add('hidden'); }

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — Questions
// ═══════════════════════════════════════════════════════════════════════════════

async function loadStudentQuestions() {
    clearDeadlineTimers();
    const list = document.getElementById('s-question-list');
    list.innerHTML = '<p class="muted">Loading questions…</p>';
    try {
        const [qRes, secRes] = await Promise.all([
            fetch(`/api/classes/${currentClassId}/questions`),
            fetch(`/api/classes/${currentClassId}/sections`)
        ]);
        const qs   = await qRes.json();
        const secs = await secRes.json();
        window._sQuestions = {}; qs.forEach(q => window._sQuestions[q.id] = q);
        const secMap = {}; secs.forEach(s => secMap[s.id] = s);

        if (qs.length === 0) { list.innerHTML = `<div class="empty-state"><span class="empty-icon">📝</span><p>No questions posted yet.</p></div>`; return; }

        // Group by section
        const grouped = {};
        qs.forEach(q => {
            const key = q.section_id ? String(q.section_id) : 'none';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(q);
        });

        let html      = '';
        let globalIdx = 0;

        secs.forEach(sec => {
            const sqList = grouped[String(sec.id)] || [];
            if (sqList.length === 0) return;
            html += `<div class="section-group student-section-group">
                <div class="section-group-header">
                    <span class="section-group-title">${escapeHtml(sec.title)}</span>
                    ${sec.deadline ? `<span class="deadline-countdown" id="countdown-${sec.id}" data-deadline="${sec.deadline}">⏰ Loading…</span>` : ''}
                </div>`;
            sqList.forEach(q => {
                globalIdx++;
                html += renderStudentQCard(q, globalIdx);
            });
            html += `</div>`;
        });

        if (grouped['none'] && grouped['none'].length > 0) {
            html += `<div class="section-group student-section-group">
                <div class="section-group-header"><span class="section-group-title muted">Other Questions</span></div>`;
            grouped['none'].forEach(q => {
                globalIdx++;
                html += renderStudentQCard(q, globalIdx);
            });
            html += `</div>`;
        }

        list.innerHTML = html;

        // Start countdown timers
        secs.forEach(sec => {
            if (sec.deadline) startCountdown(sec.id, sec.deadline);
        });
    } catch (e) { list.innerHTML = '<p class="error-msg">Failed to load questions.</p>'; }
}

function renderStudentQCard(q, idx) {
    const submitted = q.submitted;
    return `<div class="q-card${submitted?' q-card-submitted':''}" style="animation-delay:${(idx-1)*60}ms">
        <div class="q-card-num">Q${idx}</div>
        <p class="q-card-text">${escapeHtml(q.text)}</p>
        ${submitted
            ? `<span class="submitted-badge">✅ Submitted</span>`
            : `<button class="btn-primary small" onclick="openQuestion(${q.id},${q.max_marks})">Answer →</button>`}
    </div>`;
}

function startCountdown(secId, deadlineStr) {
    const el = document.getElementById(`countdown-${secId}`);
    if (!el) return;
    const deadline = new Date(deadlineStr);

    function update() {
        const diff = deadline - Date.now();
        if (diff <= 0) {
            el.textContent = '⏰ Deadline passed';
            el.classList.add('deadline-past');
            return;
        }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000)  / 60000);
        const s = Math.floor((diff % 60000)    / 1000);
        el.textContent = d > 0
            ? `⏰ ${d}d ${h}h ${m}m left`
            : `⏰ ${h}h ${m}m ${s}s left`;
        el.classList.toggle('deadline-urgent', diff < 3600000); // < 1h
    }
    update();
    const iv = setInterval(update, 1000);
    _deadlineTimers.push(iv);
}
function clearDeadlineTimers() { _deadlineTimers.forEach(clearInterval); _deadlineTimers = []; }

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — Mode toggle
// ═══════════════════════════════════════════════════════════════════════════════

function setStudentMode(mode) {
    if (batchRunning) return;
    studentMode = mode;
    document.getElementById('s-mode-one-btn').classList.toggle('active', mode === 'one');
    document.getElementById('s-mode-all-btn').classList.toggle('active', mode === 'all');
    document.getElementById('s-question-list').classList.toggle('hidden', mode !== 'one');
    document.getElementById('s-batch-panel').classList.toggle('hidden', mode !== 'all');
    if (mode === 'all') renderBatchSlots();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — One-at-a-time
// ═══════════════════════════════════════════════════════════════════════════════

function openQuestion(id, maxMarks) {
    currentQuestionId=id; currentMaxMarks=maxMarks||10;
    const q = window._sQuestions[id];
    document.getElementById('s-class-detail').classList.add('hidden');
    document.getElementById('s-answer-view').classList.remove('hidden');
    document.getElementById('active-q-text').textContent = q.text;
    document.getElementById('student-answer').value      = '';
    document.getElementById('result-card').classList.add('hidden');
    document.getElementById('submit-btn').classList.remove('hidden');
    document.getElementById('score-denom').textContent   = '/'+currentMaxMarks;
    clearError(document.getElementById('answer-error'));
    clearStatus(document.getElementById('student-pdf-status'));
    window.scrollTo({top:0,behavior:'smooth'});
}
function backToStudentClass() {
    currentQuestionId=null;
    document.getElementById('s-answer-view').classList.add('hidden');
    document.getElementById('s-class-detail').classList.remove('hidden');
}

async function handleStudentPdf(input) {
    const st = document.getElementById('student-pdf-status');
    if (!input.files[0]) return;
    setStatus(st,'⏳ Extracting text from PDF…','');
    const fd = new FormData(); fd.append('file',input.files[0]);
    try {
        const res=await fetch('/api/extract-pdf',{method:'POST',body:fd}); const data=await res.json();
        if (!res.ok) { setStatus(st,'❌ '+data.err,'error'); return; }
        document.getElementById('student-answer').value=data.text;
        setStatus(st,'✅ Text extracted — review and submit.','success');
    } catch(e) { setStatus(st,'❌ Server error.','error'); }
    input.value='';
}

async function submitAnswer() {
    const answer = document.getElementById('student-answer').value.trim();
    const btn = document.getElementById('submit-btn'); // Get the button
    const errEl = document.getElementById('answer-error');

    if (!answer) { errEl.classList.remove('hidden'); return; }
    
    // Prevent multiple clicks
    btn.disabled = true; 
    clearError(errEl);
    showLoading('Evaluating your answer with AI…');

    try {
        const res = await fetch('/api/evaluate', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ question_id: currentQuestionId, answer }) 
        });
        const data = await res.json();
        hideLoading();
        if (!res.ok) { 
            btn.disabled = false; 
            showError(errEl, '❌ ' + (data.err || 'Server error. Please try again.')); 
            return; 
        }
        showResult(data.score, data.max_marks, data.feedback);
    } catch(e) { 
        hideLoading(); 
        btn.disabled = false; // Re-enable on error
        showError(errEl, '❌ Server error. Please try again.'); 
    }
}
let scoreInterval = null; // Ensure this is at the top level of script.js

function showResult(score, maxMarks, feedback) {
    // 1. Immediately stop any previous animations
    if (scoreInterval) {
        clearInterval(scoreInterval);
        scoreInterval = null;
    }

    // 2. Hide the submit button and show card
    document.getElementById('submit-btn').classList.add('hidden');
    const card = document.getElementById('result-card');
    card.classList.remove('hidden');
    
    const scoreEl = document.getElementById('score-num');
    
    // 3. Ensure score is a valid number
    const targetScore = Math.round(score || 0); 
    let cur = 0;
    scoreEl.textContent = cur;

    // 4. Only animate if there is a score to show
    if (targetScore > 0) {
        scoreInterval = setInterval(() => { 
            cur++; 
            scoreEl.textContent = cur;
            if (cur >= targetScore) {
                clearInterval(scoreInterval);
                scoreInterval = null;
            } 
        }, 80);
    } else {
        scoreEl.textContent = "0";
    }

    // 5. Update Ring and Feedback
    const ring = document.getElementById('ring-fill');
    const pct = maxMarks > 0 ? (targetScore / maxMarks) : 0;
    
    ring.style.strokeDashoffset = 326.7 * (1 - pct);
    ring.style.stroke = pct >= 0.8 ? '#1a6b3a' : pct >= 0.5 ? '#8a5a00' : '#c0392b';

    document.getElementById('result-feedback').innerHTML = `
        <p class="feedback-headline">${pct >= 0.5 ? '🎉 Well done!' : '💡 Keep practicing'}</p>
        <p class="feedback-detail">${escapeHtml(feedback)}</p>`;
    
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — Batch submit-all with multi-PDF
// ═══════════════════════════════════════════════════════════════════════════════

function renderBatchSlots() {
    const qs   = Object.values(window._sQuestions || {});
    const wrap = document.getElementById('s-batch-slots');
    wrap.innerHTML = '';
    clearStatus(document.getElementById('batch-status'));
    document.getElementById('batch-progress-wrap').classList.add('hidden');

    if (qs.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><span class="empty-icon">📝</span><p>No questions in this class yet.</p></div>`;
        return;
    }
    qs.forEach((q, i) => {
        const slot = document.createElement('div');
        slot.className   = 'batch-slot';
        slot.dataset.qid = q.id;
        slot.id          = `batchslot-${q.id}`;
        const submittedBadge = q.submitted ? `<span class="submitted-badge-sm">✅ Previously submitted</span>` : '';
        slot.innerHTML   = `
            <div class="batch-slot-header">
                <div>
                    <p class="batch-slot-qnum">Question ${i+1} · ${q.max_marks} marks ${submittedBadge}</p>
                    <p class="batch-slot-qtext">${escapeHtml(q.text)}</p>
                </div>
                <span class="batch-slot-status" id="batchslot-status-${q.id}"></span>
            </div>
            <textarea id="batchslot-ans-${q.id}" rows="4" placeholder="Write your answer here…"></textarea>
            <div id="batchslot-result-${q.id}" class="hidden"></div>`;
        wrap.appendChild(slot);
    });
}

// Student: upload one PDF and auto-distribute answers to slots
async function handleStudentMultiPdf(input) {
    const st = document.getElementById('student-multi-pdf-status');
    if (!input.files[0]) return;
    setStatus(st, '⏳ Extracting answers from PDF…', '');
    const fd = new FormData(); fd.append('file', input.files[0]);
    try {
        const res  = await fetch('/api/extract-pdf/multi-answer', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) { setStatus(st, '❌ ' + data.err, 'error'); return; }
        const answers = data.answers || [];
        if (answers.length === 0) { setStatus(st, '⚠️ Could not parse answers.', 'error'); return; }
        const qs = Object.values(window._sQuestions || {});
        let filled = 0;
        answers.forEach(a => {
            // Match by question number (1-indexed)
            const q = qs[a.num - 1];
            if (q) {
                const ta = document.getElementById(`batchslot-ans-${q.id}`);
                if (ta && a.answer) { ta.value = a.answer; filled++; }
            }
        });
        if (filled === 0) {
            // Fallback: paste all text into first empty slot
            const ta = document.getElementById(`batchslot-ans-${qs[0]?.id}`);
            if (ta) { ta.value = data.raw; filled = 1; }
        }
        setStatus(st, `✅ Filled ${filled} answer${filled>1?'s':''} from PDF. Review and submit!`, 'success');
    } catch(e) { setStatus(st, '❌ Server error.', 'error'); }
    input.value = '';
}

async function submitBatch() {
    if (batchRunning) return;
    const qs = Object.values(window._sQuestions || {});
    if (qs.length === 0) return;
    const submissions = [];
    let hasEmpty = false;
    qs.forEach(q => {
        const ans = (document.getElementById(`batchslot-ans-${q.id}`)?.value || '').trim();
        if (!ans) hasEmpty = true;
        else submissions.push({ question_id: q.id, answer: ans });
    });
    if (submissions.length === 0) {
        setStatus(document.getElementById('batch-status'), '⚠️ Please write at least one answer.', 'error'); return;
    }
    qs.forEach(q => {
        const ans  = (document.getElementById(`batchslot-ans-${q.id}`)?.value||'').trim();
        const slot = document.getElementById(`batchslot-${q.id}`);
        const st   = document.getElementById(`batchslot-status-${q.id}`);
        if (!ans) { slot?.classList.add('slot-error'); if(st){st.textContent='Skipped';st.className='batch-slot-status muted';} }
    });
    batchRunning = true;
    const btn = document.getElementById('batch-submit-btn');
    btn.disabled = true; btn.textContent = 'Grading…';
    clearStatus(document.getElementById('batch-status'));
    document.getElementById('batch-progress-wrap').classList.remove('hidden');
    document.getElementById('batch-progress-fill').style.width = '0%';
    document.getElementById('batch-progress-label').textContent = `0 / ${submissions.length} graded`;
    submissions.forEach(s => {
        const slot = document.getElementById(`batchslot-${s.question_id}`);
        const st   = document.getElementById(`batchslot-status-${s.question_id}`);
        slot?.classList.add('slot-grading');
        if(st){st.innerHTML='<span class="slot-spinner"></span>Grading…';st.className='batch-slot-status';}
        const ta = document.getElementById(`batchslot-ans-${s.question_id}`);
        if(ta) ta.disabled = true;
    });
    try {
        const res = await fetch('/api/evaluate/batch', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissions })
        });
        if (!res.ok) {
            const err = await res.json();
            setStatus(document.getElementById('batch-status'), '❌ ' + (err.err||'Server error'), 'error');
            return;
        }
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', graded = 0, total = submissions.length;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const evt = JSON.parse(line.slice(6));
                    if (evt.type === 'start') { total = evt.total; }
                    else if (evt.type === 'result') { graded++; applyBatchResult(evt, graded, total); }
                    else if (evt.type === 'done') {
                        document.getElementById('batch-progress-fill').style.width = '100%';
                        document.getElementById('batch-progress-label').textContent = `${graded} / ${total} graded`;
                        setStatus(document.getElementById('batch-status'), `✅ All ${graded} answers graded!`, 'success');
                        // Update submitted badges in one-at-a-time view
                        loadStudentQuestions();
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
        setStatus(document.getElementById('batch-status'), '❌ Connection error. Please try again.', 'error');
    } finally {
        batchRunning = false;
        btn.disabled = false; btn.textContent = 'Submit All for Grading';
        submissions.forEach(s => { const ta = document.getElementById(`batchslot-ans-${s.question_id}`); if(ta) ta.disabled=false; });
    }
}

function applyBatchResult(evt, graded, total) {
    const slot   = document.getElementById(`batchslot-${evt.question_id}`);
    const st     = document.getElementById(`batchslot-status-${evt.question_id}`);
    const result = document.getElementById(`batchslot-result-${evt.question_id}`);
    if (!slot) return;
    slot.classList.remove('slot-grading');
    slot.classList.add('slot-done');
    const pct    = evt.score / evt.max_marks;
    const stroke = pct >= 0.8 ? '#1a6b3a' : pct >= 0.5 ? '#8a5a00' : '#c0392b';
    const circ   = 2 * Math.PI * 18;
    const offset = circ * (1 - pct);
    if (st) { st.textContent = `${evt.score}/${evt.max_marks}`; st.className = 'batch-slot-status'; }
    if (result) {
        result.classList.remove('hidden');
        result.innerHTML = `
            <div class="batch-mini-result">
                <div class="mini-ring-wrap">
                    <svg class="mini-ring" viewBox="0 0 44 44">
                        <circle class="mini-ring-bg"   cx="22" cy="22" r="18"/>
                        <circle class="mini-ring-fill" cx="22" cy="22" r="18"
                            stroke-dasharray="${circ.toFixed(1)}"
                            stroke-dashoffset="${offset.toFixed(1)}"
                            style="stroke:${stroke};transform:rotate(-90deg);transform-origin:center"/>
                    </svg>
                    <div class="mini-ring-num">${evt.score}</div>
                </div>
                <div class="batch-mini-bar">
                    <div class="batch-mini-score">${evt.score} / ${evt.max_marks}</div>
                    <div class="batch-mini-feedback">${escapeHtml(evt.feedback)}</div>
                </div>
            </div>`;
    }
    const fillPct = Math.round((graded / total) * 100);
    document.getElementById('batch-progress-fill').style.width = fillPct + '%';
    document.getElementById('batch-progress-label').textContent = `${graded} / ${total} graded`;
}

// ── Loading overlay ────────────────────────────────────────────────────────────
function showLoading(msg) { document.getElementById('loading-msg').textContent=msg||'Please wait…'; document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading()    { document.getElementById('loading-overlay').classList.add('hidden'); }

// ── Helpers ────────────────────────────────────────────────────────────────────
function showError(el,msg)  { el.textContent=msg; el.classList.remove('hidden'); }
function clearError(el)     { el.textContent=''; el.classList.add('hidden'); }
function setStatus(el,msg,type) { if(!el)return; el.textContent=msg; el.className='status-msg '+type; }
function clearStatus(el)        { if(!el)return; el.textContent=''; el.className='status-msg'; }
function scoreClass(s,m) { const p=s/m; return p>=0.8?'high':p>=0.5?'mid':'low'; }
function escapeHtml(str) { const d=document.createElement('div'); d.textContent=String(str??''); return d.innerHTML; }
function formatDeadline(isoStr) {
    try {
        return new Date(isoStr).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    } catch { return isoStr; }
}
function formatDate(isoStr) {
    try { return new Date(isoStr).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }
    catch { return ''; }
}