drop policy if exists "crews are readable by members" on public.crews;

create policy "crews are readable by members or creator"
on public.crews for select
to authenticated
using (public.is_crew_member(id) or created_by = auth.uid());
