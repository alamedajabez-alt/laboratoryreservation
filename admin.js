'use strict';
(function () {
  const { $, h, api, onChange, DEMO_USER, DEMO_PASS, addonLabel } = window.HM;
  const ROLE_KEY = 'hm_role_v1';
  const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
  const SHIFT_NAME = ['Morning', 'Afternoon', 'Evening'];
  const state = { role: 'student', status: 'pending', rows: [], rejectId: null, addonTarget: null };

  const msg = (el, text) => { el.textContent = text || ''; el.hidden = !text; };
  const toast = (t) => window.HM.toast && window.HM.toast(t);
  const isAdmin = () => state.role === 'admin';

  function timeAgo(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  /* ================= ROLE SWITCH ================= */
  async function setRole(role) {
    try {
      if (role === 'admin') await api('admin/login.php', { method: 'POST', body: { username: DEMO_USER, password: DEMO_PASS } });
      else await api('admin/logout.php', { method: 'POST', body: {} });
    } catch (err) { msg($('globalMsg'), err.message); return; }
    state.role = role;
    try { sessionStorage.setItem(ROLE_KEY, role); } catch { /* ignore */ }
    applyRole();
    toast(role === 'admin' ? 'Switched to Admin (Custodian) role.' : 'Switched to Student role.');
  }

  function applyRole() {
    const admin = isAdmin();
    $('studentView').hidden = admin;
    $('adminView').hidden = !admin;
    $('navStudent').hidden = admin;
    $('navAdmin').hidden = !admin;
    $('roleSwitch').setAttribute('aria-checked', String(admin));
    document.body.dataset.role = state.role;
    document.title = admin ? 'Custodian Dashboard | HM Lab Reserve' : 'HM Lab Reserve | Hospitality Management Laboratory';
    window.scrollTo(0, 0);
    if (admin) { $('adminWho').textContent = 'Signed in as Demo Custodian'; refreshAdmin(); }
  }

  $('roleSwitch').addEventListener('click', () => setRole(isAdmin() ? 'student' : 'admin'));

  /* ================= DASHBOARD ================= */
  function refreshAdmin() { loadDashboard(); loadList(); }

  async function loadDashboard() {
    try {
      const { data } = await api('admin/dashboard.php');
      msg($('globalMsg'), '');
      renderKpis(data); renderSchedule(data); renderActivity(data.events);
      renderBars($('chartLab'), data.by_lab, 'bar-red');
      renderBars($('chartShift'), data.by_shift, 'bar-blue');
      renderBars($('chartEquip'), data.equipment, 'bar-green');
      $('dashSub').textContent = `${data.total} total request${data.total === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    } catch (err) { handleErr(err); }
  }

  function handleErr(err) {
    if (err.status === 401) { state.role = 'student'; applyRole(); return; }
    msg($('globalMsg'), err.message);
  }

  function renderKpis(d) {
    const cards = [
      { label: 'Pending approvals', value: d.counts.pending, sub: d.counts.pending ? 'Waiting for your decision' : 'All caught up', tone: 'amber', go: 'pending' },
      { label: 'Approved', value: d.counts.approved, sub: 'Confirmed bookings', tone: 'green', go: 'approved' },
      { label: "Today's bookings", value: d.today, sub: 'Active reservations today', tone: 'blue' },
      { label: 'Rejected', value: d.counts.rejected, sub: 'Declined requests', tone: 'red', go: 'rejected' },
      { label: 'Cancelled', value: d.counts.cancelled, sub: 'Cancelled by students', tone: 'gray', go: 'cancelled' },
      { label: '7-day utilization', value: d.utilization + '%', sub: 'Of all station shifts', tone: 'purple', progress: d.utilization },
    ];
    $('kpiGrid').replaceChildren(...cards.map((c) => {
      const kids = [h('span', { class: 'kpi-label' }, c.label), h('span', { class: 'kpi-value' }, String(c.value)), h('span', { class: 'kpi-sub' }, c.sub)];
      if (c.progress !== undefined) kids.push(h('span', { class: 'kpi-progress' }, h('i', { style: `width:${Math.min(100, c.progress)}%` })));
      return c.go
        ? h('button', { class: `kpi kpi-${c.tone} clickable`, type: 'button', onclick: () => goTab(c.go) }, ...kids)
        : h('div', { class: `kpi kpi-${c.tone}` }, ...kids);
    }));
  }

  function renderSchedule(d) {
    const head = h('tr', {}, h('th', { class: 'lab-col' }, 'Station'),
      ...d.days.map((iso, i) => {
        const dt = new Date(iso + 'T00:00:00');
        return h('th', { class: i === 0 ? 'today' : '' }, dt.toLocaleDateString('en-US', { weekday: 'short' }), h('small', {}, dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })));
      }));
    const body = d.grid.map((lab) => h('tr', {},
      h('th', { class: 'lab-col' }, lab.lab_name, h('small', {}, lab.code)),
      ...lab.days.map((shifts, di) => h('td', { class: di === 0 ? 'today' : '' }, h('div', { class: 'slot-row' },
        ...shifts.map((s, si) => {
          const dayLabel = new Date(d.days[di] + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const title = `${lab.lab_name} · ${dayLabel} · ${SHIFT_NAME[si]}: ` + (s ? `${STATUS_LABEL[s.status]} (${s.by}, ${s.ref_code})` : 'Free');
          return s
            ? h('button', { class: `slot s-${s.status}`, type: 'button', title, 'aria-label': title, onclick: () => findRef(s.ref_code) })
            : h('span', { class: 'slot s-free', title });
        }))))));
    $('scheduleGrid').replaceChildren(h('thead', {}, head), h('tbody', {}, ...body));
  }

  function renderActivity(events) {
    if (!events.length) { $('activityList').replaceChildren(h('li', { class: 'activity-empty' }, 'No activity yet. New bookings and decisions will appear here.')); return; }
    $('activityList').replaceChildren(...events.map((e) =>
      h('li', {}, h('i', { class: `dot dot-${e.kind}` }), h('div', {}, h('span', {}, e.text), h('small', {}, timeAgo(e.at))))));
  }

  function renderBars(el, items, cls) {
    const max = Math.max(1, ...items.map((i) => i.value));
    el.replaceChildren(...items.map((i) =>
      h('div', { class: 'bar-row' },
        h('span', { class: 'bar-label' }, i.label),
        h('span', { class: 'bar-track' }, h('i', { class: cls, style: `width:${(i.value / max) * 100}%` })),
        h('span', { class: 'bar-value' }, String(i.value)))));
  }

  /* ================= REQUESTS TABLE ================= */
  const tbody = $('adminTableBody');
  const messageRow = (t) => h('tr', {}, h('td', { colspan: '6', class: 'empty-cell' }, t));

  function setTab(status) {
    state.status = status;
    document.querySelectorAll('#adminTabs .filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.status === status));
  }
  function goTab(status) { setTab(status); loadList(); $('dash-requests').scrollIntoView({ behavior: 'smooth' }); }
  function findRef(ref) { $('reqSearch').value = ref; setTab('all'); loadList(); $('dash-requests').scrollIntoView({ behavior: 'smooth' }); }

  document.querySelectorAll('#adminTabs .filter-btn').forEach((btn) => btn.addEventListener('click', () => { setTab(btn.dataset.status); loadList(); }));
  $('reqSearch').addEventListener('input', renderRows);

  async function loadList() {
    try {
      const res = await api('admin/reservations.php', { query: { status: state.status } });
      for (const [k, v] of Object.entries(res.counts)) { const el = $('cnt-' + k); if (el) el.textContent = v ? `(${v})` : ''; }
      state.rows = res.data;
      renderRows();
    } catch (err) { if (err.status === 401) handleErr(err); else tbody.replaceChildren(messageRow(err.message)); }
  }

  function renderRows() {
    const q = $('reqSearch').value.trim().toLowerCase();
    const rows = q ? state.rows.filter((r) => [r.ref_code, r.student_name, r.student_id, r.lab_name, r.course_code].join(' ').toLowerCase().includes(q)) : state.rows;
    if (!rows.length) { tbody.replaceChildren(messageRow(q ? 'No matches.' : 'Nothing here.')); return; }
    tbody.replaceChildren(...rows.map((r) => {
      const actions = [];
      if (r.status === 'pending') actions.push(h('button', { class: 'btn-action approve', type: 'button', onclick: () => review(r.id, 'approve') }, 'Approve'));
      if (r.status === 'pending' || r.status === 'approved') actions.push(h('button', { class: 'btn-action cancel', type: 'button', onclick: () => openReject(r) }, r.status === 'approved' ? 'Revoke' : 'Reject'));
      return h('tr', {},
        h('td', {}, h('strong', {}, r.ref_code), h('small', { class: 'row-sub' }, `Requested ${r.created_at}`)),
        h('td', {}, r.student_name, h('small', { class: 'row-sub' }, `ID: ${r.student_id}`), h('small', { class: 'row-sub' }, r.course_code)),
        h('td', {}, `${r.lab_name} (${r.lab_code})`, addonChips(r)),
        h('td', {}, r.reservation_date, h('small', { class: 'row-sub' }, r.time_shift)),
        h('td', {}, h('span', { class: `status-badge status-${r.status}` }, STATUS_LABEL[r.status]),
          r.reviewed_by ? h('small', { class: 'row-sub' }, `by ${r.reviewed_by}`) : '',
          r.admin_note ? h('small', { class: 'row-sub' }, `Note: ${r.admin_note}`) : ''),
        h('td', {}, ...actions));
    }));
  }

  /* ---------- add-ons: decline an individual item that is not available ---------- */
  function addonChips(r) {
    if (!r.addons || !r.addons.length) return '';
    const canEdit = r.status === 'pending' || r.status === 'approved';
    return h('ul', { class: 'chip-list admin-addons' }, ...r.addons.map((a) => {
      const kids = [a.declined ? h('s', {}, addonLabel(a)) : addonLabel(a)];
      if (a.declined) {
        kids.push(h('small', { class: 'chip-note' }, a.note));
        if (canEdit) kids.push(h('button', { class: 'chip-act', type: 'button', title: 'Restore this add-on', 'aria-label': `Restore ${a.name}`, onclick: () => restoreAddon(r, a) }, 'Undo'));
      } else if (canEdit) {
        kids.push(h('button', { class: 'chip-act chip-decline', type: 'button', title: 'Decline: not available', 'aria-label': `Decline ${a.name}`, onclick: () => openAddon(r, a) }, 'Decline'));
      }
      return h('li', { class: 'chip' + (a.custom ? ' chip-custom' : '') + (a.declined ? ' chip-declined' : '') }, ...kids);
    }));
  }
  async function restoreAddon(r, a) {
    try { const res = await api('admin/addon.php', { method: 'POST', body: { id: r.id, key: a.key, action: 'restore' } }); msg($('globalMsg'), ''); toast(res.message); }
    catch (err) { if (err.status === 401) handleErr(err); else { msg($('globalMsg'), err.message); refreshAdmin(); } }
  }
  function openAddon(r, a) {
    state.addonTarget = { id: r.id, key: a.key };
    $('addonTitle').textContent = `Decline "${a.name}"`;
    $('addonSub').textContent = `${r.ref_code} · ${r.student_name}. The rest of the booking stays as it is.`;
    $('addonNote').value = ''; msg($('addonMsg'), '');
    $('addonModal').classList.add('open'); $('addonNote').focus();
  }
  const closeAddon = () => $('addonModal').classList.remove('open');
  $('closeAddon').addEventListener('click', closeAddon);
  $('addonModal').addEventListener('click', (e) => { if (e.target === $('addonModal')) closeAddon(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAddon(); });
  $('addonNote').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('confirmAddon').click(); } });
  $('confirmAddon').addEventListener('click', async () => {
    const note = $('addonNote').value.trim();
    if (note.length < 3) { msg($('addonMsg'), 'Please give a short reason, e.g. "Out of stock".'); return; }
    try {
      const res = await api('admin/addon.php', { method: 'POST', body: { ...state.addonTarget, action: 'decline', note } });
      msg($('globalMsg'), ''); toast(res.message); closeAddon();
    } catch (err) {
      if (err.status === 401) { closeAddon(); handleErr(err); return; }
      msg($('addonMsg'), err.message);
    }
  });

  async function review(id, action, note = '') {
    try {
      const res = await api('admin/review.php', { method: 'POST', body: { id, action, note } });
      msg($('globalMsg'), ''); toast(res.message); return true;
    } catch (err) {
      if (err.status === 401) { handleErr(err); return false; }
      msg($('globalMsg'), err.message); refreshAdmin(); return false;
    }
  }

  /* ---------- reject modal ---------- */
  function openReject(r) {
    state.rejectId = r.id;
    $('rejectTitle').textContent = `${r.status === 'approved' ? 'Revoke' : 'Reject'} ${r.ref_code}`;
    $('rejectNote').value = ''; msg($('rejectMsg'), '');
    $('rejectModal').classList.add('open'); $('rejectNote').focus();
  }
  const closeReject = () => $('rejectModal').classList.remove('open');
  $('closeReject').addEventListener('click', closeReject);
  $('rejectModal').addEventListener('click', (e) => { if (e.target === $('rejectModal')) closeReject(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReject(); });
  $('confirmReject').addEventListener('click', async () => {
    const note = $('rejectNote').value.trim();
    if (note.length < 3) { msg($('rejectMsg'), 'Please give a short reason.'); return; }
    if (await review(state.rejectId, 'reject', note)) closeReject();
  });

  /* ================= live updates & init ================= */
  onChange(() => { if (isAdmin()) refreshAdmin(); });          // student books -> dashboard updates instantly
  setInterval(() => { if (isAdmin()) loadDashboard(); }, 30000); // keeps "x min ago" fresh

  document.addEventListener('DOMContentLoaded', async () => {
    let saved = 'student';
    try { saved = sessionStorage.getItem(ROLE_KEY) || 'student'; } catch { /* ignore */ }
    state.role = 'student';
    if (saved === 'admin') {
      try { await api('admin/login.php', { method: 'POST', body: { username: DEMO_USER, password: DEMO_PASS } }); state.role = 'admin'; } catch { /* stay student */ }
    }
    applyRole();
    window.scrollTo(0, 0);
  });
})();
