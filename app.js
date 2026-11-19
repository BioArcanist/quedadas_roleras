import { createStore, SLOTS } from './store.js';

/* ------------------------------------------------------------ constantes */
const SLOT_LABEL = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' };
const SLOT_SHORT = { manana: 'M', tarde: 'T', noche: 'N' };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const NEW_PERSON = '__new__';

const $ = (s) => document.querySelector(s);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* */ } };

/* ---------------------------------------------------------------- fechas */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayYmd = () => ymd(new Date());

function gridRange(cursor) {
  const first = firstOfMonth(cursor);
  const offset = (first.getDay() + 6) % 7; // semana empieza en lunes
  const start = addDays(first, -offset);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  return { start, end: addDays(start, weeks * 7 - 1), weeks };
}

/* ---------------------------------------------------------------- estado */
const code = new URLSearchParams(location.search).get('g') || '';
const state = {
  group: null,           // { id, name }
  people: [],            // miembros del grupo
  me: null,
  cursor: firstOfMonth(new Date()),
  avail: new Map(),      // "YYYY-MM-DD|slot" -> Set(memberId)
  selectedDay: null,
};
const slotEls = new Map();
let store;
let loadToken = 0;

const meKey = () => `quedadas.me.${state.group.id}`;
const key = (day, slot) => `${day}|${slot}`;
const whoCan = (day, slot) => state.avail.get(key(day, slot)) || new Set();
const isMine = (day, slot) => whoCan(day, slot).has(state.me);
const personName = (id) => state.people.find(p => p.id === id)?.name ?? '¿?';

/* ------------------------------------------------------------------ boot */
boot().catch(err => {
  console.error(err);
  showGate('No se puede conectar',
    'No se ha podido conectar con la base de datos. Si nadie la ha usado en una semana puede estar en pausa: avisa a quien organiza.');
});

async function boot() {
  const adminHref = code ? `admin.html?from=${encodeURIComponent(code)}` : 'admin.html';
  document.querySelectorAll('.admin-link').forEach(a => { a.href = adminHref; });

  if (!code) return showGate();
  store = createStore();
  state.group = await store.getGroup(code);
  if (!state.group) {
    return showGate('Enlace no válido', 'Este enlace no existe o el grupo se ha borrado. Pide el enlace actual a quien organiza.');
  }
  document.title = `${state.group.name} · Quedadas`;
  document.querySelectorAll('.group-name').forEach(el => { el.textContent = state.group.name; });

  await refreshPeople();
  wireEvents();
  store.subscribe(code, onRemoteChange);
  $('#loading').hidden = true;

  // Recuerda quién eras en este grupo (o en la versión antigua de la app)
  const saved = lsGet(meKey()) || lsGet('quedadas.me');
  if (saved && state.people.some(p => p.id === saved)) enterAs(saved);
  else showLobby();
}

function showGate(title, text) {
  $('#loading').hidden = true;
  if (title) $('#gate-title').textContent = title;
  if (text) $('#gate-text').textContent = text;
  $('#gate').hidden = false;
}

/* ---------------------------------------------------------- tiempo real */
let pendingTimer = null;
function onRemoteChange() {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    try {
      await refreshPeople();
      if (!$('#lobby').hidden) fillLobby();
      if (state.me) {
        if (!state.people.some(p => p.id === state.me)) { state.me = null; lsSet(meKey(), null); showLobby(); return; }
        await loadAvailability();
      }
    } catch (e) { console.error(e); }
  }, 250);
}

/* ----------------------------------------------------------------- datos */
async function refreshPeople() {
  state.people = await store.listMembers(code);
}

async function loadAvailability() {
  const token = ++loadToken;
  const { start, end } = gridRange(state.cursor);
  const rows = await store.listSlots(code, ymd(start), ymd(end));
  if (token !== loadToken) return;
  const map = new Map();
  for (const r of rows) {
    const k = key(r.day, r.slot);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(r.member_id);
  }
  state.avail = map;
  renderAll();
}

