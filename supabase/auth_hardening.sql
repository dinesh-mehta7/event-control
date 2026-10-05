-- ============================================================================
-- RadioGate — Auth hardening & upgrade
-- ============================================================================
-- Run this AFTER schema.sql (safe to re-run). It upgrades the existing
-- profiles/auth setup to support:
--   - Real sign up (no more hardcoded demo accounts)
--   - Forgot password / reset password
--   - Email verification
--   - Admin-managed users (assign roles, disable access)
--   - Closes a privilege-escalation hole in the original schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add an is_active flag so Admins can revoke access without needing the
--    Supabase service_role key (which the frontend never has access to).
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- ----------------------------------------------------------------------------
-- 2. SECURITY FIX: the original handle_new_user() trusted
--    raw_user_meta_data->>'role' from the SIGN-UP CALL ITSELF. Since that
--    metadata is sent by the browser, anyone could have signed up with
--    { data: { role: 'Admin' } } and granted themselves full access.
--
--    New behaviour: every self-service sign-up becomes 'Client' (read-only)
--    no matter what metadata is sent. Admins promote people afterwards from
--    the Users screen in the app.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'Client', -- always the lowest-privilege role; ignore any client-sent role
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. SECURITY FIX: the original "profiles_update_self" policy let a signed-in
--    user update their OWN row with no restriction on which columns changed —
--    including role and (now) is_active. That means any user could run
--    `update profiles set role = 'Admin' where id = auth.uid()` from the
--    browser console and grant themselves admin. This trigger blocks that:
--    only an existing Admin may change someone's role or is_active flag.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and public.current_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change a user''s role or active status.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_escalation on public.profiles;
create trigger trg_prevent_self_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_self_role_escalation();

-- ----------------------------------------------------------------------------
-- 4. Admins can update ANY profile (needed for the Users screen: changing
--    role / is_active for other people). Combined with the trigger above,
--    non-admins still can't use this to touch role/is_active on themselves.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update
  using (public.current_role() = 'Admin');

-- Admins can remove a profile row (e.g. after deleting the auth user from the
-- Supabase dashboard). This does NOT delete the underlying auth.users row —
-- that requires the service_role key, which never lives in the frontend.
drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles for delete
  using (public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 5. Every write policy across the app should also require an active account.
--    A disabled user keeps read access revoked too — updated select policy.
-- ----------------------------------------------------------------------------
create or replace function public.current_is_active()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (auth.uid() is not null);

drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "walkies_select" on public.walkies;
create policy "walkies_select" on public.walkies for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "allocations_select" on public.allocations;
create policy "allocations_select" on public.allocations for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "maintenance_select" on public.maintenance;
create policy "maintenance_select" on public.maintenance for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "history_select" on public.history;
create policy "history_select" on public.history for select
  using (auth.uid() is not null and public.current_is_active());

-- ============================================================================
-- Done. Two things left to configure in the Supabase Dashboard (not SQL):
--
-- 1. Authentication -> URL Configuration -> add your app's URL (e.g.
--    http://localhost:3000 for local dev, or your deployed URL) to
--    Redirect URLs, so the "forgot password" email link works. The app
--    redirects back to the site root and reads the recovery token from the
--    URL hash, so no extra path needs to be whitelisted.
--
-- 2. Authentication -> Providers -> Email -> decide whether "Confirm email"
--    is ON (recommended for production — new users must click a verification
--    link before they can sign in) or OFF (fine for internal/trusted teams).
-- ============================================================================
