create or replace function public.create_crew(
  crew_name text,
  member_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
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
