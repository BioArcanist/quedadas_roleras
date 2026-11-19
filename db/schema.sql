-- Quedadas · tablas de la base de datos (Postgres en Nhost).
-- No hace falta pegarlo a mano: la página setup.html lo ejecuta sola.
-- Se puede ejecutar varias veces sin romper nada.

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

-- Contador que sube con cada cambio: la web se suscribe a él para refrescarse sola.
create table if not exists public.revision (
  id int primary key default 1 check (id = 1),
  n  bigint not null default 0
);
insert into public.revision (id, n) values (1, 0) on conflict (id) do nothing;

create or replace function public.bump_revision() returns trigger
language plpgsql as $$
begin
  update public.revision set n = n + 1 where id = 1;
  return null;
end $$;

drop trigger if exists bump_revision on public.people;
create trigger bump_revision after insert or update or delete on public.people
  for each statement execute function public.bump_revision();
drop trigger if exists bump_revision on public.tags;
create trigger bump_revision after insert or update or delete on public.tags
  for each statement execute function public.bump_revision();
drop trigger if exists bump_revision on public.availability;
create trigger bump_revision after insert or update or delete on public.availability
  for each statement execute function public.bump_revision();
