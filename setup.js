// Prepara (o actualiza) el proyecto de Nhost: ejecuta db/schema.sql, publica en la API
// solo las funciones seguras y da permiso al rol "public" (visitantes sin login) para usarlas.
import { nhostUrls } from './store.js';

const cfg = window.APP_CONFIG || {};
const $ = (s) => document.querySelector(s);
const log = $('#log');

// Tablas de la versión antigua (con tags): se dejan en la base de datos como copia,
// pero se retiran de la API para que nadie pueda leerlas.
const OLD_TABLES = ['people', 'tags', 'availability', 'revision'];

// Tablas "forma" (vacías) que devuelven las funciones
const SHAPES = {
  v_group: ['id', 'name'],
  v_member: ['id', 'name'],
  v_slot: ['member_id', 'day', 'slot'],
  v_rev: ['n'],
  v_admin_group: ['id', 'name', 'code', 'members', 'created_at'],
  v_ok: ['ok', 'is_default'],
};

const QUERY_FUNCTIONS = ['group_info', 'group_members', 'group_slots', 'group_rev',
  'admin_check', 'admin_groups', 'admin_members'];
const MUTATION_FUNCTIONS = ['join_group', 'set_slot', 'admin_create_group', 'admin_rename_group',
  'admin_new_code', 'admin_delete_group', 'admin_delete_member', 'admin_change_password'];

if (!cfg.nhostSubdomain || !cfg.nhostRegion) {
  $('#target').textContent = 'Falta poner el subdominio y la región de Nhost en config.js.';
  $('#go').disabled = true;
} else {
  $('#target').innerHTML = `Proyecto: <code>${cfg.nhostSubdomain}</code> · región <code>${cfg.nhostRegion}</code>`;
}

function line(text, cls = 'info') {
  const li = document.createElement('li');
  li.className = cls; li.textContent = text;
  log.append(li);
  return li;
}

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const secret = $('#secret').value.trim();
  if (!secret) return;
  $('#go').disabled = true;
  $('#done').hidden = true;
  log.replaceChildren();
  try {
    await run(secret);
    $('#done').hidden = false;
  } catch (err) {
    console.error(err);
    line(err.message || String(err), 'err');
    $('#go').disabled = false;
  }
});

async function run(secret) {
  const urls = nhostUrls(cfg.nhostSubdomain, cfg.nhostRegion);

  async function hasura(path, body) {
    let res;
    try {
      res = await fetch(urls.hasura + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': secret },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('No se pudo conectar con Nhost. ¿Está el proyecto encendido (Live)?');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `HTTP ${res.status}`);
      err.code = json.code;
      err.status = res.status;
      throw err;
    }
    return json;
  }
  const meta = (type, args) => hasura('/v1/metadata', { type, args });
  const table = (name) => ({ schema: 'public', name });
  const fn = (name) => ({ schema: 'public', name });
  const already = (err) => /already|exists/i.test(`${err.code} ${err.message}`);
  const detail = (err) => `(detalle: HTTP ${err.status ?? '?'} · ${err.code ?? '-'} · ${err.message})`;

  // 0. Comprobar la clave
  let li = line('Comprobando la clave de Nhost…');
  try {
    await meta('export_metadata', {});
  } catch (err) {
    if (err.status === 401 || err.code === 'access-denied' || /secret|access/i.test(err.message)) {
      throw new Error(`Nhost no acepta el Admin Secret. ${detail(err)}`);
    }
    throw new Error(`No se pudo hablar con Nhost ${detail(err)}`);
  }
  li.className = 'ok'; li.textContent = 'Clave correcta';

  // 1. Retirar de la API las tablas antiguas
  li = line('Retirando la versión antigua de la API…');
  for (const name of OLD_TABLES) {
    try { await meta('pg_untrack_table', { source: 'default', table: table(name), cascade: true }); } catch { /* no estaba */ }
  }
  li.className = 'ok'; li.textContent = 'Versión antigua retirada (los datos se conservan)';

  // 2. Tablas, funciones y migración
  li = line('Creando tablas y pasando los datos a grupos…');
  const sql = await (await fetch('db/schema.sql', { cache: 'no-store' })).text();
  try {
    await hasura('/v2/query', { type: 'run_sql', args: { source: 'default', sql, cascade: false, read_only: false } });
  } catch (err) {
    throw new Error(`Error creando las tablas ${detail(err)}`);
  }
  li.className = 'ok'; li.textContent = 'Tablas creadas y datos migrados';

  // 3. Publicar las formas de respuesta y dejarlas leer (están vacías)
  li = line('Publicando la API…');
  for (const [name, columns] of Object.entries(SHAPES)) {
    try { await meta('pg_track_table', { source: 'default', table: table(name) }); } catch (err) { if (!already(err)) throw new Error(`${name}: ${detail(err)}`); }
    try { await meta('pg_drop_select_permission', { source: 'default', table: table(name), role: 'public' }); } catch { /* */ }
    await meta('pg_create_select_permission', {
      source: 'default', table: table(name), role: 'public',
      permission: { columns, filter: {} },
    });
  }

  // 4. Publicar las funciones
  for (const name of QUERY_FUNCTIONS) {
    try { await meta('pg_track_function', { source: 'default', function: fn(name) }); } catch (err) { if (!already(err)) throw new Error(`${name}: ${detail(err)}`); }
  }
  for (const name of MUTATION_FUNCTIONS) {
    try {
      await meta('pg_track_function', { source: 'default', function: fn(name), configuration: { exposed_as: 'mutation' } });
    } catch (err) { if (!already(err)) throw new Error(`${name}: ${detail(err)}`); }
  }
  for (const name of [...QUERY_FUNCTIONS, ...MUTATION_FUNCTIONS]) {
    try { await meta('pg_create_function_permission', { source: 'default', function: fn(name), role: 'public' }); } catch { /* ya existe o se infiere */ }
  }
  li.className = 'ok'; li.textContent = 'API publicada';

  // 5. Comprobación como un visitante normal (sin clave)
  li = line('Comprobando como visitante…');
  const asPublic = async (query) => {
    const res = await fetch(urls.graphql, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    return res.json();
  };
  const q = await asPublic('{ group_info(args: {p_code: "x"}) { id } admin_check(args: {p_password: "x"}) { ok } }');
  if (q.errors?.length) throw new Error('Lectura: ' + q.errors[0].message);
  const m = await asPublic('mutation { join_group(args: {p_code: "x", p_name: "x"}) { id } }');
  if (m.errors?.length) throw new Error('Escritura: ' + m.errors[0].message);
  const leak = await asPublic('{ people { id } }');
  if (!leak.errors?.length) throw new Error('Las tablas antiguas siguen siendo visibles; vuelve a ejecutar la preparación.');
  li.className = 'ok'; li.textContent = 'Todo funciona y los datos están protegidos';
}