async function setMine(day, slot, value) {
  const k = key(day, slot);
  let set = state.avail.get(k);
  if (!set) { set = new Set(); state.avail.set(k, set); }
  if (set.has(state.me) === value) return;
  value ? set.add(state.me) : set.delete(state.me);
  renderSlot(day, slot);
  scheduleSide();
  try {
    await store.setSlot(code, state.me, day, slot, value);
  } catch (e) {
    console.error(e);
    value ? set.delete(state.me) : set.add(state.me);
    renderSlot(day, slot); scheduleSide();
    toast('No se pudo guardar. ¿Hay conexión?');
  }
}

/* ----------------------------------------------------------------- lobby */
function showLobby() {
  $('#app').hidden = true;
  $('#lobby').hidden = false;
  $('#lobby-error').hidden = true;
  fillLobby();
}

function fillLobby() {
  const sel = $('#lobby-select');
  const prev = sel.value || lsGet(meKey()) || '';
  sel.innerHTML = '';
  sel.append(new Option('— Elige tu nombre —', ''));
  for (const p of state.people) sel.append(new Option(p.name, p.id));
  sel.append(new Option('＋ Crear usuario nuevo…', NEW_PERSON));
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  else if (!state.people.length) sel.value = NEW_PERSON;
  onLobbySelect();
}

function onLobbySelect() {
  const isNew = $('#lobby-select').value === NEW_PERSON;
  $('#lobby-new').hidden = !isNew;
  if (isNew) $('#lobby-name').focus();
}

async function onLobbySubmit(e) {
  e.preventDefault();
  const err = $('#lobby-error');
  err.hidden = true;
  const v = $('#lobby-select').value;
  if (v && v !== NEW_PERSON) return enterAs(v);
  if (v !== NEW_PERSON) { err.textContent = 'Elige quién eres o crea un usuario.'; err.hidden = false; return; }

  const name = $('#lobby-name').value.trim().replace(/\s+/g, ' ');
  if (!name) { err.textContent = 'Escribe un nombre.'; err.hidden = false; return; }

  const btn = $('#lobby-enter'); btn.disabled = true;
  try {
    const p = await store.join(code, name); // si ya existe, devuelve el existente
    await refreshPeople();
    enterAs(p.id);
  } catch (e2) {
    console.error(e2);
    err.textContent = 'No se pudo crear el usuario.'; err.hidden = false;
  } finally { btn.disabled = false; }
}

function enterAs(id) {
  state.me = id;
  lsSet(meKey(), id);
  $('#lobby-name').value = '';
  $('#lobby').hidden = true;
  $('#app').hidden = false;
  $('#me-name').textContent = personName(id);
  loadAvailability().catch(e => { console.error(e); toast('Error cargando el calendario'); });
}

/* ----------------------------------------------------------- renderizado */
function renderAll() {
  renderGrid();
  renderSide();
}

function renderGrid() {
  const grid = $('#grid');
  const { start, weeks } = gridRange(state.cursor);
  const month = state.cursor.getMonth();
  const today = todayYmd();
  $('#month-label').textContent = `${MONTHS[month]} ${state.cursor.getFullYear()}`;

  slotEls.clear();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const day = ymd(d);
    const cell = document.createElement('div');
    cell.className = 'day';
    if (d.getMonth() !== month) cell.classList.add('other');
    if (day === today) cell.classList.add('today');
    if (day < today) cell.classList.add('past');
    if (day === state.selectedDay) cell.classList.add('selected');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'day-num';
    head.dataset.day = day;
    head.textContent = d.getDate();
    head.title = 'Ver quién puede este día';
    cell.append(head);

    for (const slot of SLOTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.dataset.day = day;
      b.dataset.slot = slot;
      b.innerHTML = `<span class="sl">${SLOT_SHORT[slot]}</span><span class="sl-long">${SLOT_LABEL[slot]}</span><span class="cnt"></span>`;
      slotEls.set(key(day, slot), b);
      cell.append(b);
    }
    frag.append(cell);
  }
  grid.replaceChildren(frag);
  for (const k of slotEls.keys()) { const [day, slot] = k.split('|'); renderSlot(day, slot); }
}

