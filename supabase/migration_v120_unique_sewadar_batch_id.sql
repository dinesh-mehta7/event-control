-- A Sewadar's Batch ID is unique within the organization. Blank IDs remain optional.
-- Existing duplicate IDs must be corrected before this migration can be applied.
do $$
declare
  duplicate_ids text;
begin
  select string_agg(format('%s: %s', batch_id, member_list), '; ')
    into duplicate_ids
  from (
    select lower(btrim(batch_no)) as batch_id,
           string_agg(format('%s [id %s]', name, id), ', ' order by created_at) as member_list
    from public.accommodation_members
    where btrim(coalesce(batch_no, '')) <> ''
    group by organization_id, lower(btrim(batch_no))
    having count(*) > 1
    order by lower(btrim(batch_no))
    limit 20
  ) duplicates;

  if duplicate_ids is not null then
    raise exception 'Cannot enforce unique Sewadar Batch IDs until existing duplicates are corrected: %', duplicate_ids;
  end if;
end $$;

create unique index if not exists accommodation_members_org_batch_uidx
  on public.accommodation_members (organization_id, lower(btrim(batch_no)))
  where btrim(coalesce(batch_no, '')) <> '';

notify pgrst, 'reload schema';
