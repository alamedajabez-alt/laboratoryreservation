'use strict';
/* Demo "backend": same rules as the PHP API, but everything lives in this browser (localStorage).
   Exposes window.HM = { $, h, api, toISODate, pad, onChange, demo, addon helpers } */
(function () {
  const KEY = 'hm_demo_reservations_v2';
  const SESSION_KEY = 'hm_demo_admin_v1';
  const DEMO_USER = 'custodian', DEMO_PASS = 'custodian123', DEMO_NAME = 'Demo Custodian';
  const MAX_DAYS_AHEAD = 60, MAX_ACTIVE = 5;
  const SHIFTS = { '08:00 AM - 11:00 AM': '08:00', '01:00 PM - 04:00 PM': '13:00', '05:00 PM - 08:00 PM': '17:00' };
  const SHIFT_ORDER = Object.keys(SHIFTS);
  const MAX_CUSTOM = 3;                          // personalized add-on requests per booking
  const CUSTOM_RE = /^[\p{L}\p{N} .,'&()\/\-+]{2,60}$/u;
  const HOLD = ['pending', 'approved'];           // these statuses hold a slot; rejected/cancelled free it

  const LABS = [
    { id: 1, code: 'HK-01', name: 'Upper Hot Kitchen', category: 'hot', description: 'Hot-line kitchen with cooking ranges, ovens and prep counters for practical cooking sessions.', capacity: 10 },
    { id: 2, code: 'HK-02', name: 'Lower Hot Kitchen', category: 'hot', description: 'Second hot-line kitchen for group cooking practicals and food production.', capacity: 10 },
    { id: 3, code: 'CK-01', name: 'Cold Kitchen', category: 'cold', description: 'Cold-preparation kitchen for salads, appetizers, garde manger and dessert plating.', capacity: 8 },
    { id: 4, code: 'MH-01', name: 'Mini Hotel', category: 'hotel', description: 'Training hotel setup with a front desk and guest room for check-in and housekeeping practice.', capacity: 4 },
  ];
  const EQUIPMENT = [
    { id: 1, name: 'Sous Vide Precision Cooker' }, { id: 2, name: 'Commercial Sous Chef Mixer' },
    { id: 3, name: 'Food Processor & Slicer' }, { id: 4, name: 'Plating & Garnish Kit' }, { id: 5, name: 'Housekeeping Linens Set' },
  ];

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => toISODate(new Date());
  const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const stamp = () => { const d = new Date(); return `${toISODate(d)} ${nowHHMM()}`; };
  const shiftIdx = (s) => SHIFT_ORDER.indexOf(s);

  function h(tag, props = {}, ...children) {            // safe DOM builder (text only, no innerHTML)
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  let mem = null;
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return mem || { next: 1, rows: [], events: [] };
  }
  function save(db) {
    mem = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable: memory only */ }
    document.dispatchEvent(new Event('hm:changed'));
  }
  const onChange = (cb) => {
    document.addEventListener('hm:changed', cb);
    window.addEventListener('storage', (e) => { if (e.key === KEY) cb(); });   // other tab/window
  };

  const ok = (extra) => ({ success: true, ...extra });
  const err = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && toISODate(new Date(s + 'T00:00:00')) === s;
  const labOf = (id) => LABS.find((l) => l.id === id);
  const eqNames = (ids) => ids.map((i) => (EQUIPMENT.find((e) => e.id === i) || {}).name).filter(Boolean).sort().join(', ');
  const refCode = () => 'HM-RES-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const maskName = (n) => { const p = n.split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };
  /* add-ons = ticked equipment (qty 1) + personalized requests; shown on the pass, student list and custodian table */
  const addonLabel = (a) => (a.qty > 1 ? `${a.name} × ${a.qty}` : a.name);
  /* A custodian can decline any single add-on (e.g. out of stock). Declined items are kept with their reason: r.declined_addons = { key: reason }.
     key = 'e<equipmentId>' for ticked equipment, 'c<index>' for personalized requests. */
  const declinedOf = (r) => r.declined_addons || {};
  const activeEq = (r) => r.equipment_ids.filter((id) => !(('e' + id) in declinedOf(r)));   // equipment that is really reserved
  const addonsOf = (r) => {
    const dec = declinedOf(r);
    const item = (key, name, qty, custom) => ({ key, name, qty, custom, declined: key in dec, note: dec[key] || null });
    return [
      ...r.equipment_ids.map((id) => ({ id, name: (EQUIPMENT.find((e) => e.id === id) || {}).name })).filter((e) => e.name)
        .sort((a, b) => a.name.localeCompare(b.name)).map((e) => item('e' + e.id, e.name, 1, false)),
      ...(r.custom_addons || []).map((a, i) => item('c' + i, a.name, a.qty, true)),
    ];
  };
  const addonSummary = (list) => (list && list.length
    ? list.map((a) => addonLabel(a) + (a.declined ? ` (declined: ${a.note})` : '')).join(', ') : 'None');
  const addonList = (list) => (list && list.length
    ? h('ul', { class: 'chip-list' }, ...list.map((a) => h('li', { class: 'chip' + (a.custom ? ' chip-custom' : '') + (a.declined ? ' chip-declined' : '') },
        addonLabel(a), a.declined ? h('small', { class: 'chip-note' }, `Declined: ${a.note}`) : '')))
    : '');
  const view = (r) => ({ ...r, lab_name: labOf(r.lab_id).name, lab_code: labOf(r.lab_id).code, addons: addonsOf(r),
    equipment: addonsOf(r).filter((a) => !a.declined).map((a) => addonLabel(a) + (a.custom ? ' (custom)' : '')).join(', ') || null });
  const bySlot = (a, b) => a.reservation_date.localeCompare(b.reservation_date) || shiftIdx(a.time_shift) - shiftIdx(b.time_shift);

  function log(db, kind, text) {                       // activity feed for the dashboard
    db.events = db.events || [];
    db.events.push({ at: Date.now(), kind, text });
    if (db.events.length > 60) db.events.splice(0, db.events.length - 60);
  }

  function requireAdmin() {
    let on = false;
    try { on = sessionStorage.getItem(SESSION_KEY) === '1'; } catch { /* ignore */ }
    if (!on && !window.__hmAdminMem) throw err('Please log in as a custodian.', 401);
  }

  /* ---------- "endpoints" ---------- */
  const routes = {
    'get_labs.php': () => ok({ data: LABS }),
    'get_equipment.php': () => ok({ data: EQUIPMENT }),

    'get_availability.php': ({ query }) => {
      const lab = Number(query.lab_id), date = String(query.date || '');
      if (!lab || !isDate(date)) throw err('Invalid laboratory or date.');
      const rows = load().rows.filter((r) => HOLD.includes(r.status) && r.reservation_date === date);
      const busy = {};
      rows.forEach((r) => activeEq(r).forEach((id) => { (busy[r.time_shift] = busy[r.time_shift] || []).push(id); }));
      return ok({ data: { booked_shifts: rows.filter((r) => r.lab_id === lab).map((r) => r.time_shift), equipment_busy: busy } });
    },

    // Public board: every active booking, names shortened ("Maria S.")
    'get_board.php': () => ok({
      data: load().rows.filter((r) => HOLD.includes(r.status) && r.reservation_date >= today()).sort(bySlot)
        .map((r) => ({ ref_code: r.ref_code, lab_name: labOf(r.lab_id).name, reservation_date: r.reservation_date,
                       time_shift: r.time_shift, booked_by: maskName(r.student_name), course_code: r.course_code, status: r.status })),
    }),

    'create_reservation.php': ({ body: b }) => {
      const labId = Number(b.lab_id);
      const name = String(b.student_name || '').trim();
      const sid = String(b.student_id || '').trim().toUpperCase();
      const course = String(b.course_code || '').trim();
      const date = String(b.reservation_date || '');
      const shift = String(b.time_shift || '');
      const eq = [...new Set((b.equipment_ids || []).map(Number).filter((n) => n > 0))];

      if (!labOf(labId)) throw err('That workstation does not exist or is unavailable.', 404);
      if (!name || !sid || !course) throw err('All required fields must be filled out.');
      if (!/^[\p{L}\p{M} .,'\-]{2,100}$/u.test(name)) throw err('Please enter a valid full name.');
      if (!/^[A-Z0-9\-]{3,30}$/.test(sid)) throw err('Student ID may only contain letters, numbers and dashes (3-30 characters).');
      if (!/^[\p{L}\p{N} .,'&()\/\-]{2,100}$/u.test(course)) throw err('Please enter a valid course / subject code.');
      if (!(shift in SHIFTS)) throw err('Invalid time shift.');
      if (!isDate(date)) throw err('Invalid date.');
      const t = today(), max = new Date(); max.setDate(max.getDate() + MAX_DAYS_AHEAD);
      if (date < t) throw err('Reservation date cannot be in the past.');
      if (date > toISODate(max)) throw err(`Reservations can only be made up to ${MAX_DAYS_AHEAD} days ahead.`);
      if (date === t && nowHHMM() >= SHIFTS[shift]) throw err('That shift has already started. Please choose a later shift or date.');
      if (eq.some((id) => !EQUIPMENT.find((e) => e.id === id))) throw err('One or more selected equipment items do not exist.');
      const rawCustom = Array.isArray(b.custom_addons) ? b.custom_addons : [];
      if (rawCustom.length > MAX_CUSTOM) throw err(`You can add up to ${MAX_CUSTOM} custom requests.`);
      const custom = rawCustom.map((a) => ({ name: String((a && a.name) || '').trim().replace(/\s+/g, ' '), qty: Number(a && a.qty) }));
      if (custom.some((a) => !CUSTOM_RE.test(a.name))) throw err('Add-on names may use letters, numbers and basic punctuation (2-60 characters).');
      if (custom.some((a) => !Number.isInteger(a.qty) || a.qty < 1 || a.qty > 99)) throw err('Add-on quantity must be between 1 and 99.');
      if (new Set(custom.map((a) => a.name.toLowerCase())).size !== custom.length) throw err('Duplicate custom add-ons.');

      const db = load();
      const held = db.rows.filter((r) => HOLD.includes(r.status));
      if (held.filter((r) => r.student_id === sid && r.reservation_date >= t).length >= MAX_ACTIVE)
        throw err(`You already have ${MAX_ACTIVE} upcoming reservations. Cancel one before booking another.`, 429);

      const taken = new Set();
      held.filter((r) => r.reservation_date === date && r.time_shift === shift)
          .forEach((r) => activeEq(r).forEach((id) => { if (eq.includes(id)) taken.add(id); }));
      if (taken.size) throw err('Already reserved for that shift: ' + eqNames([...taken]) + '. Please untick it or choose another shift.', 409);

      if (held.some((r) => r.lab_id === labId && r.reservation_date === date && r.time_shift === shift))
        throw err('This workstation is already reserved for that date and shift. Please pick another shift or station.', 409);
      if (held.some((r) => r.student_id === sid && r.reservation_date === date && r.time_shift === shift))
        throw err('You already have a reservation on that date and shift (in another station). One booking per shift only.', 409);

      const row = { id: db.next++, ref_code: refCode(), lab_id: labId, student_name: name, student_id: sid, course_code: course,
                    reservation_date: date, time_shift: shift, equipment_ids: eq, custom_addons: custom, status: 'pending',
                    admin_note: null, reviewed_by: null, reviewed_at: null, created_at: stamp() };
      db.rows.push(row);
      log(db, 'new', `New request ${row.ref_code}: ${maskName(name)} · ${labOf(labId).name} · ${date}, ${shift.split(' - ')[0]}`);
      save(db);
      return ok({ message: 'Request submitted. It is now awaiting custodian approval.', data: { id: row.id, ref_code: row.ref_code, student_id: sid, status: 'pending', addons: addonsOf(row) } });
    },

    'get_reservations.php': ({ body }) => {
      const sid = String(body.student_id || '').trim().toUpperCase();
      if (!/^[A-Z0-9\-]{3,30}$/.test(sid)) throw err('Please enter a valid Student / Instructor ID.');
      return ok({ data: load().rows.filter((r) => r.student_id === sid && ['pending', 'approved', 'rejected'].includes(r.status) && r.reservation_date >= today())
                                 .sort(bySlot).map(view) });
    },

    'cancel_reservation.php': ({ body }) => {
      const db = load();
      const r = db.rows.find((x) => x.id === Number(body.id) && x.student_id === String(body.student_id || '').toUpperCase()
                                    && HOLD.includes(x.status) && x.reservation_date >= today());
      if (!r) throw err('Reservation not found, already closed, or can no longer be cancelled.', 404);
      r.status = 'cancelled';
      log(db, 'cancelled', `${maskName(r.student_name)} cancelled ${r.ref_code} (${labOf(r.lab_id).name})`);
      save(db);
      return ok({ message: 'Reservation cancelled. The slot is open again.' });
    },

    /* ----- custodian ----- */
    'admin/me.php': () => {
      let on = false;
      try { on = sessionStorage.getItem(SESSION_KEY) === '1'; } catch { /* ignore */ }
      on = on || !!window.__hmAdminMem;
      return ok({ data: { logged_in: on, needs_setup: false, admin: on ? { full_name: DEMO_NAME, username: DEMO_USER } : null } });
    },
    'admin/login.php': ({ body }) => {
      if (String(body.username || '').trim().toLowerCase() !== DEMO_USER || body.password !== DEMO_PASS) throw err('Invalid username or password.', 401);
      window.__hmAdminMem = true;
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
      return ok({ data: { full_name: DEMO_NAME, username: DEMO_USER } });
    },
    'admin/logout.php': () => {
      window.__hmAdminMem = false;
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      return ok({});
    },
    'admin/reservations.php': ({ query }) => {
      requireAdmin();
      const status = query.status || 'pending';
      const rows = load().rows;
      const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
      rows.forEach((r) => { counts[r.status]++; });
      const list = rows.filter((r) => status === 'all' || r.status === status).sort(bySlot);
      if (status !== 'pending') list.reverse();
      return ok({ data: list.map(view), counts });
    },
    'admin/dashboard.php': () => {
      requireAdmin();
      const db = load(), t = today(), rows = db.rows;
      const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
      rows.forEach((r) => { counts[r.status]++; });
      const held = rows.filter((r) => HOLD.includes(r.status));
      const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return toISODate(d); });
      let used = 0;
      const grid = LABS.map((l) => ({
        lab_id: l.id, lab_name: l.name, code: l.code,
        days: days.map((d) => SHIFT_ORDER.map((s) => {
          const r = held.find((x) => x.lab_id === l.id && x.reservation_date === d && x.time_shift === s);
          if (!r) return null;
          used++;
          return { status: r.status, ref_code: r.ref_code, by: maskName(r.student_name) };
        })),
      }));
      const desc = (a, b) => b.value - a.value;
      return ok({ data: {
        counts, total: rows.length, today: held.filter((r) => r.reservation_date === t).length,
        utilization: Math.round((used * 100) / (LABS.length * SHIFT_ORDER.length * 7)),
        shifts: SHIFT_ORDER, days, grid,
        by_lab: LABS.map((l) => ({ label: l.name, value: held.filter((r) => r.lab_id === l.id).length })).sort(desc),
        by_shift: SHIFT_ORDER.map((s) => ({ label: s, value: held.filter((r) => r.time_shift === s).length })),
        equipment: EQUIPMENT.map((e) => ({ label: e.name, value: held.filter((r) => activeEq(r).includes(e.id)).length })).sort(desc),
        events: (db.events || []).slice(-8).reverse(),
      } });
    },
    'admin/addon.php': ({ body }) => {                      // decline / restore ONE add-on of a booking
      requireAdmin();
      const action = body.action, key = String(body.key || ''), note = String(body.note || '').trim();
      if (!['decline', 'restore'].includes(action)) throw err('Invalid request.');
      const db = load();
      const r = db.rows.find((x) => x.id === Number(body.id));
      if (!r || !HOLD.includes(r.status) || r.reservation_date < today())
        throw err('This request is closed, cancelled, or the date has passed. Refresh the list.', 409);
      const a = addonsOf(r).find((x) => x.key === key);
      if (!a) throw err('Add-on not found on this booking.', 404);
      r.declined_addons = { ...declinedOf(r) };
      if (action === 'decline') {
        if (a.declined) throw err('That add-on is already declined.', 409);
        if (note.length < 3) throw err('Please give a short reason (e.g., out of stock).');
        r.declined_addons[key] = note.slice(0, 255);
        log(db, 'rejected', `Declined add-on "${a.name}" on ${r.ref_code} — ${note.slice(0, 80)}`);
      } else {
        if (!a.declined) throw err('That add-on is not declined.', 409);
        if (!a.custom) {
          const id = Number(key.slice(1));
          if (db.rows.some((x) => x.id !== r.id && HOLD.includes(x.status) && x.reservation_date === r.reservation_date
                                  && x.time_shift === r.time_shift && activeEq(x).includes(id)))
            throw err('Another booking already holds that item for this shift, so it cannot be restored.', 409);
        }
        delete r.declined_addons[key];
        log(db, 'approved', `Restored add-on "${a.name}" on ${r.ref_code}`);
      }
      save(db);
      return ok({ message: action === 'decline' ? `Add-on declined: ${a.name}. The student can see your reason.` : `Add-on restored: ${a.name}.` });
    },
    'admin/review.php': ({ body }) => {
      requireAdmin();
      const note = String(body.note || '').trim();
      const action = body.action;
      if (!['approve', 'reject'].includes(action)) throw err('Invalid request.');
      if (action === 'reject' && note.length < 3) throw err('Please give a short reason for rejecting.');
      const db = load();
      const r = db.rows.find((x) => x.id === Number(body.id));
      const allowed = action === 'approve' ? ['pending'] : ['pending', 'approved'];
      if (!r || !allowed.includes(r.status) || r.reservation_date < today())
        throw err('Already processed, cancelled by the student, or the date has passed. Refresh the list.', 409);
      r.status = action === 'approve' ? 'approved' : 'rejected';
      r.admin_note = note || null; r.reviewed_by = DEMO_NAME; r.reviewed_at = stamp();
      log(db, r.status, `${action === 'approve' ? 'Approved' : 'Rejected'} ${r.ref_code} — ${maskName(r.student_name)} · ${labOf(r.lab_id).name}`);
      save(db);
      return ok({ message: action === 'approve' ? 'Reservation approved.' : 'Reservation rejected. The slot is open again.' });
    },
  };

  async function api(endpoint, opts = {}) {
    await new Promise((r) => setTimeout(r, 150));             // feels like a real network call
    const fn = routes[endpoint];
    if (!fn) throw err('Unknown endpoint: ' + endpoint, 404);
    return fn({ body: opts.body || {}, query: opts.query || {} });
  }

  /* ---------- demo tools ---------- */
  const demo = {
    reset() { save({ next: 1, rows: [], events: [] }); },
    seed() {
      const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toISODate(d); };
      const [m, a, e] = SHIFT_ORDER;
      const sample = [
        ['Maria Santos', '2024-00123', 'HM-101 Culinary Arts Fundamentals', 1, 1, m, [1, 2], 'approved', null],
        ['Juan Dela Cruz', '2024-00456', 'HM-130 Garde Manger & Cold Kitchen', 3, 1, a, [3], 'pending', null],
        ['Ana Reyes', '2023-00987', 'HM-310 Food Service Operations', 2, 2, e, [], 'pending', null],
        ['Carlo Mendoza', '2024-00789', 'HM-150 Front Office Procedures', 4, 3, m, [], 'approved', null],
        ['Paolo Garcia', '2024-00654', 'HM-120 Baking and Pastry', 2, 2, m, [], 'pending', null],
        ['Liza Fernandez', '2023-00321', 'HM-220 Housekeeping Operations', 4, 4, a, [5], 'rejected', 'Room reserved for department inspection'],
        ['Rhea Villanueva', '2024-00211', 'HM-101 Culinary Arts Fundamentals', 1, 0, e, [1], 'approved', null],
        ['Marco Bautista', '2023-00412', 'HM-130 Garde Manger & Cold Kitchen', 3, 0, e, [3], 'pending', null],
        ['Sofia Aquino', '2024-00533', 'HM-310 Food Service Operations', 2, 1, e, [], 'approved', null],
        ['Miguel Torres', '2024-00876', 'HM-150 Front Office Procedures', 4, 1, a, [], 'pending', null],
        ['Kristine Lim', '2023-00778', 'HM-220 Housekeeping Operations', 4, 1, m, [5], 'approved', null],
        ['Jasmine Cruz', '2024-00615', 'HM-101 Culinary Arts Fundamentals', 1, 2, a, [1], 'approved', null],
        ['Bea Navarro', '2023-00145', 'HM-120 Baking and Pastry', 2, 3, a, [2], 'approved', null],
        ['Dante Ramos', '2024-00990', 'HM-130 Garde Manger & Cold Kitchen', 3, 4, m, [3], 'approved', null],
        ['Noel Castillo', '2024-00302', 'HM-310 Food Service Operations', 1, 5, m, [], 'pending', null],
        ['Tina Morales', '2024-00247', 'HM-150 Front Office Procedures', 4, 5, e, [], 'rejected', 'Duplicate request for the same class'],
        ['Rico Salazar', '2023-00864', 'HM-120 Baking and Pastry', 2, 6, e, [2], 'pending', null],
      ];
      const db = { next: 1, rows: [] };
      sample.forEach(([name, sid, course, lab, off, shift, eq, status, note]) => db.rows.push({
        id: db.next++, ref_code: refCode(), lab_id: lab, student_name: name, student_id: sid, course_code: course,
        reservation_date: day(off), time_shift: shift, equipment_ids: eq, status, admin_note: note,
        reviewed_by: status === 'pending' ? null : DEMO_NAME, reviewed_at: status === 'pending' ? null : stamp(), created_at: stamp() }));
      const ev = [];
      db.rows.forEach((r, i) => {
        const at = Date.now() - (300 - i * 17) * 60000;
        ev.push({ at, kind: 'new', text: `New request ${r.ref_code}: ${maskName(r.student_name)} · ${labOf(r.lab_id).name} · ${r.reservation_date}, ${r.time_shift.split(' - ')[0]}` });
        if (r.status === 'approved' || r.status === 'rejected')
          ev.push({ at: at + 6 * 60000, kind: r.status, text: `${r.status === 'approved' ? 'Approved' : 'Rejected'} ${r.ref_code} — ${maskName(r.student_name)} · ${labOf(r.lab_id).name}` });
      });
      db.rows[0].custom_addons = [{ name: 'Extra aprons', qty: 6 }];   // sample of a personalized request
      db.events = ev.sort((x, y) => x.at - y.at);
      save(db);
    },
  };

  window.HM = { $, h, api, toISODate, pad, onChange, demo, DEMO_USER, DEMO_PASS, MAX_CUSTOM, addonLabel, addonSummary, addonList };
})();
