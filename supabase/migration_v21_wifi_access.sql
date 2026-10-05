-- Wi-Fi credentials and their issue/expiry register. Run after migration_v20.
-- Passwords are only exposed to owner/IT/Wi-Fi managers and the named recipient.

create or replace function public.can_manage_wifi_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department = 'wifi')
    from public.profiles where id = auth.uid()), false);
$$;

create table if not exists public.wifi_access_accounts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  network_name text not null,
  access_point text not null default '',
  login_id text not null,
  login_password text not null,
  recipient_name text not null,
  recipient_email text not null default '',
  department text not null default '',
  valid_until date,
  notes text not null default '',
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wifi_access_org_expiry_idx on public.wifi_access_accounts (organization_id, status, valid_until);
alter table public.wifi_access_accounts enable row level security;

drop policy if exists "wifi_access_select" on public.wifi_access_accounts;
create policy "wifi_access_select" on public.wifi_access_accounts for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
    and (public.can_manage_wifi_access() or lower(recipient_email) = lower(coalesce(auth.jwt()->>'email',''))));
drop policy if exists "wifi_access_insert" on public.wifi_access_accounts;
create policy "wifi_access_insert" on public.wifi_access_accounts for insert
  with check (public.can_manage_wifi_access() and organization_id = public.current_organization_id());
drop policy if exists "wifi_access_update" on public.wifi_access_accounts;
create policy "wifi_access_update" on public.wifi_access_accounts for update
  using (public.can_manage_wifi_access() and organization_id = public.current_organization_id())
  with check (public.can_manage_wifi_access() and organization_id = public.current_organization_id());
drop policy if exists "wifi_access_delete" on public.wifi_access_accounts;
create policy "wifi_access_delete" on public.wifi_access_accounts for delete
  using (public.can_manage_wifi_access() and organization_id = public.current_organization_id());

notify pgrst, 'reload schema';
