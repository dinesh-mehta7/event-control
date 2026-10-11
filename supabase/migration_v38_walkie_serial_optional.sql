-- Walkie serial numbers are no longer collected or displayed by the app.
-- Existing values remain in the database for legacy records; new walkies may omit them.

alter table public.walkies alter column serial drop not null;
alter table public.walkies drop constraint if exists walkies_serial_key;
drop index if exists public.walkies_org_serial_uidx;

select pg_notify('pgrst', 'reload schema');
