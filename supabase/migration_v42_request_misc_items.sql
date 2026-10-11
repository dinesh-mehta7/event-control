-- Save the IT Department Head's optional miscellaneous item description with
-- the existing miscellaneous addition amount.
-- Apply after migration_v41_request_routing_to_it_admin.sql.

alter table public.requests
  add column if not exists review_misc_items text not null default '';

do $$
declare
  fn text := 'public.request_it_decide(text,text,text,jsonb)';
  def text;
  updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(
    def,
    $old$update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0) where id=p_id;$old$,
    $new$update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0), review_misc_items=left(trim(coalesce(p_lines->0->>'misc_items','')),300) where id=p_id;$new$
  );
  if updated = def then
    raise exception 'Could not update request_it_decide to save miscellaneous items.';
  end if;
  execute updated;
end $$;

select pg_notify('pgrst','reload schema');
