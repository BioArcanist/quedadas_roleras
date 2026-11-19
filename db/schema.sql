-- Quedadas · base de datos (Postgres en Nhost)
-- No hace falta pegarlo a mano: la página setup.html lo ejecuta. Se puede ejecutar varias veces.
--
-- Seguridad: los visitantes (rol "public" de Nhost) NO pueden leer las tablas reales
-- (groups, members, slots, admin_settings). Solo pueden llamar a las funciones de abajo,
-- que exigen el código secreto del grupo (el que va en el enlace) o la contraseña de admin.
-- Las tablas v_* están siempre vacías: solo sirven para dar forma a lo que devuelven las funciones.

create extension if not exists pgcrypto;

/* ------------------------------------------------------------------ tablas */

create or replace function public.new_group_code() returns text
language sql volatile
set search_path = public, extensions, pg_catalog
as $$ select translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_') $$;

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  code       text not null unique default public.new_group_code(),
  rev        bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index if not exists members_group_name on public.members (group_id, lower(name));

-- Una fila = esa persona está DISPONIBLE ese día/franja. Sin fila = no disponible (rojo).
create table if not exists public.slots (
  member_id uuid not null references public.members(id) on delete cascade,
  day       date not null,
  slot      text not null check (slot in ('manana', 'tarde', 'noche')),
  primary key (member_id, day, slot)
);

create table if not exists public.admin_settings (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);

-- Formas de respuesta (siempre vacías)
create table if not exists public.v_group       (id uuid primary key, name text not null);
create table if not exists public.v_member      (id uuid primary key, name text not null);
create table if not exists public.v_slot        (member_id uuid not null, day date not null, slot text not null,
                                                 primary key (member_id, day, slot));
create table if not exists public.v_rev         (n bigint primary key);
create table if not exists public.v_admin_group (id uuid primary key, name text not null, code text not null,
                                                 members int not null, created_at timestamptz not null);
create table if not exists public.v_ok          (ok boolean primary key, is_default boolean not null);

/* --------------------------------------------- migración desde la versión con tags
   Solo se ejecuta la primera vez (cuando aún no hay contraseña de admin guardada).
   Cada tag se convierte en un grupo; el tag "Strixhaven" pasa a llamarse
   "Strixhaven-GrupoOsP" y se lleva a TODAS las personas (con su mismo id).
   Las tablas antiguas (people, tags, availability, revision) se dejan como copia. */
do $$
declare
  strix uuid;
begin
  if exists (select 1 from public.admin_settings) then return; end if;

  if to_regclass('public.tags') is not null then
    insert into public.groups (id, name, created_at)
      select id,
             case when lower(btrim(name)) = 'strixhaven' then 'Strixhaven-GrupoOsP' else name end,
             created_at
      from public.tags;
  end if;

  select id into strix from public.groups where name = 'Strixhaven-GrupoOsP';
  if strix is null then
    insert into public.groups (name) values ('Strixhaven-GrupoOsP') returning id into strix;
  end if;

  if to_regclass('public.people') is not null then
    insert into public.members (id, group_id, name, created_at)
      select id, strix, name, created_at from public.people;

    if to_regclass('public.availability') is not null then
      insert into public.slots (member_id, day, slot)
        select a.person_id, a.day, a.slot from public.availability a where a.tag_id = strix
      on conflict do nothing;

      insert into public.members (group_id, name, created_at)
        select distinct on (a.tag_id, p.id) a.tag_id, p.name, p.created_at
        from public.availability a join public.people p on p.id = a.person_id
        where a.tag_id <> strix
      on conflict do nothing;

      insert into public.slots (member_id, day, slot)
        select m.id, a.day, a.slot
        from public.availability a
        join public.people p  on p.id = a.person_id
        join public.members m on m.group_id = a.tag_id and lower(m.name) = lower(p.name)
        where a.tag_id <> strix
      on conflict do nothing;
    end if;
  end if;

  -- Contraseña inicial de admin: "administrador" (cámbiala nada más entrar)
  insert into public.admin_settings (id, password_hash)
    values (1, crypt('administrador', gen_salt('bf')));
end $$;

-- Por si se ejecuta en una base nueva sin migración
insert into public.admin_settings (id, password_hash)
  values (1, crypt('administrador', gen_salt('bf')))
  on conflict (id) do nothing;

/* --------------------------------------- contador de cambios (para tiempo real) */
create or replace function public.bump_group_rev() returns trigger
language plpgsql as $$
declare gid uuid;
begin
  if tg_table_name = 'members' then
    gid := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  else
    select group_id into gid from public.members
      where id = case when tg_op = 'DELETE' then old.member_id else new.member_id end;
  end if;
  if gid is not null then
    update public.groups set rev = rev + 1 where id = gid;
  end if;
  return null;
end $$;

drop trigger if exists bump_group_rev on public.members;
create trigger bump_group_rev after insert or update or delete on public.members
  for each row execute function public.bump_group_rev();
drop trigger if exists bump_group_rev on public.slots;
create trigger bump_group_rev after insert or update or delete on public.slots
  for each row execute function public.bump_group_rev();

