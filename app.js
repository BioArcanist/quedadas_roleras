import { createStore, SLOTS } from './store.js';

/* ------------------------------------------------------------ constantes */
const SLOT_LABEL = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' };
const SLOT_SHORT = { manana: 'M', tarde: 'T', noche: 'N' };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const TAG_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'];
const LS_ME = 'quedadas.me';
const LS_TAG = 'quedadas.tag';
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
const state = {
  people: [],
  tags: [],
  me: null,
  tagId: null,
  cursor: firstOfMonth(new Date()),
  avail: new Map(),      // "YYYY-MM-DD|slot" -> Set(personId)
  selectedDay: null,
};
const slotEls = new Map(); // "day|slot" -> button
let store;
let loadToken = 0;

const key = (day, slot) => `${day}|${slot}`;
const whoCan = (day, slot) => state.avail.get(key(day, slot)) || new Set();
const isMine = (day, slot) => whoCan(day, slot).has(state.me);
const personName = (id) => state.people.find(p => p.id === id)?.name ?? '¿?';
const currentTag = () => state.tags.find(t => t.id === state.tagId) || null;

/* ------------------------------------------------------------------ boot */
boot().catch(err => {
  console.error(err);
  $('#loading').textContent = 'No se ha podido conectar con la base de datos. Revisa la configuración de Nhost (config.js) o si el proyecto está en pausa.';
});

async function boot() {
  store = await createStore(window.APP_CONFIG || {});
  if (store.mode === 'local') {
    const note = $('#mode-note');
    note.hidden = false;
    note.textContent = 'Modo demo: los datos solo se guardan en este navegador. Configura Nhost para compartir el calendario.';
  }
  await refreshPeople();
  await refreshTags();
  wireEvents();
  store.subscribe(onRemoteChange);
  $('#loading').hidden = true;

  const saved = lsGet(LS_ME);
  if (saved && state.people.some(p => p.id === saved)) enterAs(saved);
  else showLobby();
}

/* ---------------------------------------------------------- tiempo real */
const pending = new Set();
let pendingTimer = null;
function onRemoteChange(kind) {
  pending.add(kind);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    const kinds = new Set(pending); pending.clear();
    try {
      if (kinds.has('people')) { await refreshPeople(); if (!$('#lobby').hidden) fillLobby(); }
      if (kinds.has('tags')) await refreshTags();
      if (state.me && (kinds.has('availability') || kinds.has('tags') || kinds.has('people'))) await loadAvailability();
    } catch (e) { console.error(e); }
  }, 250);
}

/* ----------------------------------------------------------------- datos */
async function refreshPeople() {
  state.people = await store.listPeople();
}

async function refreshTags() {
  state.tags = await store.listTags();
  if (!state.tags.some(t => t.id === state.tagId)) {
    const saved = lsGet(LS_TAG);
    state.tagId = state.tags.some(t => t.id === saved) ? saved : (state.tags[0]?.id ?? null);
  }
  renderTagPicker();
}

async function loadAvailability() {
  const token = ++loadToken;
  if (!state.tagId) { state.avail = new Map(); renderAll(); return; }
  const { start, end } = gridRange(state.cursor);
  const rows = await store.listAvailability(state.tagId, ymd(start), ymd(end));
  if (token !== loadToken) return; // llegó una respuesta más nueva
  const map = new Map();
  for (const r of rows) {
    const k = key(r.day, r.slot);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(r.person_id);
  }
  state.avail = map;
  renderAll();
}

