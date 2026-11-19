// Capa de datos: Supabase (compartido entre amigos) o localStorage (modo demo).
export const SLOTS = ['manana', 'tarde', 'noche'];

export async function createStore(config = {}) {
  if (config.supabaseUrl && config.supabaseAnonKey) {
    return supabaseStore(config.supabaseUrl, config.supabaseAnonKey);
  }
  return localStore();
}

/* ---------------------------------------------------------------- Supabase */
async function supabaseStore(url, key) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const ok = ({ data, error }) => { if (error) throw error; return data; };

  return {
    mode: 'supabase',

    async listPeople() {
      return ok(await sb.from('people').select('id,name').order('name'));
    },
    async createPerson(name) {
      return ok(await sb.from('people').insert({ name }).select('id,name').single());
    },

    async listTags() {
      return ok(await sb.from('tags').select('id,name,color').order('created_at'));
    },
    async createTag(name, color) {
      return ok(await sb.from('tags').insert({ name, color }).select('id,name,color').single());
    },
    async deleteTag(id) {
      ok(await sb.from('tags').delete().eq('id', id));
    },

    async listAvailability(tagId, fromDay, toDay) {
      const out = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const rows = ok(await sb.from('availability')
          .select('person_id,day,slot')
          .eq('tag_id', tagId).gte('day', fromDay).lte('day', toDay)
          .order('day').order('person_id').order('slot')
          .range(from, from + PAGE - 1));
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
    async setSlot(personId, tagId, day, slot, available) {
      const row = { person_id: personId, tag_id: tagId, day, slot };
      if (available) {
        ok(await sb.from('availability').upsert(row, {
          onConflict: 'person_id,tag_id,day,slot', ignoreDuplicates: true,
        }));
      } else {
        ok(await sb.from('availability').delete().match(row));
      }
    },

    subscribe(cb) {
      sb.channel('quedadas')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, () => cb('people'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' }, () => cb('tags'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => cb('availability'))
        .subscribe();
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
