-- The IT Department Head must explicitly confirm each approved item's stock
-- quantity (including zero) before approving or escalating the saved plan.
-- Apply after migration_v43_fix_cross_department_request_review.sql.

do $$
declare
  fn text := 'public.request_it_decide(text,text,text,jsonb)';
  def text;
  old_def text := $old$if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;$old$;
  new_def text := $new$if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    join public.request_items i on i.id=line.value->>'id' and i.request_id=p_id
    where i.kind='item'
      and coalesce((line.value->>'approved_qty')::integer,0)>0
      and not coalesce((line.value->>'arrangement_confirmed')::boolean,false)
  ) then raise exception 'Confirm the stock quantity for each approved item. Enter zero when none will come from stock.'; end if;$new$;
  updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def, old_def, new_def);
  if updated = def then
    raise exception 'Could not add the arrangement confirmation requirement to request_it_decide.';
  end if;
  execute updated;
end $$;

select pg_notify('pgrst','reload schema');
