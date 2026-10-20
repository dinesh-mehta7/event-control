import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../walkie/lib/supabaseClient';
import { useWalkie } from '../walkie';
import { DEFAULT_SETTINGS } from './types';
import type { Canned, Person, Settings, Status, Ticket, TicketEvent } from './types';

const mapTicket = (r: any): Ticket => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  description: r.description || '',
  status: r.status,
  priority: r.priority,
  category: r.category || 'Other',
  department: r.department || '',
  location: r.location || '',
  requesterId: r.requester_id,
  requesterName: r.requester_name || '',
  requesterEmail: r.requester_email || '',
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name || '',
  dueAt: r.due_at,
  resolution: r.resolution || '',
  firstResponseAt: r.first_response_at,
  closedAt: r.closed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  tasks: Array.isArray(r.tasks) ? r.tasks : [],
  assetItemId: r.asset_item_id || null,
  assetName: r.asset_name || '',
});
const mapEvent = (r: any): TicketEvent => ({
  id: r.id,
  ticketId: r.ticket_id,
  kind: r.kind,
  body: r.body,
  authorId: r.author_id,
  authorName: r.author_name || '',
  createdAt: r.created_at,
  minutes: Number(r.minutes) || 0,
});
const MIGRATION_HINT = ' — run supabase/migration_v87_helpdesk.sql in the Supabase SQL Editor, then reload.';
const SPICEWORKS_HINT =
  ' — run supabase/migration_v89_helpdesk_spiceworks.sql in the Supabase SQL Editor, then reload.';
const explain = (e: any) => {
  const m = e?.message || 'Something went wrong';
  return `${m}${/p_minutes|minutes|tasks|asset_item_id|asset_name|category_rules/i.test(m) ? SPICEWORKS_HINT : /helpdesk|schema cache|does not exist|could not find/i.test(m) ? MIGRATION_HINT : ''}`;
};

export type TicketPatch = Partial<
  Pick<
    Ticket,
    | 'status'
    | 'priority'
    | 'category'
    | 'department'
    | 'location'
    | 'assigneeId'
    | 'dueAt'
    | 'resolution'
    | 'tasks'
    | 'assetItemId'
    | 'assetName'
  >
>;
const toRow = (p: TicketPatch) => {
  const r: Record<string, unknown> = {};
  if (p.status !== undefined) r.status = p.status;
  if (p.priority !== undefined) r.priority = p.priority;
  if (p.category !== undefined) r.category = p.category;
  if (p.department !== undefined) r.department = p.department;
  if (p.location !== undefined) r.location = p.location;
  if (p.assigneeId !== undefined) r.assignee_id = p.assigneeId;
  if (p.dueAt !== undefined) r.due_at = p.dueAt;
  if (p.resolution !== undefined) r.resolution = p.resolution;
  if (p.tasks !== undefined) r.tasks = p.tasks;
  if (p.assetItemId !== undefined) r.asset_item_id = p.assetItemId;
  if (p.assetName !== undefined) r.asset_name = p.assetName;
  return r;
};

