-- ============================================================================
-- v93 · Sign-up can only JOIN an existing organization (no new organizations)
-- ----------------------------------------------------------------------------
-- Before: a sign-up with org_mode = 'create' made a brand-new organization and an
-- approved owner. The app no longer offers that, and this closes it in the database
-- too, so nobody can create an organization by calling the sign-up API directly.
--
-- Now every sign-up must carry a valid join code (department code, or the old
-- organization code). The new person lands in that organization as an unapproved
-- 'Client' and the Organization Head approves them, exactly as before.
-- Safe to re-run.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_mode text; meta_code text; meta_name text;
  found_org_id text; found_sub text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  meta_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  if meta_mode = 'create' then
    raise exception 'New organizations cannot be created. Ask your department head for a join code.';
  end if;

  select organization_id, sub_department into found_org_id, found_sub
    from public.department_codes where code = meta_code;
  if found_org_id is null then
    select id into found_org_id from public.organizations where join_code = meta_code;  -- old organization code still works
    found_sub := null;
  end if;
  if found_org_id is null then
    raise exception 'That department code doesn''t match any department. Check it with your department head.';
  end if;

  insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level, requested_sub_department, requested_at)
  values (new.id, meta_name, new.email, 'Client', true, found_org_id, false, 'other', found_sub, now())
  on conflict (id) do nothing;

  perform public.notify_owners(found_org_id, 'New access request',
    meta_name || ' wants to join' || coalesce(' ' || found_sub || ' department', '') || '. Approve or reject in Users & Access.',
    'approval', 'users', new.id::text);
  return new;
end $$;
