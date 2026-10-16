-- Add an Accounts department and secure offline vendor/payment records.
alter table public.profiles drop constraint if exists profiles_sub_department_check;
alter table public.profiles add constraint profiles_sub_department_check
  check (sub_department is null or sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

alter table public.profiles drop constraint if exists profiles_requested_sub_department_check;
alter table public.profiles add constraint profiles_requested_sub_department_check
  check (requested_sub_department is null or requested_sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

alter table public.department_codes drop constraint if exists department_codes_sub_department_check;
alter table public.department_codes add constraint department_codes_sub_department_check
  check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

create or replace function public.make_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare prefix text; c text; tries int := 0;
begin
  prefix := case p_sub when 'cctv' then 'CCTV' when 'wifi' then 'WIFI' when 'walkie' then 'WALK'
            when 'control' then 'CTRL' when 'inventory' then 'INVT' when 'purchase' then 'PURC'
            when 'accounts' then 'ACCT' when 'accommodation' then 'ACCO' else 'MANP' end;
  loop
    c := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_sub), 1, 6));
    exit when not exists (select 1 from public.department_codes where code = c);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return c;
end $$;

create or replace function public.ensure_department_codes(p_org text)
returns void language plpgsql security definer set search_path = public as $$
declare s text;
begin
  foreach s in array array['cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'] loop
    insert into public.department_codes (organization_id, sub_department, code)
    values (p_org, s, public.make_department_code(s))
    on conflict (organization_id, sub_department) do nothing;
  end loop;
end $$;

insert into public.department_codes (organization_id, sub_department, code)
select o.id, 'accounts', public.make_department_code('accounts')
from public.organizations o
on conflict (organization_id, sub_department) do nothing;

-- Accounts can review order, vendor, and payment context, while write access
-- remains with Purchase and the payment RPC below remains Accounts-only.
create or replace function public.can_view_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department in ('purchase','inventory','accounts'))
                   from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "purchase_payment_requests_select" on public.purchase_payment_requests;
create policy "purchase_payment_requests_select" on public.purchase_payment_requests for select
  using (organization_id = public.current_organization_id() and (public.can_manage_purchase() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
  )));

drop policy if exists "purchase_payments_select" on public.purchase_payments;
create policy "purchase_payments_select" on public.purchase_payments for select
  using (organization_id = public.current_organization_id() and (public.can_manage_purchase() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
  )));

alter table public.purchase_vendors add column if not exists account_holder text not null default '';
alter table public.purchase_vendors add column if not exists bank_name text not null default '';
alter table public.purchase_vendors add column if not exists account_number text not null default '';
alter table public.purchase_vendors add column if not exists ifsc_code text not null default '';
alter table public.purchase_vendors add column if not exists bank_branch text not null default '';
alter table public.purchase_vendors add column if not exists upi_id text not null default '';
alter table public.purchase_vendors drop constraint if exists purchase_vendors_offline_bank_details_check;
alter table public.purchase_vendors add constraint purchase_vendors_offline_bank_details_check check (
  vendor_mode is distinct from 'offline' or (
    length(trim(contact_person)) > 0 and length(trim(phone)) > 0 and length(trim(address)) > 0
    and length(trim(account_holder)) > 0 and length(trim(bank_name)) > 0 and length(trim(account_number)) > 0
    and length(trim(ifsc_code)) > 0 and length(trim(bank_branch)) > 0
  )
) not valid;

alter table public.purchase_payments add column if not exists bill_path text;
alter table public.purchase_payments add column if not exists proof_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-payment-documents', 'purchase-payment-documents', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "purchase_payment_docs_read" on storage.objects;
create policy "purchase_payment_docs_read" on storage.objects for select to authenticated
using (
  bucket_id = 'purchase-payment-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved and p.is_active
      and p.organization_id::text = (storage.foldername(name))[1]
      and (p.level in ('owner','dept_head') or p.sub_department in ('purchase','accounts'))
  )
);
drop policy if exists "purchase_payment_docs_accounts_insert" on storage.objects;
create policy "purchase_payment_docs_accounts_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'purchase-payment-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
      and p.organization_id::text = (storage.foldername(name))[1]
  )
);
drop policy if exists "purchase_payment_docs_accounts_delete" on storage.objects;
create policy "purchase_payment_docs_accounts_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'purchase-payment-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
      and p.organization_id::text = (storage.foldername(name))[1]
  )
);

drop function if exists public.payment_request_pay(text, text, text, text, text);
create or replace function public.payment_request_pay(
  p_id text, p_mode text, p_ref text, p_paid_by text, p_note text, p_bill_path text default null, p_proof_path text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; po record; pay_id text; org_prefix text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level = 'owner' or me.sub_department is distinct from 'accounts' then
    raise exception 'Only the Accounts team can make a payment.';
  end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'approved' then raise exception 'This payment is not approved yet.'; end if;
  org_prefix := me.organization_id::text || '/' || p_id || '/';
  if (p_bill_path is not null and p_bill_path not like org_prefix || '%') or (p_proof_path is not null and p_proof_path not like org_prefix || '%') then
    raise exception 'Payment attachments must belong to this organization and request.';
  end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  perform set_config('app.pay_internal', '1', true);
  insert into public.purchase_payments (id, organization_id, po_id, amount, mode, ref, paid_by, note, bill_path, proof_path)
  values (pay_id, pr.organization_id, pr.po_id, pr.amount, coalesce(nullif(trim(p_mode), ''), 'bank'), trim(coalesce(p_ref, '')),
          coalesce(nullif(trim(p_paid_by), ''), me.name), trim(coalesce(p_note, '')), p_bill_path, p_proof_path);
  perform set_config('app.pay_internal', '', true);
  update public.purchase_payment_requests set status = 'paid', payment_id = pay_id, paid_at = now() where id = p_id;
  perform public._org_notify(pr.organization_id, 'owner', 'Payment made: ' || po.po_number, 'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || ' paid by ' || me.name, 'info', 'requests/payments', pr.id);
end $$;
revoke all on function public.payment_request_pay(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.payment_request_pay(text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