/* ------------------------------------------------- funciones para los grupos */
create or replace function public.group_info(p_code text) returns setof public.v_group
language sql stable as $$
  select id, name from public.groups where code = p_code
$$;

create or replace function public.group_members(p_code text) returns setof public.v_member
language sql stable as $$
  select m.id, m.name
  from public.members m join public.groups g on g.id = m.group_id
  where g.code = p_code
  order by lower(m.name)
$$;

create or replace function public.group_slots(p_code text, p_from date, p_to date) returns setof public.v_slot
language sql stable as $$
  select s.member_id, s.day, s.slot
  from public.slots s
  join public.members m on m.id = s.member_id
  join public.groups g  on g.id = m.group_id
  where g.code = p_code and s.day between p_from and p_to
$$;

create or replace function public.group_rev(p_code text) returns setof public.v_rev
language sql stable as $$
  select rev from public.groups where code = p_code
$$;

create or replace function public.join_group(p_code text, p_name text) returns setof public.v_member
language plpgsql volatile as $$
declare
  g uuid;
  n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  select id into g from public.groups where code = p_code;
  if g is null or n = '' or char_length(n) > 30 then return; end if;
  insert into public.members (group_id, name) values (g, n)
    on conflict (group_id, lower(name)) do nothing;
  return query select id, name from public.members where group_id = g and lower(name) = lower(n);
end $$;

create or replace function public.set_slot(p_code text, p_member uuid, p_day date, p_slot text, p_available boolean)
returns setof public.v_slot
language plpgsql volatile as $$
begin
  if not exists (
    select 1 from public.members m join public.groups g on g.id = m.group_id
    where m.id = p_member and g.code = p_code
  ) then
    return;
  end if;
  if p_available then
    insert into public.slots (member_id, day, slot) values (p_member, p_day, p_slot) on conflict do nothing;
  else
    delete from public.slots where member_id = p_member and day = p_day and slot = p_slot;
  end if;
  return query select p_member, p_day, p_slot;
end $$;

/* ------------------------------------------------------- funciones de admin
   Todas exigen la contraseña; si es incorrecta no hacen nada y no devuelven nada. */
create or replace function public.admin_ok(p_password text) returns boolean
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select coalesce(
    (select password_hash = crypt(coalesce(p_password, ''), password_hash)
     from public.admin_settings where id = 1),
    false)
$$;

create or replace function public.admin_check(p_password text) returns setof public.v_ok
language sql stable as $$
  select true, p_password = 'administrador' where public.admin_ok(p_password)
$$;

create or replace function public.admin_groups(p_password text) returns setof public.v_admin_group
language sql stable as $$
  select g.id, g.name, g.code,
         (select count(*) from public.members m where m.group_id = g.id)::int,
         g.created_at
  from public.groups g
  where public.admin_ok(p_password)
  order by g.created_at
$$;

create or replace function public.admin_members(p_password text, p_group uuid) returns setof public.v_member
language sql stable as $$
  select m.id, m.name from public.members m
  where m.group_id = p_group and public.admin_ok(p_password)
  order by lower(m.name)
$$;

create or replace function public.admin_create_group(p_password text, p_name text) returns setof public.v_admin_group
language plpgsql volatile as $$
declare n text := btrim(coalesce(p_name, ''));
begin
  if not public.admin_ok(p_password) or n = '' or char_length(n) > 60 then return; end if;
  return query
    insert into public.groups (name) values (n)
    returning id, name, code, 0, created_at;
end $$;

create or replace function public.admin_rename_group(p_password text, p_group uuid, p_name text) returns setof public.v_admin_group
language plpgsql volatile as $$
declare n text := btrim(coalesce(p_name, ''));
begin
  if not public.admin_ok(p_password) or n = '' or char_length(n) > 60 then return; end if;
  return query
    update public.groups set name = n where id = p_group
    returning id, name, code, (select count(*) from public.members m where m.group_id = p_group)::int, created_at;
end $$;

create or replace function public.admin_new_code(p_password text, p_group uuid) returns setof public.v_admin_group
language plpgsql volatile as $$
begin
  if not public.admin_ok(p_password) then return; end if;
  return query
    update public.groups set code = public.new_group_code() where id = p_group
    returning id, name, code, (select count(*) from public.members m where m.group_id = p_group)::int, created_at;
end $$;

create or replace function public.admin_delete_group(p_password text, p_group uuid) returns setof public.v_admin_group
language plpgsql volatile as $$
begin
  if not public.admin_ok(p_password) then return; end if;
  return query
    delete from public.groups where id = p_group
    returning id, name, code, 0, created_at;
end $$;

create or replace function public.admin_delete_member(p_password text, p_member uuid) returns setof public.v_member
language plpgsql volatile as $$
begin
  if not public.admin_ok(p_password) then return; end if;
  return query delete from public.members where id = p_member returning id, name;
end $$;

create or replace function public.admin_change_password(p_password text, p_new text) returns setof public.v_ok
language plpgsql volatile
set search_path = public, extensions, pg_catalog
as $$
begin
  if not public.admin_ok(p_password) or coalesce(p_new, '') = '' then return; end if;
  update public.admin_settings set password_hash = crypt(p_new, gen_salt('bf')) where id = 1;
  return query select true, p_new = 'administrador';
end $$;
