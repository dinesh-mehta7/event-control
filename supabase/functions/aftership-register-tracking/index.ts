import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const afterShipKey = Deno.env.get('AFTERSHIP_API_KEY');
  if (!url || !anon || !serviceKey) return json({ error: 'Order tracking is not configured on this Supabase project.' }, 503);
  const bearer = req.headers.get('Authorization');
  if (!bearer) return json({ error: 'Sign in first.' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: bearer } }, auth: { persistSession: false } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401);
  const { data: profile } = await userClient.from('profiles').select('organization_id,level,sub_department,approved,is_active').eq('id', user.id).maybeSingle();
  if (!profile?.approved || !profile.is_active || !(profile.level === 'owner' || profile.level === 'dept_head' || profile.sub_department === 'purchase')) return json({ error: 'Only Purchase, Department Admin, or Super Admin can add shipment tracking.' }, 403);

  const input = await req.json().catch(() => null);
  const poId = String(input?.po_id || '');
  const purchaseItemId = String(input?.purchase_item_id || '');
  const vendorId = String(input?.vendor_id || '');
  const trackingNumber = String(input?.tracking_number || '').trim();
  const marketplaceOrderNumber = String(input?.marketplace_order_number || '').trim().slice(0, 120);
  const courierSlug = String(input?.courier_slug || '').trim().slice(0, 120);
  if (!poId || !purchaseItemId || !vendorId || (!trackingNumber && !marketplaceOrderNumber)) return json({ error: 'Enter a marketplace order ID, a courier AWB, or both.' }, 400);
  if (trackingNumber && !afterShipKey) return json({ error: 'Add the AFTERSHIP_API_KEY Supabase function secret to connect live courier updates.' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: order } = await admin.from('purchase_orders').select('id,organization_id,status,vendor_mode,vendor_id').eq('id', poId).eq('organization_id', profile.organization_id).maybeSingle();
  if (!order) return json({ error: 'That purchase order was not found.' }, 404);
  if (order.vendor_mode !== 'online') return json({ error: 'Shipment tracking is only available for online orders.' }, 400);
  if (!['ordered', 'partial', 'received'].includes(order.status)) return json({ error: 'Place the online order before adding shipment tracking.' }, 400);
  if (order.vendor_id !== vendorId) return json({ error: 'Choose the online vendor saved on this purchase order.' }, 400);
  const { data: vendor } = await admin.from('purchase_vendors').select('id,name,vendor_mode').eq('id', vendorId).eq('organization_id', profile.organization_id).maybeSingle();
  if (!vendor || vendor.vendor_mode !== 'online') return json({ error: 'Choose a vendor listed as an online marketplace vendor.' }, 400);
  const { data: item } = await admin.from('purchase_items').select('id,po_id,organization_id').eq('id', purchaseItemId).eq('po_id', poId).eq('organization_id', profile.organization_id).maybeSingle();
  if (!item) return json({ error: 'That order line was not found.' }, 404);

  const { data: existing } = trackingNumber
    ? await admin.from('purchase_trackings').select('id,po_id,purchase_item_id').eq('organization_id', profile.organization_id).eq('tracking_number', trackingNumber).maybeSingle()
    : { data: null };
  if (existing && (existing.po_id !== poId || existing.purchase_item_id !== purchaseItemId)) return json({ error: 'This tracking number is already connected to another order in this organization.' }, 409);
  if (!trackingNumber) {
    const { data: pending, error: pendingError } = await admin.from('purchase_trackings').select('id').eq('organization_id', profile.organization_id).eq('po_id', poId).eq('purchase_item_id', purchaseItemId).eq('marketplace_order_number', marketplaceOrderNumber).eq('tracking_number', '').maybeSingle();
    if (pendingError) return json({ error: 'Could not check the saved marketplace order.' }, 500);
    if (pending) return json({ id: pending.id, alreadySaved: true });
    const { data: saved, error } = await admin.from('purchase_trackings').insert({
      id: `track-${crypto.randomUUID()}`, organization_id: profile.organization_id, po_id: poId, purchase_item_id: purchaseItemId,
      marketplace: vendor.name, marketplace_order_number: marketplaceOrderNumber, tracking_number: '', status: 'Awaiting dispatch',
      sub_status: 'Waiting for courier AWB', updated_at: new Date().toISOString(),
    }).select('id').single();
    if (error) return json({ error: 'Could not save the marketplace order ID.' }, 500);
    return json({ id: saved.id, awaitingDispatch: true });
  }
  if (existing) return json({ id: existing.id, alreadyTracked: true });
  const { data: pending } = marketplaceOrderNumber
    ? await admin.from('purchase_trackings').select('id').eq('organization_id', profile.organization_id).eq('po_id', poId).eq('purchase_item_id', purchaseItemId).eq('marketplace_order_number', marketplaceOrderNumber).eq('tracking_number', '').maybeSingle()
    : { data: null };

  const trackerBody: Record<string, unknown> = {
    tracking_number: trackingNumber,
    slug: courierSlug || undefined,
    order_id: marketplaceOrderNumber || undefined,
    title: `${vendor.name} order`,
  };
  const upstream = await fetch('https://api.aftership.com/tracking/2026-07/trackings', {
    method: 'POST',
    headers: { 'as-api-key': afterShipKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracking: trackerBody }),
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json({ error: result?.meta?.message || result?.meta?.type || 'AfterShip could not create this tracker. Check the tracking number and courier.' }, 502);
  const track = result?.data?.tracking || {};
  if (!track.id) return json({ error: 'AfterShip accepted the request without returning a tracking ID. Check the tracking number or remove its duplicate tracker in AfterShip, then retry.' }, 502);
  const trackingRecord = {
    organization_id: profile.organization_id, po_id: poId, purchase_item_id: purchaseItemId,
    marketplace: vendor.name, marketplace_order_number: marketplaceOrderNumber, tracking_number: trackingNumber,
    courier_slug: track.slug || courierSlug, aftership_id: track.id || '', status: track.tag || 'Pending',
    sub_status: track.subtag_message || '', tracking_url: track.courier_tracking_link || '',
    estimated_delivery: track.expected_delivery || null, checkpoints: track.checkpoints || [], updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = pending
    ? await admin.from('purchase_trackings').update(trackingRecord).eq('id', pending.id).select('id').single()
    : await admin.from('purchase_trackings').insert({ id: `track-${crypto.randomUUID()}`, ...trackingRecord }).select('id').single();
  if (error) return json({ error: 'AfterShip registered the tracking number, but the app could not save it. Try again or contact your administrator.' }, 500);
  return json({ id: saved.id });
});
