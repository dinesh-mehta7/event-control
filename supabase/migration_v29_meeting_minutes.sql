-- Store meeting minutes with the meeting record. Safe to run more than once.
alter table public.meetings add column if not exists minutes text not null default '';

create or replace function public.save_meeting_minutes(p_id uuid, p_minutes text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id for update;
  if not found or m.organization_id <> me.organization_id then raise exception 'Meeting not found.'; end if;
  if me.level not in ('owner','dept_head') and m.created_by is distinct from me.id then
    raise exception 'Only the meeting organizer, IT owner, or organization owner can edit the minutes.';
  end if;
  if length(coalesce(p_minutes, '')) > 20000 then raise exception 'Minutes must be under 20,000 characters.'; end if;
  update public.meetings set minutes = trim(coalesce(p_minutes, '')) where id = p_id;
end $$;
revoke all on function public.save_meeting_minutes(uuid, text) from public, anon;
grant execute on function public.save_meeting_minutes(uuid, text) to authenticated;

notify pgrst, 'reload schema';
