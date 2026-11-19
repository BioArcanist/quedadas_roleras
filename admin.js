import { createStore } from './store.js';

const $ = (s) => document.querySelector(s);
const from = new URLSearchParams(location.search).get('from');
let store;
let pw = null;          // contraseña solo en memoria mientras la pestaña está abierta
let groups = [];
const openMembers = new Set();

/* ------------------------------------------------------------------ inicio */
try {
  store = createStore();
} catch (e) {
  $('#login-error').textContent = e.message; $('#login-error').hidden = false;
}
if (from) {
  document.querySelectorAll('.back-link').forEach(a => {
    a.hidden = false;
    if (a.tagName === 'A') a.href = `./?g=${encodeURIComponent(from)}`;
  });
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  const btn = $('#login-btn'); btn.disabled = true;
  try {
    const res = await store.adminCheck($('#pw').value);
    if (!res) { err.textContent = 'Contraseña incorrecta.'; err.hidden = false; return; }
    pw = $('#pw').value;
    $('#pw').value = '';
    $('#default-warning').hidden = !res.is_default;
    $('#login').hidden = true;
    $('#panel').hidden = false;
    await loadGroups();
    if (res.is_default) $('#pw-new').focus();
  } catch (e2) {
    console.error(e2);
    err.textContent = 'No se pudo conectar con la base de datos.'; err.hidden = false;
  } finally { btn.disabled = false; }
});

$('#logout').addEventListener('click', () => {
  pw = null; groups = []; openMembers.clear();
  $('#groups').replaceChildren();
  $('#panel').hidden = true;
  $('#login').hidden = false;
});

/* --------------------------------------------------------------- grupos */
async function loadGroups() {
  groups = await store.adminGroups(pw);
  await render();
}

function groupLink(code) {
  return new URL(`./?g=${encodeURIComponent(code)}`, location.href).href;
}

async function render() {
  const box = $('#groups');
  box.replaceChildren();
  if (!groups.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Todavía no hay grupos. Crea el primero arriba.';
    box.append(p);
    return;
  }
  for (const g of groups) box.append(await groupCard(g));
}

async function groupCard(g) {
  const card = document.createElement('article');
  card.className = 'group-card';

  const head = document.createElement('div');
  head.className = 'group-head';
  const h = document.createElement('h4');
  h.textContent = g.name;
  const meta = document.createElement('span');
  meta.className = 'muted small-text';
  meta.textContent = `${g.members} persona${g.members === 1 ? '' : 's'}`;
  head.append(h, meta);

  const linkRow = document.createElement('div');
  linkRow.className = 'link-row';
  const input = document.createElement('input');
  input.readOnly = true;
  input.value = groupLink(g.code);
  input.addEventListener('focus', () => input.select());
  const copy = button('Copiar enlace', 'btn primary small', async () => {
    try { await navigator.clipboard.writeText(input.value); toast('Enlace copiado'); }
    catch { input.select(); toast('Selecciona el enlace y cópialo con Ctrl+C'); }
  });
  const open = document.createElement('a');
  open.className = 'btn small';
  open.href = input.value;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Abrir';
  linkRow.append(input, copy, open);

  const actions = document.createElement('div');
  actions.className = 'row-btns';
  const isOpen = openMembers.has(g.id);
  actions.append(
    button(isOpen ? 'Ocultar personas' : 'Ver personas', 'btn small ghost', () => {
      isOpen ? openMembers.delete(g.id) : openMembers.add(g.id);
      render();
    }),
    button('Renombrar', 'btn small ghost', () => renameGroup(g)),
    button('Enlace nuevo', 'btn small ghost', () => newCode(g)),
    button('Borrar grupo', 'btn small ghost danger', () => deleteGroup(g)),
  );

  card.append(head, linkRow, actions);

  if (isOpen) {
    const ul = document.createElement('ul');
    ul.className = 'people admin-people';
    const members = await store.adminMembers(pw, g.id);
    if (!members.length) {
      const li = document.createElement('li');
      li.className = 'muted'; li.textContent = 'Nadie ha entrado todavía.';
      ul.append(li);
    }
    for (const m of members) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = m.name;
      li.append(name, button('Quitar', 'link danger-link', () => deleteMember(g, m)));
      ul.append(li);
    }
    card.append(ul);
  }
  return card;
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#create-name').value.trim();
  if (!name) return;
  try {
    await store.adminCreateGroup(pw, name);
    $('#create-name').value = '';
    await loadGroups();
    toast(`Grupo «${name}» creado. Copia su enlace y pásalo.`);
  } catch (err) { console.error(err); toast('No se pudo crear el grupo'); }
});

let renaming = null;
function renameGroup(g) {
  renaming = g;
  $('#rename-name').value = g.name;
  $('#rename-dialog').showModal();
  $('#rename-name').select();
}
$('#rename-cancel').addEventListener('click', () => $('#rename-dialog').close());
$('#rename-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const g = renaming;
  const name = $('#rename-name').value.trim();
  if (!g || !name) return;
  $('#rename-dialog').close();
  renaming = null;
  try { await store.adminRenameGroup(pw, g.id, name); await loadGroups(); }
  catch (err) { console.error(err); toast('No se pudo renombrar'); }
});

async function newCode(g) {
  const ok = await confirmDialog(`¿Enlace nuevo para «${g.name}»?`,
    'El enlace actual dejará de funcionar y tendrás que pasar el nuevo a todo el grupo. Los datos no se pierden.',
    'Cambiar enlace');
  if (!ok) return;
  try { await store.adminNewCode(pw, g.id); await loadGroups(); toast('Enlace cambiado'); }
  catch (err) { console.error(err); toast('No se pudo cambiar el enlace'); }
}

async function deleteGroup(g) {
  const ok = await confirmDialog(`¿Borrar el grupo «${g.name}»?`,
    `Se borrarán sus ${g.members} persona(s) y toda la disponibilidad marcada. No se puede deshacer.`, 'Borrar');
  if (!ok) return;
  try { await store.adminDeleteGroup(pw, g.id); openMembers.delete(g.id); await loadGroups(); toast('Grupo borrado'); }
  catch (err) { console.error(err); toast('No se pudo borrar el grupo'); }
}

async function deleteMember(g, m) {
  const ok = await confirmDialog(`¿Quitar a «${m.name}» de «${g.name}»?`,
    'Se borrará también todo lo que haya marcado en este grupo.', 'Quitar');
  if (!ok) return;
  try { await store.adminDeleteMember(pw, m.id); await loadGroups(); }
  catch (err) { console.error(err); toast('No se pudo quitar a esa persona'); }
}

/* ------------------------------------------------------------ contraseña */
$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pw-msg');
  const a = $('#pw-new').value, b = $('#pw-new2').value;
  msg.hidden = false;
  if (a !== b) { msg.className = 'error small-text'; msg.textContent = 'Las dos contraseñas no coinciden.'; return; }
  try {
    const res = await store.adminChangePassword(pw, a);
    pw = a;
    $('#pw-new').value = ''; $('#pw-new2').value = '';
    msg.className = 'ok-text small-text';
    msg.textContent = 'Contraseña cambiada. Úsala la próxima vez que entres.';
    $('#default-warning').hidden = !res.is_default;
  } catch (err) {
    console.error(err);
    msg.className = 'error small-text'; msg.textContent = 'No se pudo cambiar la contraseña.';
  }
});

/* -------------------------------------------------------------- utilidades */
function confirmDialog(title, text, okText) {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okText;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(res => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
