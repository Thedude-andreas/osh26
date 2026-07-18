create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crew_role') then
    create type public.crew_role as enum ('owner', 'member');
  end if;
end $$;

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.crew_role not null default 'member',
  display_name text,
  created_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create table if not exists public.crew_locations (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  label text,
  updated_at timestamptz not null default now()
);

create table if not exists public.crew_events (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location_label text,
  notes text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.crew_locations enable row level security;
alter table public.crew_events enable row level security;

create or replace function public.is_crew_member(target_crew_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.crew_members
    where crew_id = target_crew_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_crew_creator(target_crew_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.crews
    where id = target_crew_id
      and created_by = auth.uid()
  );
$$;

create policy "profiles are readable by the owner"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles are writable by the owner"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles are updatable by the owner"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "crews are readable by members"
on public.crews for select
to authenticated
using (public.is_crew_member(id));

create policy "authenticated users can create crews"
on public.crews for insert
to authenticated
with check (created_by = auth.uid());

create policy "crew owners can update crews"
on public.crews for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "memberships are readable by crew members"
on public.crew_members for select
to authenticated
using (public.is_crew_member(crew_id) or user_id = auth.uid());

create policy "users can add themselves to crews they created"
on public.crew_members for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_crew_creator(crew_id)
);

create policy "crew locations are readable by members"
on public.crew_locations for select
to authenticated
using (public.is_crew_member(crew_id));

create policy "users can write their own location in crews"
on public.crew_locations for insert
to authenticated
with check (user_id = auth.uid() and public.is_crew_member(crew_id));

create policy "users can update their own location in crews"
on public.crew_locations for update
to authenticated
using (user_id = auth.uid() and public.is_crew_member(crew_id))
with check (user_id = auth.uid() and public.is_crew_member(crew_id));

create policy "crew events are readable by members"
on public.crew_events for select
to authenticated
using (public.is_crew_member(crew_id));

create policy "crew members can create events"
on public.crew_events for insert
to authenticated
with check (created_by = auth.uid() and public.is_crew_member(crew_id));

create policy "event creators can update events"
on public.crew_events for update
to authenticated
using (created_by = auth.uid() and public.is_crew_member(crew_id))
with check (created_by = auth.uid() and public.is_crew_member(crew_id));