// All Helpdesk data and actions. Row-level security decides what each person can see and change.
export function useHelpdesk() {
  const w: any = useWalkie();
  const me = w.currentUser;
  const orgId: string | undefined = me?.organizationId;
  const toast = useCallback(
    (m: string, t: 'success' | 'error' | 'warning' = 'success') => w.addToast?.(m, t),
    [w.addToast],
  );

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [people, setPeople] = useState<Person[]>([]);
  const [canned, setCanned] = useState<Canned[]>([]);
  const [isAgent, setIsAgent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const canConfigure = me?.level === 'owner' || me?.level === 'dept_head';

  const load = useCallback(async () => {
    if (!orgId) return;
    const [agent, t, s, p] = await Promise.all([
      supabase.rpc('helpdesk_is_agent'),
      supabase
        .from('helpdesk_tickets')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase.from('helpdesk_settings').select('*').eq('organization_id', orgId).maybeSingle(),
      supabase
        .from('profiles')
        .select('id,name,email,level')
        .eq('organization_id', orgId)
        .eq('approved', true)
        .order('name'),
    ]);
    const err = agent.error || t.error || s.error;
    setLoadError(err ? explain(err) : '');
    const agentNow = !!agent.data;
    setIsAgent(agentNow);
    setTickets((t.data || []).map(mapTicket));
    if (s.data)
      setSettings({
        slaHours: { ...DEFAULT_SETTINGS.slaHours, ...(s.data.sla_hours || {}) },
        categories: s.data.categories?.length ? s.data.categories : DEFAULT_SETTINGS.categories,
        technicianIds: s.data.technician_ids || [],
        categoryRules: s.data.category_rules || {},
      });
    setPeople((p.data || []).map((r: any) => ({ id: r.id, name: r.name, email: r.email || '', level: r.level || '' })));
    if (agentNow) {
      const c = await supabase.from('helpdesk_canned_replies').select('*').eq('organization_id', orgId).order('title');
      setCanned((c.data || []).map((r: any) => ({ id: r.id, title: r.title, body: r.body })));
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`helpdesk-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'helpdesk_tickets', filter: `organization_id=eq.${orgId}` },
        (p: any) => {
          if (p.eventType === 'DELETE') setTickets(list => list.filter(x => x.id !== p.old.id));
          else
            setTickets(list =>
              [mapTicket(p.new), ...list.filter(x => x.id !== p.new.id)].sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
              ),
            );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [orgId]);

  // Technicians: owners and department heads always, plus anyone listed in settings.
  const technicians = people.filter(
    p => p.level === 'owner' || p.level === 'dept_head' || settings.technicianIds.includes(p.id),
  );

  const refreshTicket = async (id: string) => {
    const { data } = await supabase.from('helpdesk_tickets').select('*').eq('id', id).maybeSingle();
    if (data) setTickets(list => list.map(x => (x.id === id ? mapTicket(data) : x)));
  };

  const submit = async (f: {
    subject: string;
    description: string;
    category: string;
    priority: string;
    department: string;
    location: string;
    requesterName?: string;
    requesterEmail?: string;
  }) => {
    const { data, error } = await supabase.rpc('helpdesk_submit', {
      p_subject: f.subject,
      p_description: f.description,
      p_category: f.category,
      p_priority: f.priority,
      p_department: f.department,
      p_location: f.location,
      p_requester_name: f.requesterName || null,
      p_requester_email: f.requesterEmail || null,
    });
    if (error) {
      toast(explain(error), 'error');
      return null;
    }
    await load();
    const t = (await supabase.from('helpdesk_tickets').select('number').eq('id', data).maybeSingle()).data;
    toast(`Ticket ${t ? `#${t.number} ` : ''}submitted. You can track it here.`);
    return data as string;
  };

  const update = async (ids: string[], patch: TicketPatch, quiet = false) => {
    if (!ids.length) return false;
    const { error } = await supabase.from('helpdesk_tickets').update(toRow(patch)).in('id', ids);
    if (error) {
      toast(explain(error), 'error');
      return false;
    }
    await Promise.all(ids.map(refreshTicket));
    if (!quiet) toast(ids.length > 1 ? `${ids.length} tickets updated.` : 'Ticket updated.');
    return true;
  };

  const post = async (ticketId: string, kind: 'reply' | 'note', body: string, reopen = false, minutes = 0) => {
    // Time spent needs migration_v89; without minutes the call also works on the v87 function.
    const args: Record<string, unknown> = { p_ticket: ticketId, p_kind: kind, p_body: body, p_reopen: reopen };
    if (minutes > 0) args.p_minutes = minutes;
    const { error } = await supabase.rpc('helpdesk_post', args);
    if (error) {
      toast(explain(error), 'error');
      return false;
    }
    await refreshTicket(ticketId);
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('helpdesk_tickets').delete().eq('id', id);
    if (error) {
      toast(explain(error), 'error');
      return false;
    }
    setTickets(list => list.filter(x => x.id !== id));
    toast('Ticket deleted.');
    return true;
  };

  const fetchEvents = async (ticketId: string) => {
    const { data, error } = await supabase
      .from('helpdesk_ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at');
    if (error) {
      toast(explain(error), 'error');
      return [];
    }
    return (data || []).map(mapEvent);
  };

  const saveSettings = async (s: Settings) => {
    const { error } = await supabase.from('helpdesk_settings').upsert({
      organization_id: orgId,
      sla_hours: s.slaHours,
      categories: s.categories,
      technician_ids: s.technicianIds,
      category_rules: s.categoryRules,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast(explain(error), 'error');
      return false;
    }
    setSettings(s);
    toast('Helpdesk settings saved.');
    await load();
    return true;
  };
  const saveCanned = async (c: { id?: string; title: string; body: string }) => {
    const q = c.id
      ? supabase.from('helpdesk_canned_replies').update({ title: c.title, body: c.body }).eq('id', c.id)
      : supabase.from('helpdesk_canned_replies').insert({ organization_id: orgId, title: c.title, body: c.body });
    const { error } = await q;
    if (error) {
      toast(explain(error), 'error');
      return false;
    }
    await load();
    return true;
  };
  const deleteCanned = async (id: string) => {
    const { error } = await supabase.from('helpdesk_canned_replies').delete().eq('id', id);
    if (error) {
      toast(explain(error), 'error');
      return;
    }
    setCanned(list => list.filter(c => c.id !== id));
  };

  return {
    me,
    orgId,
    tickets,
    settings,
    people,
    technicians,
    canned,
    isAgent,
    canConfigure,
    loading,
    loadError,
    load,
    submit,
    update,
    post,
    remove,
    fetchEvents,
    saveSettings,
    saveCanned,
    deleteCanned,
    setStatus: (ids: string[], status: Status) => update(ids, { status }),
  };
}
export type Helpdesk = ReturnType<typeof useHelpdesk>;
