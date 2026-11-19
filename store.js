// Acceso a datos en Nhost. Todo pasa por funciones de la base de datos que exigen
// el código del grupo (enlace) o la contraseña de admin.
export const SLOTS = ['manana', 'tarde', 'noche'];

export function nhostUrls(subdomain, region) {
  return {
    graphql: `https://${subdomain}.graphql.${region}.nhost.run/v1`,
    graphqlWs: `wss://${subdomain}.graphql.${region}.nhost.run/v1`,
    hasura: `https://${subdomain}.hasura.${region}.nhost.run`,
  };
}

export function createStore(config = window.APP_CONFIG || {}) {
  if (!config.nhostSubdomain || !config.nhostRegion) {
    throw new Error('Falta configurar Nhost en config.js');
  }
  const urls = nhostUrls(config.nhostSubdomain, config.nhostRegion);

  async function gql(query, variables = {}) {
    const res = await fetch(urls.graphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data;
  }

  return {
    /* ---------------------------------------------------------- grupo */
    async getGroup(code) {
      const d = await gql('query ($c: String!) { group_info(args: {p_code: $c}) { id name } }', { c: code });
      return d.group_info[0] ?? null;
    },
    async listMembers(code) {
      const d = await gql('query ($c: String!) { group_members(args: {p_code: $c}) { id name } }', { c: code });
      return d.group_members;
    },
    async join(code, name) {
      const d = await gql('mutation ($c: String!, $n: String!) { join_group(args: {p_code: $c, p_name: $n}) { id name } }',
        { c: code, n: name });
      if (!d.join_group[0]) throw new Error('No se pudo entrar en el grupo');
      return d.join_group[0];
    },
    async listSlots(code, from, to) {
      const d = await gql(`query ($c: String!, $f: date!, $t: date!) {
        group_slots(args: {p_code: $c, p_from: $f, p_to: $t}) { member_id day slot }
      }`, { c: code, f: from, t: to });
      return d.group_slots;
    },
    async setSlot(code, memberId, day, slot, available) {
      const d = await gql(`mutation ($c: String!, $m: uuid!, $d: date!, $s: String!, $a: Boolean!) {
        set_slot(args: {p_code: $c, p_member: $m, p_day: $d, p_slot: $s, p_available: $a}) { member_id }
      }`, { c: code, m: memberId, d: day, s: slot, a: available });
      if (!d.set_slot.length) throw new Error('No autorizado');
    },

    // Tiempo real: suscripción al contador de cambios del grupo.
    // Respaldo: recarga cada 30 s y al volver a la pestaña.
    subscribe(code, cb) {
      let lastN = null;
      let retry = 1000;
      const connect = () => {
        let ws;
        try { ws = new WebSocket(urls.graphqlWs, 'graphql-ws'); } catch { return; }
        ws.onopen = () => { retry = 1000; ws.send(JSON.stringify({ type: 'connection_init', payload: {} })); };
        ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type === 'connection_ack') {
            ws.send(JSON.stringify({
              id: '1', type: 'start',
              payload: {
                query: 'subscription ($c: String!) { group_rev(args: {p_code: $c}) { n } }',
                variables: { c: code },
              },
            }));
          } else if (msg.type === 'data') {
            const n = msg.payload?.data?.group_rev?.[0]?.n;
            if (n == null) return;
            if (lastN !== null && n !== lastN) cb();
            lastN = n;
          }
        };
        ws.onclose = () => { setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); };
      };
      connect();
      setInterval(() => { if (!document.hidden) cb(); }, 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
    },

    /* ---------------------------------------------------------- admin */
    async adminCheck(pw) {
      const d = await gql('query ($p: String!) { admin_check(args: {p_password: $p}) { ok is_default } }', { p: pw });
      return d.admin_check[0] ?? null; // null = contraseña incorrecta
    },
    async adminGroups(pw) {
      const d = await gql('query ($p: String!) { admin_groups(args: {p_password: $p}) { id name code members created_at } }', { p: pw });
      return d.admin_groups;
    },
    async adminMembers(pw, groupId) {
      const d = await gql('query ($p: String!, $g: uuid!) { admin_members(args: {p_password: $p, p_group: $g}) { id name } }',
        { p: pw, g: groupId });
      return d.admin_members;
    },
    async adminCreateGroup(pw, name) {
      const d = await gql('mutation ($p: String!, $n: String!) { admin_create_group(args: {p_password: $p, p_name: $n}) { id name code members created_at } }',
        { p: pw, n: name });
      if (!d.admin_create_group[0]) throw new Error('No se pudo crear el grupo');
      return d.admin_create_group[0];
    },
    async adminRenameGroup(pw, id, name) {
      const d = await gql('mutation ($p: String!, $g: uuid!, $n: String!) { admin_rename_group(args: {p_password: $p, p_group: $g, p_name: $n}) { id } }',
        { p: pw, g: id, n: name });
      if (!d.admin_rename_group[0]) throw new Error('No se pudo renombrar');
    },
    async adminNewCode(pw, id) {
      const d = await gql('mutation ($p: String!, $g: uuid!) { admin_new_code(args: {p_password: $p, p_group: $g}) { id } }',
        { p: pw, g: id });
      if (!d.admin_new_code[0]) throw new Error('No se pudo cambiar el enlace');
    },
    async adminDeleteGroup(pw, id) {
      const d = await gql('mutation ($p: String!, $g: uuid!) { admin_delete_group(args: {p_password: $p, p_group: $g}) { id } }',
        { p: pw, g: id });
      if (!d.admin_delete_group[0]) throw new Error('No se pudo borrar el grupo');
    },
    async adminDeleteMember(pw, id) {
      const d = await gql('mutation ($p: String!, $m: uuid!) { admin_delete_member(args: {p_password: $p, p_member: $m}) { id } }',
        { p: pw, m: id });
      if (!d.admin_delete_member[0]) throw new Error('No se pudo borrar la persona');
    },
    async adminChangePassword(pw, newPw) {
      const d = await gql('mutation ($p: String!, $n: String!) { admin_change_password(args: {p_password: $p, p_new: $n}) { ok is_default } }',
        { p: pw, n: newPw });
      if (!d.admin_change_password[0]) throw new Error('No se pudo cambiar la contraseña');
      return d.admin_change_password[0];
    },
  };
}
