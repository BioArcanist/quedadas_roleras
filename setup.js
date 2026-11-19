// Prepara el proyecto de Nhost: crea tablas (db/schema.sql), las publica en GraphQL
// y da permisos al rol "public" (los visitantes sin login).
import { nhostUrls } from './store.js';

const cfg = window.APP_CONFIG || {};
const $ = (s) => document.querySelector(s);
const log = $('#log');

const PERMS = {
  people: {
    select: ['id', 'name'],
    insert: ['name'],
  },
  tags: {
    select: ['id', 'name', 'color', 'created_at'],
    insert: ['name', 'color'],
    delete: true,
  },
  availability: {
    select: ['person_id', 'tag_id', 'day', 'slot'],
    insert: ['person_id', 'tag_id', 'day', 'slot'],
    delete: true,
  },
  revision: {
    select: ['id', 'n'],
  },
};

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
      throw new Error('No se pudo conectar con Nhost. ¿Está el proyecto encendido y el subdominio/región bien puestos?');
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

  // 1. Tablas
  let li = line('Creando tablas…');
  const sql = await (await fetch('db/schema.sql', { cache: 'no-store' })).text();
  try {
    await hasura('/v2/query', { type: 'run_sql', args: { source: 'default', sql, cascade: false, read_only: false } });
  } catch (err) {
    if (err.status === 401 || err.code === 'access-denied' || /invalid.*secret|x-hasura-admin-secret/i.test(err.message)) {
      throw new Error('El Admin Secret no es correcto. Cópialo otra vez desde Nhost.');
    }
    throw err;
  }
  li.className = 'ok'; li.textContent = 'Tablas creadas';

  // 2. Publicarlas en GraphQL
  li = line('Publicando tablas en la API…');
  for (const name of Object.keys(PERMS)) {
    try {
      await meta('pg_track_table', { source: 'default', table: table(name) });
    } catch (err) {
      if (!/already/i.test(err.code || '') && !/already/i.test(err.message)) throw err;
    }
  }
  li.className = 'ok'; li.textContent = 'Tablas publicadas en la API';

  // 3. Permisos para el rol "public" (sin login)
  li = line('Dando permisos…');
  for (const [name, p] of Object.entries(PERMS)) {
    for (const kind of ['select', 'insert', 'delete']) {
      try { await meta(`pg_drop_${kind}_permission`, { source: 'default', table: table(name), role: 'public' }); } catch { /* no existía */ }
    }
    await meta('pg_create_select_permission', {
      source: 'default', table: table(name), role: 'public',
      permission: { columns: p.select, filter: {} },
    });
    if (p.insert) {
      await meta('pg_create_insert_permission', {
        source: 'default', table: table(name), role: 'public',
        permission: { columns: p.insert, check: {} },
      });
    }
    if (p.delete) {
      await meta('pg_create_delete_permission', {
        source: 'default', table: table(name), role: 'public',
        permission: { filter: {} },
      });
    }
  }
  li.className = 'ok'; li.textContent = 'Permisos configurados';

  // 4. Comprobación como un visitante normal (sin secreto)
  li = line('Comprobando que la app puede leer…');
  const res = await fetch(urls.graphql, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ people { id } tags { id } revision_by_pk(id: 1) { n } }' }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error('La comprobación ha fallado: ' + json.errors[0].message);
  li.className = 'ok'; li.textContent = 'Todo funciona';
}
