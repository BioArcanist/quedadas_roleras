-- Quedadas · esquema para Supabase
-- Pégalo entero en Supabase → SQL Editor → New query → Run.
-- Sin login: cualquiera con el enlace puede leer y escribir (somos amigos).

create extension if not exists pgcrypto;

create table if not exists public.people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index if not exists people_name_ci on public.people (lower(name));

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 30),
  color      text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists tags_name_ci on public.tags (lower(name));

-- Una fila = esa persona está DISPONIBLE ese día/franja para ese tag.
-- Si no hay fila, no está disponible (rojo por defecto).
create table if not exists public.availability (
  person_id uuid not null references public.people(id) on delete cascade,
  tag_id    uuid not null references public.tags(id)   on delete cascade,
  day       date not null,
  slot      text not null check (slot in ('manana', 'tarde', 'noche')),
  primary key (person_id, tag_id, day, slot)
);
create index if not exists availability_tag_day on public.availability (tag_id, day);

-- Acceso abierto con la clave pública (anon)
alter table public.people       enable row level security;
alter table public.tags         enable row level security;
alter table public.availability enable row level security;

drop policy if exists "abierto" on public.people;
drop policy if exists "abierto" on public.tags;
drop policy if exists "abierto" on public.availability;
create policy "abierto" on public.people       for all to anon, authenticated using (true) with check (true);
create policy "abierto" on public.tags         for all to anon, authenticated using (true) with check (true);
create policy "abierto" on public.availability for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.people, public.tags, public.availability to anon, authenticated;

-- Tiempo real: que los cambios de un amigo aparezcan solos en las pantallas de los demás
alter table public.availability replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.people;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tags;         exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.availability; exception when duplicate_object then null; end;
end $$;
