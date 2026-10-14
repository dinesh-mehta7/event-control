-- Associate issued Wi-Fi access with an event so event usage can be reported.
-- Run after migration_v73_event_linked_reports.sql.

alter table public.wifi_access_accounts
  add column if not exists event_id text;

create index if not exists wifi_access_event_usage_idx
  on public.wifi_access_accounts (organization_id, event_id, created_at desc);

create or replace function public.wifi_access_account_validate_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_organization_id text;
begin
  if new.event_id is null then return new; end if;
  select organization_id into event_organization_id
  from public.event_plans where id = new.event_id;
  if event_organization_id is distinct from new.organization_id then
    raise exception 'Choose an event in this organization.';
  end if;
  return new;
end $$;

drop trigger if exists wifi_access_account_validate_event on public.wifi_access_accounts;
create trigger wifi_access_account_validate_event
  before insert or update of event_id, organization_id on public.wifi_access_accounts
  for each row execute function public.wifi_access_account_validate_event();

notify pgrst, 'reload schema';
