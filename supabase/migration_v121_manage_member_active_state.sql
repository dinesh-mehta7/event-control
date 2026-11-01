-- v121: let the Super Admin disable and re-enable member accounts without deleting their records.
create or replace function public.set_org_member_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare target public.profiles;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can disable or enable users.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot disable or enable your own account here.'; end if;

  select * into target from public.profiles where id = p_user;
  if not found or target.organization_id is distinct from public.current_organization_id() then
    raise exception 'That person is not in your organization.';
  end if;
  if p_active is null then raise exception 'Choose whether to enable or disable this account.'; end if;
  perform pg_advisory_xact_lock(hashtext(target.organization_id));
  if target.level = 'owner' and not p_active and not exists (
    select 1 from public.profiles p
    where p.organization_id = target.organization_id and p.id <> target.id
      and p.level = 'owner' and p.approved and p.is_active
  ) then
    raise exception 'The organization must have at least one active Super Admin.';
  end if;

  update public.profiles set is_active = p_active where id = p_user;
  update auth.users set banned_until = case when p_active then null else 'infinity'::timestamptz end where id = p_user;
end $$;

revoke all on function public.set_org_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_org_member_active(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
