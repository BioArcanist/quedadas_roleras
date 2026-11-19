// Capa de datos: Nhost (compartido entre amigos) o localStorage (modo demo).
export const SLOTS = ['manana', 'tarde', 'noche'];

export async function createStore(config = {}) {
  if (config.nhostSubdomain && config.nhostRegion) {
    return nhostStore(config.nhostSubdomain, config.nhostRegion);
  }
  return localStore();
}

export function nhostUrls(subdomain, region) {
  return {
    graphql: `https://${subdomain}.graphql.${region}.nhost.run/v1`,
    graphqlWs: `wss://${subdomain}.graphql.${region}.nhost.run/v1`,
    hasura: `https://${subdomain}.hasura.${region}.nhost.run`,
  };
}

/* ------------------------------------------------------------------- Nhost */
function nhostStore(subdomain, region) {
  const urls = nhostUrls(subdomain, region);

  async function gql(query, variables = {}) {
    const res = await fetch(urls.graphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) {
      const e = json.errors[0];
      const err = new Error(e.message);
      const code = e.extensions?.code;
      err.code = code === 'constraint-violation' && /unique|duplicate/i.test(e.message) ? '23505' : code;
      throw err;
    }
    return json.data;
  }

  return {
    mode: 'nhost',

    async listPeople() {
      return (await gql('query { people(order_by: {name: asc}) { id name } }')).people;
    },
    async createPerson(name) {
      return (await gql('mutation ($name: String!) { insert_people_one(object: {name: $name}) { id name } }',
        { name })).insert_people_one;
    },

    async listTags() {
      return (await gql('query { tags(order_by: {created_at: asc}) { id name color } }')).tags;
    },
    async createTag(name, color) {
      return (await gql('mutation ($name: String!, $color: String!) { insert_tags_one(object: {name: $name, color: $color}) { id name color } }',
        { name, color })).insert_tags_one;
    },
    async deleteTag(id) {
      await gql('mutation ($id: uuid!) { delete_tags_by_pk(id: $id) { id } }', { id });
    },

    async listAvailability(tagId, fromDay, toDay) {
      return (await gql(`query ($tag: uuid!, $from: date!, $to: date!) {
        availability(where: {tag_id: {_eq: $tag}, day: {_gte: $from, _lte: $to}}) { person_id day slot }
      }`, { tag: tagId, from: fromDay, to: toDay })).availability;
    },
    async setSlot(personId, tagId, day, slot, available) {
      const v = { p: personId, t: tagId, d: day, s: slot };
      if (available) {
        try {
          await gql(`mutation ($p: uuid!, $t: uuid!, $d: date!, $s: String!) {
            insert_availability_one(object: {person_id: $p, tag_id: $t, day: $d, slot: $s}) { slot }
          }`, v);
        } catch (e) {
          if (e.code !== '23505') throw e; // ya estaba marcado: no pasa nada
        }
      } else {
        await gql(`mutation ($p: uuid!, $t: uuid!, $d: date!, $s: String!) {
          delete_availability(where: {person_id: {_eq: $p}, tag_id: {_eq: $t}, day: {_eq: $d}, slot: {_eq: $s}}) { affected_rows }
        }`, v);
      }
    },

    // Tiempo real: una suscripción a un contador que sube con cada cambio.
    // Si el websocket falla, se recarga cada 30 s y al volver a la pestaña.
    subscribe(cb) {
      const all = () => { cb('people'); cb('tags'); cb('availability'); };
      let lastN = null;
      let retry = 1000;

      const connect = () => {
        let ws;
        try { ws = new WebSocket(urls.graphqlWs, 'graphql-ws'); } catch { return; }
        ws.onopen = () => {
          retry = 1000;
          ws.send(JSON.stringify({ type: 'connection_init', payload: {} }));
        };
        ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type === 'connection_ack') {
            ws.send(JSON.stringify({
              id: '1', type: 'start',
              payload: { query: 'subscription { revision_by_pk(id: 1) { n } }' },
            }));
          } else if (msg.type === 'data') {
            const n = msg.payload?.data?.revision_by_pk?.n;
            if (n == null) return;
            if (lastN !== null && n !== lastN) all();
            lastN = n;
          }
        };
        ws.onclose = () => {
          setTimeout(connect, retry);
          retry = Math.min(retry * 2, 30000);
        };
      };
      connect();

      setInterval(() => { if (!document.hidden) all(); }, 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) all(); });
    },
  };
}


/* ---------------------------------------------------------- Demo (local) */
function localStore() {
  const KEY = 'quedadas.demo.v1';
  const empty = () => ({ people: [], tags: [], avail: {} });
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || empty(); } catch { return empty(); }
  };
  let bc = null;
  try { bc = new BroadcastChannel('quedadas-demo'); } catch { /* sin soporte */ }
  const save = (db, kind) => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* lleno o bloqueado */ }
    bc?.postMessage(kind);
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const dup = (msg) => Object.assign(new Error(msg), { code: '23505' });

  return {
    mode: 'local',

    async listPeople() {
      return load().people.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    async createPerson(name) {
      const db = load();
      if (db.people.some(p => p.name.toLowerCase() === name.toLowerCase())) throw dup('Ya existe');
      const p = { id: uid(), name };
      db.people.push(p); save(db, 'people');
      return p;
    },

    async listTags() { return load().tags; },
    async createTag(name, color) {
      const db = load();
      if (db.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) throw dup('Ya existe');
      const t = { id: uid(), name, color };
      db.tags.push(t); save(db, 'tags');
      return t;
    },
    async deleteTag(id) {
      const db = load();
      db.tags = db.tags.filter(t => t.id !== id);
      for (const k of Object.keys(db.avail)) if (k.split('|')[1] === id) delete db.avail[k];
      save(db, 'tags');
    },

    async listAvailability(tagId, fromDay, toDay) {
      const out = [];
      for (const k of Object.keys(load().avail)) {
        const [person_id, tag_id, day, slot] = k.split('|');
        if (tag_id === tagId && day >= fromDay && day <= toDay) out.push({ person_id, day, slot });
      }
      return out;
    },
    async setSlot(personId, tagId, day, slot, available) {
      const db = load();
      const k = [personId, tagId, day, slot].join('|');
      if (available) db.avail[k] = 1; else delete db.avail[k];
      save(db, 'availability');
    },

    subscribe(cb) {
      bc?.addEventListener('message', e => cb(e.data));
      window.addEventListener('storage', e => { if (e.key === KEY) { cb('people'); cb('tags'); } });
    },
  };
}
