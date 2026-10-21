-- ============================================================================
-- v109 · Only the department that approved a request can order for it
-- ----------------------------------------------------------------------------
-- A request is approved by the department it was made to (or by the Super Admin after escalation).
-- Purchase orders for it — from "Create purchase order" on the request or from the buy list — can
-- now be created only by that department's people (its head / Purchase team) or the Super Admin.
-- Checked on every order and order line that carries a request, whichever function creates it.
-- Apply after migration_v108_request_department_for_approvals.sql. Safe to re-run.
-- ============================================================================

create or replace function public._order_by_approving_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dept text; v_name text;
begin
  if auth.uid() is null or new.request_id is null then return new; end if;
  select coalesce(r.department_id, public._it_department(r.organization_id)) into v_dept
    from public.requests r where r.id = new.request_id;
  if v_dept is not null and not public.in_my_department(v_dept) then
    select name into v_name from public.departments where id = v_dept;
    raise exception 'Only % (the department that approved this request) can order it.', coalesce(v_name, 'the requested department');
  end if;
  return new;
end $$;

drop trigger if exists order_by_approving_department on public.purchase_orders;
create trigger order_by_approving_department before insert on public.purchase_orders
  for each row execute function public._order_by_approving_department();
drop trigger if exists order_by_approving_department on public.purchase_items;
create trigger order_by_approving_department before insert on public.purchase_items
  for each row execute function public._order_by_approving_department();

notify pgrst, 'reload schema';
