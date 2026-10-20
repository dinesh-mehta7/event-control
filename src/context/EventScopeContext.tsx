import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { supabase } from '../modules/walkie/lib/supabaseClient';

export type EventScope = {
  id: string;
  name: string;
  starts_at: string;
  ends_at?: string | null;
  status?: string;
  staffing_days_before?: number;
  staffing_days_after?: number;
  event_type?: 'monthly' | 'annual' | 'special';
  special_member_ids?: string[];
};
type ScopeContextValue = {
  events: EventScope[];
  loading: boolean;
  scopeFor: (module: string) => string;
  setScopeFor: (module: string, eventId: string) => void;
  refreshEvents: () => Promise<void>;
};
const EventScopeContext = createContext<ScopeContextValue | null>(null);
const storageKey = (organizationId: string) => `event_scope:${organizationId}`;
let publishedScopes: Record<string, string> = {};
const scopeListeners = new Set<() => void>();
const publishScopes = (next: Record<string, string>) => {
  publishedScopes = next;
  scopeListeners.forEach(listener => listener());
};
const subscribeScopes = (listener: () => void) => {
  scopeListeners.add(listener);
  return () => scopeListeners.delete(listener);
};
export const useModuleEventScope = (module: string) =>
  useSyncExternalStore(
    subscribeScopes,
    () => publishedScopes[module] || '',
    () => '',
  );

export const EventScopeProvider: React.FC<{
  children: React.ReactNode;
  organizationId?: string;
  approved?: boolean;
}> = ({ children, organizationId, approved }) => {
  const [events, setEvents] = useState<EventScope[]>([]);
  const [loading, setLoading] = useState(false);
  const [scopes, setScopes] = useState<Record<string, string>>({});

  const refreshEvents = useCallback(async () => {
    if (!organizationId || !approved) {
      setEvents([]);
      return;
    }
    const { data, error } = await supabase
      .from('event_plans')
      .select('id,name,starts_at,ends_at,status,event_type,special_member_ids,staffing_days_before,staffing_days_after')
      .eq('organization_id', organizationId)
      .neq('status', 'cancelled')
      .order('starts_at', { ascending: false });
    if (!error) setEvents((data || []) as EventScope[]);
  }, [organizationId, approved]);

  useEffect(() => {
    if (!organizationId || !approved) {
      setEvents([]);
      setScopes({});
      publishScopes({});
      return;
    }
    let saved: Record<string, string> = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey(organizationId)) || '{}');
    } catch {
      /* use Normal scope */
    }
    setScopes(saved);
    publishScopes(saved);
    let active = true;
    setLoading(true);
    void refreshEvents().finally(() => {
      if (active) setLoading(false);
    });
    const channel = supabase
      .channel(`event-scope-${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_plans', filter: `organization_id=eq.${organizationId}` },
        () => {
          void refreshEvents();
        },
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [organizationId, approved, refreshEvents]);

  const scopeFor = useCallback((module: string) => scopes[module] || '', [scopes]);
  const setScopeFor = useCallback(
    (module: string, eventId: string) => {
      const next = { ...scopes, [module]: eventId };
      setScopes(next);
      publishScopes(next);
      try {
        if (organizationId) localStorage.setItem(storageKey(organizationId), JSON.stringify(next));
      } catch {
        /* storage may be disabled */
      }
    },
    [organizationId, scopes],
  );
  const value = useMemo(
    () => ({ events, loading, scopeFor, setScopeFor, refreshEvents }),
    [events, loading, scopeFor, setScopeFor, refreshEvents],
  );
  return <EventScopeContext.Provider value={value}>{children}</EventScopeContext.Provider>;
};

export const useEventScope = () => {
  const value = useContext(EventScopeContext);
  if (!value) throw new Error('useEventScope must be used inside <EventScopeProvider>');
  return value;
};
