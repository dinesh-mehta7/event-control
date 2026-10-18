-- ============================================================================
-- v94 · Super Admin: rename the organization, set its logo, delete a user
-- ----------------------------------------------------------------------------
-- 1. organizations.logo_url holds the logo (a small image, stored as a data URL).
-- 2. update_organization_profile(name, logo) — Super Admin only.
-- 3. delete_org_member(user) — Super Admin only. Removes the person's login and
--    profile. Records they made stay, with the person's link cleared. If some
--    record cannot lose its link, the account is disabled and locked instead.
-- Run after v93. Safe to re-run.
-- ============================================================================

alter table public.organizations add column if not exists logo_url text;

-- Only the Super Admin changes the organization (was: any Admin).
drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations for update
  using (id = public.current_organization_id() and public.is_org_owner());

create or replace function public.update_organization_profile(p_name text, p_logo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can change the organization.'; end if;
  if length(v_name) < 2 then raise exception 'Enter an organization name.'; end if;
  if length(v_name) > 80 then raise exception 'Keep the name under 80 characters.'; end if;
  if p_logo is not null and p_logo <> '' and (p_logo not like 'data:image/%' or length(p_logo) > 400000) then
    raise exception 'The logo must be an image under 300 KB.';
  end if;
  update public.organizations
    set name = v_name, logo_url = nullif(p_logo, '')
    where id = public.current_organization_id();
end $$;
grant execute on function public.update_organization_profile(text, text) to authenticated;

create or replace function public.delete_org_member(p_user uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare t record; fk record;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can delete users.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;
  if t.level = 'owner' then raise exception 'The Super Admin account cannot be deleted.'; end if;

  begin
    -- Clear links to this person in records that would otherwise block the delete.
    for fk in
      select n.nspname as sch, c.relname as tbl, a.attname as col
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and array_length(k.conkey, 1) = 1
        and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
        and k.confdeltype in ('a', 'r')          -- no action / restrict
        and n.nspname = 'public' and not a.attnotnull
    loop
      execute format('update %I.%I set %I = null where %I = $1', fk.sch, fk.tbl, fk.col, fk.col) using p_user;
    end loop;
    delete from public.profiles where id = p_user;
    delete from auth.users where id = p_user;
    return 'deleted';
  exception when foreign_key_violation then
    -- Some record must keep this person: lock the account instead.
    update public.profiles set is_active = false, approved = false, requested_sub_department = null, requested_at = null where id = p_user;
    update auth.users set banned_until = 'infinity' where id = p_user;
    return 'disabled';
  end;
end $$;
grant execute on function public.delete_org_member(uuid) to authenticated;

notify pgrst, 'reload schema';
