import { useEffect, useState } from 'react';
import { supabase } from '../../walkie/lib/supabaseClient';
import type { Req } from '../types';

export interface DeliveryTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'complete' | string;
  team: string;
  assignedTo: string;
  fulfilmentId: string;
}

let deliveryTaskSubscriptionId = 0;
export const TASK_STATUS: Record<string, [string, string]> = {
  todo: ['To do', 'bg-raised text-ink-soft'],
  in_progress: ['In progress', 'bg-amber-500/15 text-amber-300'],
  complete: ['Complete', 'bg-emerald-500/15 text-emerald-300'],
};

// The Team-tasks delivery tasks linked to this request's parts (one per part), kept live.
export function useDeliveryTasks(r: Req): Record<string, DeliveryTask> {
  const [tasks, setTasks] = useState<Record<string, DeliveryTask>>({});
  const ids = r.parts.map(p => p.id);
  const key = ids.join(',');
  useEffect(() => {
    if (!ids.length) {
      setTasks({});
      return;
    }
    let on = true;
    const load = async () => {
      const { data } = await supabase
        .from('manpower_tasks')
        .select('id,title,status,team,assigned_to,request_fulfilment_id')
        .in('request_fulfilment_id', ids);
      if (!on) return;
      const out: Record<string, DeliveryTask> = {};
      (data || []).forEach((t: any) => {
        out[t.request_fulfilment_id] = {
          id: t.id,
          title: t.title,
          status: t.status,
          team: t.team || '',
          assignedTo: t.assigned_to || '',
          fulfilmentId: t.request_fulfilment_id,
        };
      });
      setTasks(out);
    };
    void load();
    // Cleanup removes channels asynchronously. A refreshed request can mount a
    // new effect before that removal finishes, so each subscription needs its
    // own topic instead of reusing the request ID alone.
    const ch = supabase
      .channel(`request-tasks-${r.id}-${++deliveryTaskSubscriptionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manpower_tasks' }, () => void load())
      .subscribe();
    return () => {
      on = false;
      supabase.removeChannel(ch);
    };
  }, [r.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return tasks;
}