function renderSlot(day, slot) {
  const b = slotEls.get(key(day, slot));
  if (!b) return;
  const set = whoCan(day, slot);
  const mine = set.has(state.me);
  const total = state.people.length;
  const n = [...set].filter(id => state.people.some(p => p.id === id)).length;
  b.classList.toggle('on', mine);
  b.classList.toggle('off', !mine);
  b.classList.toggle('all', total > 1 && n === total);
  b.setAttribute('aria-pressed', String(mine));
  b.querySelector('.cnt').textContent = total > 1 ? `${n}/${total}` : '';
  const names = [...set].map(personName).sort((a, c) => a.localeCompare(c, 'es'));
  b.title = `${SLOT_LABEL[slot]} · ${mine ? 'tú: disponible' : 'tú: no disponible'}\n` +
    (names.length ? `Pueden: ${names.join(', ')}` : 'Nadie puede todavía');
}

let sideRaf = 0;
function scheduleSide() {
  cancelAnimationFrame(sideRaf);
  sideRaf = requestAnimationFrame(renderSide);
}

function renderSide() {
  renderDayPanel();
  renderBest();
  renderPeople();
}

function renderDayPanel() {
  const panel = $('#day-panel');
  const day = state.selectedDay;
  if (!day) { panel.hidden = true; return; }
  panel.hidden = false;
  const d = parseYmd(day);
  $('#day-title').textContent = `${WEEKDAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  const box = $('#day-slots');
  box.replaceChildren();
  for (const slot of SLOTS) {
    const set = whoCan(day, slot);
    const row = document.createElement('div');
    row.className = 'day-slot';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pill ' + (set.has(state.me) ? 'on' : 'off');
    toggle.textContent = SLOT_LABEL[slot];
    toggle.title = 'Cambiar mi disponibilidad';
    toggle.addEventListener('click', () => setMine(day, slot, !isMine(day, slot)).then(renderDayPanel));
    const who = document.createElement('div');
    who.className = 'who';
    for (const p of state.people) {
      const chip = document.createElement('span');
      chip.className = 'chip ' + (set.has(p.id) ? 'yes' : 'no');
      chip.textContent = p.name + (p.id === state.me ? ' (tú)' : '');
      who.append(chip);
    }
    row.append(toggle, who);
    box.append(row);
  }
}

function renderBest() {
  const ol = $('#best');
  ol.replaceChildren();
  const { start, end } = gridRange(state.cursor);
  const today = todayYmd();
  const from = ymd(start) < today ? today : ymd(start);
  const list = [];
  for (let d = parseYmd(from); ymd(d) <= ymd(end); d = addDays(d, 1)) {
    const day = ymd(d);
    SLOTS.forEach((slot, i) => {
      const ids = [...whoCan(day, slot)].filter(id => state.people.some(p => p.id === id));
      if (ids.length) list.push({ day, slot, i, ids });
    });
  }
  list.sort((a, b) => b.ids.length - a.ids.length || a.day.localeCompare(b.day) || a.i - b.i);
  const top = list.slice(0, 6);
  if (!top.length) {
    const li = document.createElement('li');
    li.className = 'muted plain';
    li.textContent = 'Aún nadie ha marcado huecos este mes.';
    ol.append(li);
    return;
  }
  const total = state.people.length;
  for (const it of top) {
    const d = parseYmd(it.day);
    const li = document.createElement('li');
    if (it.ids.length === total && total > 1) li.classList.add('all');
    const when = document.createElement('button');
    when.type = 'button';
    when.className = 'link when';
    when.textContent = `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} · ${SLOT_LABEL[it.slot]}`;
    when.addEventListener('click', () => selectDay(it.day));
    const cnt = document.createElement('span');
    cnt.className = 'badge';
    cnt.textContent = `${it.ids.length}/${total}`;
    const names = document.createElement('div');
    names.className = 'names muted';
    names.textContent = it.ids.map(personName).sort((a, b) => a.localeCompare(b, 'es')).join(', ');
    li.append(when, cnt, names);
    ol.append(li);
  }
}

function renderPeople() {
  const ul = $('#people');
  ul.replaceChildren();
  const counts = new Map();
  const month = state.cursor.getMonth();
  for (const [k, set] of state.avail) {
    if (parseYmd(k.split('|')[0]).getMonth() !== month) continue;
    for (const id of set) counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const p of state.people) {
    const li = document.createElement('li');
    if (p.id === state.me) li.classList.add('me');
    const n = counts.get(p.id) || 0;
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === state.me ? ' (tú)' : '');
    const c = document.createElement('span');
    c.className = 'muted';
    c.textContent = n ? `${n} hueco${n === 1 ? '' : 's'}` : 'sin marcar';
    li.append(name, c);
    ul.append(li);
  }
}

function selectDay(day) {
  state.selectedDay = state.selectedDay === day ? null : day;
  const d = parseYmd(day);
  if (state.selectedDay && (d.getMonth() !== state.cursor.getMonth() || d.getFullYear() !== state.cursor.getFullYear())) {
    state.cursor = firstOfMonth(d);
    loadAvailability();
    return;
  }
  document.querySelectorAll('.day.selected').forEach(el => el.classList.remove('selected'));
  if (state.selectedDay) document.querySelector(`.day-num[data-day="${day}"]`)?.parentElement.classList.add('selected');
  renderDayPanel();
  if (state.selectedDay && window.matchMedia('(max-width: 900px)').matches) {
    $('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function changeMonth(delta) {
  const c = state.cursor;
  state.cursor = delta === 0 ? firstOfMonth(new Date()) : new Date(c.getFullYear(), c.getMonth() + delta, 1);
  loadAvailability().catch(e => { console.error(e); toast('Error cargando el calendario'); });
}

/* --------------------------------------------------------------- eventos */
let paint = null;           // { value } mientras se arrastra con ratón
let lastPointer = null;     // tipo del último pointerdown en el grid

function wireEvents() {
  $('#lobby-select').addEventListener('change', onLobbySelect);
  $('#lobby-form').addEventListener('submit', onLobbySubmit);
  $('#switch-user').addEventListener('click', () => { state.selectedDay = null; showLobby(); });

  $('#prev').addEventListener('click', () => changeMonth(-1));
  $('#next').addEventListener('click', () => changeMonth(1));
  $('#today').addEventListener('click', () => changeMonth(0));

  $('#day-all').addEventListener('click', () => setDay(true));
  $('#day-none').addEventListener('click', () => setDay(false));

  const grid = $('#grid');
  // Ratón / lápiz: pulsar y arrastrar pinta varios huecos con el mismo valor.
  grid.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    const b = e.target.closest('.slot');
    if (!b || e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault();
    const { day, slot } = b.dataset;
    paint = { value: !isMine(day, slot) };
    setMine(day, slot, paint.value);
  });
  grid.addEventListener('pointerover', (e) => {
    if (!paint) return;
    const b = e.target.closest('.slot');
    if (b) setMine(b.dataset.day, b.dataset.slot, paint.value);
  });
  const stop = () => { paint = null; };
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);

  // Táctil y teclado: un toque / Enter cambia un hueco.
  grid.addEventListener('click', (e) => {
    const num = e.target.closest('.day-num');
    if (num) { selectDay(num.dataset.day); return; }
    const b = e.target.closest('.slot');
    if (!b) return;
    const viaMouse = (lastPointer === 'mouse' || lastPointer === 'pen') && e.detail > 0;
    lastPointer = null;
    if (viaMouse) return; // ya se gestionó en pointerdown
    const { day, slot } = b.dataset;
    setMine(day, slot, !isMine(day, slot));
  });
}

function setDay(value) {
  const day = state.selectedDay;
  if (!day) return;
  Promise.all(SLOTS.map(s => setMine(day, s, value))).then(renderDayPanel);
  renderDayPanel();
}

/* ----------------------------------------------------------------- toast */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
