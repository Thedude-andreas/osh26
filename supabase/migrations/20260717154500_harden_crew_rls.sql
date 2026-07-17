drop policy if exists "crews are readable by members" on public.crews;
drop policy if exists "crews are readable by members or creator" on public.crews;
drop policy if exists "authenticated users can create crews" on public.crews;
drop policy if exists "crew owners can update crews" on public.crews;
drop policy if exists "memberships are readable by crew members" on public.crew_members;
drop policy if exists "users can add themselves to crews they created" on public.crew_members;

create policy "crews are readable by members or creator"
on public.crews for select
to authenticated
using (created_by = auth.uid() or public.is_crew_member(id));

create policy "authenticated users can create crews"
on public.crews for insert
to authenticated
with check (created_by = auth.uid());

create policy "crew owners can update crews"
on public.crews for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "memberships are readable by self or crew members"
on public.crew_members for select
to authenticated
using (user_id = auth.uid() or public.is_crew_member(crew_id));

create policy "users can add themselves to crews they created"
on public.crew_members for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_crew_creator(crew_id)
);

create or replace function public.create_crew(
  crew_name text,
  member_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  new_crew_id uuid;
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(crew_name), '') is null then
    raise exception 'Crew name is required';
  end if;

  insert into public.crews (name, created_by)
  values (trim(crew_name), current_user_id)
  returning id into new_crew_id;

  insert into public.crew_members (crew_id, user_id, role, display_name)
  values (
    new_crew_id,
    current_user_id,
    'owner',
    nullif(trim(member_display_name), '')
  );

  return new_crew_id;
end;
$$;

grant execute on function public.create_crew(text, text) to authenticated;