async function setMine(day, slot, value) {
  if (!state.tagId) return;
  const k = key(day, slot);
  let set = state.avail.get(k);
  if (!set) { set = new Set(); state.avail.set(k, set); }
  if (set.has(state.me) === value) return;
  value ? set.add(state.me) : set.delete(state.me);
  renderSlot(day, slot);
  scheduleSide();
  const tagId = state.tagId;
  try {
    await store.setSlot(state.me, tagId, day, slot, value);
  } catch (e) {
    console.error(e);
    if (state.tagId === tagId) {
      value ? set.delete(state.me) : set.add(state.me);
      renderSlot(day, slot); scheduleSide();
    }
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
  const prev = sel.value || lsGet(LS_ME) || '';
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
  const existing = state.people.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return enterAs(existing.id);

  const btn = $('#lobby-enter'); btn.disabled = true;
  try {
    const p = await store.createPerson(name);
    await refreshPeople();
    enterAs(p.id);
  } catch (e2) {
    console.error(e2);
    if (e2?.code === '23505') {
      await refreshPeople();
      const p = state.people.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (p) return enterAs(p.id);
    }
    err.textContent = 'No se pudo crear el usuario.'; err.hidden = false;
  } finally { btn.disabled = false; }
}

function enterAs(id) {
  state.me = id;
  lsSet(LS_ME, id);
  $('#lobby-name').value = '';
  $('#lobby').hidden = true;
  $('#app').hidden = false;
  $('#me-name').textContent = personName(id);
  loadAvailability().catch(e => { console.error(e); toast('Error cargando el calendario'); });
}

/* ------------------------------------------------------------------ tags */
function renderTagPicker() {
  const sel = $('#tag-select');
  sel.innerHTML = '';
  for (const t of state.tags) sel.append(new Option(t.name, t.id));
  sel.value = state.tagId ?? '';
  const t = currentTag();
  $('#tag-dot').style.background = t?.color ?? 'transparent';
  document.documentElement.style.setProperty('--tag', t?.color ?? '#94a3b8');
  sel.disabled = !state.tags.length;
  $('#del-tag').disabled = !t;
  $('#empty').hidden = !!state.tags.length;
  $('#grid').hidden = !state.tags.length;
}

function openTagDialog() {
  const box = $('#tag-colors');
  box.innerHTML = '';
  const used = new Set(state.tags.map(t => t.color));
  const first = TAG_COLORS.find(c => !used.has(c)) ?? TAG_COLORS[0];
  for (const c of TAG_COLORS) {
    const id = 'c' + c.slice(1);
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'tag-color', value: c, id, checked: c === first });
    const label = Object.assign(document.createElement('label'), { htmlFor: id, title: c });
    label.style.background = c;
    box.append(input, label);
  }
  $('#tag-name').value = '';
  $('#tag-error').hidden = true;
  $('#tag-dialog').showModal();
  $('#tag-name').focus();
}

async function onTagSubmit(e) {
  e.preventDefault();
  const name = $('#tag-name').value.trim().replace(/\s+/g, ' ');
  const color = document.querySelector('input[name="tag-color"]:checked')?.value ?? TAG_COLORS[0];
  const err = $('#tag-error');
  if (!name) return;
  if (state.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    err.textContent = 'Ya existe un tag con ese nombre.'; err.hidden = false; return;
  }
  try {
    const t = await store.createTag(name, color);
    $('#tag-dialog').close();
    state.tagId = t.id; lsSet(LS_TAG, t.id);
    await refreshTags();
    await loadAvailability();
  } catch (e2) {
    console.error(e2);
    err.textContent = e2?.code === '23505' ? 'Ya existe un tag con ese nombre.' : 'No se pudo crear el tag.';
    err.hidden = false;
  }
}

async function onDeleteTag() {
  const t = currentTag();
  if (!t) return;
  const ok = await confirmDialog(`¿Borrar el tag «${t.name}»?`,
    'Se borrará para todo el grupo, junto con toda la disponibilidad marcada con este tag.');
  if (!ok) return;
  try {
    await store.deleteTag(t.id);
    state.tagId = null; lsSet(LS_TAG, null);
    await refreshTags();
    await loadAvailability();
  } catch (e) { console.error(e); toast('No se pudo borrar el tag'); }
}

function confirmDialog(title, text) {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(res => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
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
  if (!day || !state.tagId) { panel.hidden = true; return; }
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
  if (!state.tagId) return;
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
    li.textContent = 'Aún nadie ha marcado huecos con este tag.';
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
  const { start, end } = gridRange(state.cursor);
  const month = state.cursor.getMonth();
  for (const [k, set] of state.avail) {
    const day = k.split('|')[0];
    if (day < ymd(start) || day > ymd(end) || parseYmd(day).getMonth() !== month) continue;
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

  $('#tag-select').addEventListener('change', (e) => {
    state.tagId = e.target.value; lsSet(LS_TAG, state.tagId);
    renderTagPicker();
    loadAvailability();
  });
  $('#new-tag').addEventListener('click', openTagDialog);
  $('#empty-new-tag').addEventListener('click', openTagDialog);
  $('#del-tag').addEventListener('click', onDeleteTag);
  $('#tag-form').addEventListener('submit', onTagSubmit);
  $('#tag-cancel').addEventListener('click', () => $('#tag-dialog').close());

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
