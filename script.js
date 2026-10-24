'use strict';
(function () {
  const { $, h, api, toISODate, pad, onChange, demo } = window.HM;
  const MAX_DAYS_AHEAD = 60;
  const EMPTY_AVAIL = { booked_shifts: [], equipment_busy: {} };
  const STATUS_LABEL = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

  const state = { labs: [], equipment: [], filter: 'all', currentLab: null, availability: EMPTY_AVAIL,
                  availToken: 0, studentId: '', lastRef: '', scrollToBoard: false, customAddons: [] };

  const labGrid = $('labGrid'), bookingModal = $('bookingModal'), passModal = $('passModal');
  const bookingForm = $('bookingForm'), shiftSelect = $('resTime'), dateInput = $('resDate');
  const formError = $('formError'), slotHint = $('slotHint'), submitBtn = $('submitBtn');
  const tbody = $('reservationsTableBody'), boardBody = $('boardBody');
  const msgRow = (text, cols) => h('tr', {}, h('td', { colspan: String(cols), class: 'empty-cell' }, text));

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  window.HM.toast = toast;

  /* ---------- laboratories ---------- */
  async function loadLabs() {
    try { state.labs = (await api('get_labs.php')).data; renderLabs(); }
    catch (err) { labGrid.replaceChildren(h('p', { class: 'empty-state' }, err.message)); }
  }
  function renderLabs() {
    const list = state.filter === 'all' ? state.labs : state.labs.filter((l) => l.category === state.filter);
    if (!list.length) { labGrid.replaceChildren(h('p', { class: 'empty-state' }, 'No workstations available in this category.')); return; }
    labGrid.replaceChildren(...list.map((lab) =>
      h('div', { class: 'card' },
        h('div', {},
          h('div', { class: 'card-header' }, h('span', { class: 'badge' }, 'Available'), h('span', { class: 'row-sub' }, `Capacity: ${lab.capacity}`)),
          h('h3', {}, lab.name), h('p', {}, lab.description)),
        h('button', { class: 'btn-book', type: 'button', onclick: () => openBookingModal(lab) }, 'Book Station'))));
  }
  document.querySelectorAll('.filter-btn[data-filter]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active'); state.filter = btn.dataset.filter; renderLabs();
  }));

  async function loadEquipment() {
    state.equipment = (await api('get_equipment.php')).data;
    $('equipmentChecklist').replaceChildren(...state.equipment.map((eq) =>
      h('label', { class: 'checkbox-label' }, h('input', { type: 'checkbox', name: 'equipment', value: eq.id }), h('span', {}, eq.name))));
  }

  /* ---------- booking modal + live availability ---------- */
  function openBookingModal(lab) {
    state.currentLab = lab; state.availability = EMPTY_AVAIL;
    $('selectedLabId').value = lab.id; $('selectedLabTitle').textContent = lab.name; formError.hidden = true;
    state.customAddons = []; $('customName').value = ''; $('customQty').value = '1'; renderCustomAddons();
    const max = new Date(); max.setDate(max.getDate() + MAX_DAYS_AHEAD);
    dateInput.min = toISODate(new Date()); dateInput.max = toISODate(max);
    if (state.studentId) $('studentId').value = state.studentId;
    refreshSlotOptions();
    bookingModal.classList.add('open');
    $('studentName').focus();
  }

  async function loadAvailability() {
    const date = dateInput.value;
    if (!state.currentLab || !date) { state.availability = EMPTY_AVAIL; refreshSlotOptions(); return; }
    const token = ++state.availToken;
    try {
      const res = await api('get_availability.php', { query: { lab_id: state.currentLab.id, date } });
      if (token !== state.availToken) return;
      state.availability = res.data;
    } catch { if (token !== state.availToken) return; state.availability = EMPTY_AVAIL; }
    refreshSlotOptions();
  }

  function refreshSlotOptions() {
    const date = dateInput.value, now = new Date();
    const isToday = date === toISODate(now), hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    let selectedBlocked = false, open = 0, total = 0;
    [...shiftSelect.options].forEach((opt) => {
      if (!opt.value) return;
      if (!opt.dataset.label) opt.dataset.label = opt.textContent;
      const booked = state.availability.booked_shifts.includes(opt.value);
      const started = isToday && hhmm >= opt.dataset.start;
      opt.disabled = booked || started;
      opt.textContent = opt.dataset.label + (booked ? ' — Already booked' : started ? ' — Already started' : '');
      total++; if (!opt.disabled) open++;
      if (opt.disabled && opt.selected) selectedBlocked = true;
    });
    if (selectedBlocked) shiftSelect.value = '';
    slotHint.classList.remove('warn'); slotHint.textContent = '';
    if (date && total && open === 0) { slotHint.textContent = 'This station has no open shifts on this date. Please pick another date or station.'; slotHint.classList.add('warn'); }
    else if (date) slotHint.textContent = 'Shifts marked "Already booked" are taken (pending or approved) and cannot be selected.';
    refreshEquipmentOptions();
  }

  function refreshEquipmentOptions() {
    const busy = (state.availability.equipment_busy[shiftSelect.value] || []).map(Number);
    document.querySelectorAll('#equipmentChecklist .checkbox-label').forEach((label) => {
      const cb = label.querySelector('input'), inUse = busy.includes(Number(cb.value));
      cb.disabled = inUse; if (inUse) cb.checked = false;
      label.classList.toggle('disabled', inUse); label.title = inUse ? 'Already reserved for this shift' : '';
    });
  }
  dateInput.addEventListener('change', loadAvailability);
  shiftSelect.addEventListener('change', refreshEquipmentOptions);

  const closeBooking = () => bookingModal.classList.remove('open');
  function closePass() {
    passModal.classList.remove('open');
    if (state.scrollToBoard) { state.scrollToBoard = false; $('live-board').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  $('closeModal').addEventListener('click', closeBooking);
  $('closePassModal').addEventListener('click', closePass);
  $('closePassBtn').addEventListener('click', closePass);
  $('printPassBtn').addEventListener('click', () => window.print());
  bookingModal.addEventListener('click', (e) => { if (e.target === bookingModal) closeBooking(); });
  passModal.addEventListener('click', (e) => { if (e.target === passModal) closePass(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeBooking(); closePass(); } });

  /* ---------- personalized (custom) add-ons ---------- */
  function renderCustomAddons() {
    $('customList').replaceChildren(...state.customAddons.map((a, i) =>
      h('li', { class: 'chip chip-custom chip-draft' }, window.HM.addonLabel(a),
        h('button', { type: 'button', 'aria-label': `Remove ${a.name}`, onclick: () => { state.customAddons.splice(i, 1); renderCustomAddons(); } }, '×'))));
    const left = window.HM.MAX_CUSTOM - state.customAddons.length;
    $('customHint').textContent = state.customAddons.length ? `${left} more custom request${left === 1 ? '' : 's'} allowed. Each one is reviewed separately.` : '';
    $('addCustomBtn').disabled = left <= 0;
  }
  function addCustomAddon() {
    const name = $('customName').value.trim().replace(/\s+/g, ' '), qty = Number($('customQty').value);
    if (!name) { $('customName').focus(); return; }
    if (!/^[\p{L}\p{N} .,'&()\/\-+]{2,60}$/u.test(name)) { showFormError('Add-on names may use letters, numbers and basic punctuation (2-60 characters).'); return; }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) { showFormError('Quantity must be between 1 and 99.'); return; }
    if (state.customAddons.some((a) => a.name.toLowerCase() === name.toLowerCase())) { showFormError('You already added that item.'); return; }
    formError.hidden = true;
    state.customAddons.push({ name, qty });
    $('customName').value = ''; $('customQty').value = '1';
    renderCustomAddons(); $('customName').focus();
  }
  function showFormError(text) { formError.textContent = text; formError.hidden = false; }
  $('addCustomBtn').addEventListener('click', addCustomAddon);
  $('customName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomAddon(); } });

  /* ---------- submit ---------- */
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    formError.hidden = true;
    const payload = {
      lab_id: Number($('selectedLabId').value), student_name: $('studentName').value.trim(),
      student_id: $('studentId').value.trim().toUpperCase(), course_code: $('courseCode').value.trim(),
      reservation_date: dateInput.value, time_shift: shiftSelect.value,
      equipment_ids: [...document.querySelectorAll('input[name="equipment"]:checked')].map((cb) => Number(cb.value)),
      custom_addons: state.customAddons,
    };
    submitBtn.disabled = true; submitBtn.textContent = 'Checking availability…';
    try {
      const result = await api('create_reservation.php', { method: 'POST', body: payload });
      state.lastRef = result.data.ref_code;
      closeBooking(); bookingForm.reset(); state.customAddons = []; renderCustomAddons();
      setStudentId(payload.student_id);
      showPass({ lab: state.currentLab.name, ref: result.data.ref_code, name: payload.student_name, sid: payload.student_id,
                 course: payload.course_code, when: `${payload.reservation_date} | ${payload.time_shift}`, status: 'pending', addons: result.data.addons });
      state.scrollToBoard = true;
      toast(`Request ${result.data.ref_code} submitted — now on the Live Booking Board.`);
      refreshAll();
    } catch (err) {
      formError.textContent = err.message; formError.hidden = false;
      loadAvailability();
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Submit Reservation Request';
    }
  });

  /* ---------- pass ---------- */
  function showPass(p) {
    const approved = p.status === 'approved';
    $('passBadgeHeader').textContent = approved ? 'OFFICIAL LABORATORY ENTRY PASS' : 'REQUEST RECEIVED — AWAITING CUSTODIAN APPROVAL';
    $('passStatus').textContent = approved ? 'Approved' : 'Pending approval';
    $('passQr').hidden = !approved; $('printPassBtn').hidden = !approved;
    $('passLabName').textContent = p.lab; $('passRefCode').textContent = p.ref;
    $('passStudentName').textContent = p.name; $('passStudentId').textContent = p.sid;
    $('passCourseCode').textContent = p.course; $('passDateTime').textContent = p.when;
    $('passAddons').textContent = window.HM.addonSummary(p.addons);
    passModal.classList.add('open');
  }

  /* ---------- live booking board ---------- */
  async function loadBoard() {
    try {
      const rows = (await api('get_board.php')).data;
      $('boardCount').textContent = rows.length ? `${rows.length} active` : '';
      if (!rows.length) { boardBody.replaceChildren(msgRow('No bookings yet — book a station above and it will appear here instantly.', 5)); return; }
      boardBody.replaceChildren(...rows.map((r) =>
        h('tr', { class: r.ref_code === state.lastRef ? 'row-new' : '' },
          h('td', {}, h('strong', {}, r.lab_name), h('small', { class: 'row-sub' }, r.ref_code)),
          h('td', {}, r.reservation_date, h('small', { class: 'row-sub' }, r.time_shift)),
          h('td', {}, r.booked_by),
          h('td', {}, r.course_code),
          h('td', {}, h('span', { class: `status-badge status-${r.status}` }, STATUS_LABEL[r.status])))));
    } catch (err) { boardBody.replaceChildren(msgRow(err.message, 5)); }
  }

  /* ---------- my reservations ---------- */
  function setStudentId(id) {
    state.studentId = id; $('lookupStudentId').value = id;
    try { sessionStorage.setItem('hm_student_id', id); } catch { /* ignore */ }
  }
  $('lookupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    setStudentId($('lookupStudentId').value.trim().toUpperCase());
    loadMine();
  });

  async function loadMine() {
    if (!state.studentId) { tbody.replaceChildren(msgRow('Enter your ID above to see your bookings.', 6)); return; }
    try { renderMine((await api('get_reservations.php', { method: 'POST', body: { student_id: state.studentId } })).data); }
    catch (err) { tbody.replaceChildren(msgRow(err.message, 6)); }
  }
  function renderMine(rows) {
    if (!rows.length) { tbody.replaceChildren(msgRow('No upcoming reservations found for this ID.', 6)); return; }
    tbody.replaceChildren(...rows.map((r) => {
      const actions = [];
      if (r.status === 'approved') actions.push(h('button', { class: 'btn-action', type: 'button',
        onclick: () => showPass({ lab: r.lab_name, ref: r.ref_code, name: r.student_name, sid: r.student_id, course: r.course_code,
                                  when: `${r.reservation_date} | ${r.time_shift}`, status: r.status, addons: r.addons }) }, 'View Pass'));
      if (r.status === 'pending' || r.status === 'approved') actions.push(h('button', { class: 'btn-action cancel', type: 'button', onclick: () => cancelReservation(r.id) }, 'Cancel'));
      return h('tr', {},
        h('td', {}, h('strong', {}, r.ref_code)), h('td', {}, r.student_name),
        h('td', {}, r.lab_name, window.HM.addonList(r.addons)),
        h('td', {}, r.reservation_date, h('small', { class: 'row-sub' }, r.time_shift)),
        h('td', {}, h('span', { class: `status-badge status-${r.status}` }, STATUS_LABEL[r.status]),
          r.status === 'rejected' && r.admin_note ? h('small', { class: 'row-sub' }, `Reason: ${r.admin_note}`) : ''),
        h('td', {}, ...actions));
    }));
  }
  async function cancelReservation(id) {
    if (!confirm('Are you sure you want to cancel this reservation?')) return;
    try { await api('cancel_reservation.php', { method: 'POST', body: { id, student_id: state.studentId } }); toast('Reservation cancelled.'); refreshAll(); }
    catch (err) { alert(err.message); }
  }

  /* ---------- demo tools ---------- */
  $('seedBtn').addEventListener('click', () => { demo.seed(); state.lastRef = ''; toast('Sample bookings loaded. Try ID 2024-00123 under My Reservations.'); });
  $('resetBtn').addEventListener('click', () => { if (confirm('Clear all demo bookings?')) { demo.reset(); state.lastRef = ''; toast('Demo reset.'); } });

  function refreshAll() { loadBoard(); loadMine(); }
  onChange(refreshAll);                                  // any change (even from another tab / the custodian) updates the page

  document.addEventListener('DOMContentLoaded', async () => {
    try { state.studentId = sessionStorage.getItem('hm_student_id') || ''; } catch { /* ignore */ }
    $('lookupStudentId').value = state.studentId;
    await Promise.all([loadLabs(), loadEquipment()]);
    refreshAll();
  });
})();
