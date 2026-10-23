import React, { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { inputCls } from '../../accommodation/ui';
import { supabase } from '../../walkie/lib/supabaseClient';
import { useWalkie } from '../../walkie';
import { useEventScope } from '../../../context/EventScopeContext';
import { D, ViewHeader, cx } from '../ui/kit';
import { EmptyRow, Sheet, num, rowHover, sheetHead, sheetTable, td, th } from '../ui/sheet';
import type { Tone } from '../ui/kit';
import { Select } from '../../../components/Select';

const STATUSES = ['requested', 'in_progress', 'ready', 'not_needed'];
const STATUS_TONE: Record<string, Tone> = { requested: 'warn', in_progress: 'info', ready: 'ok', not_needed: 'mute' };
const label = (s: string) => s.replace('_', ' ');

export const EventRequirementsView: React.FC = () => {
  const { currentUser } = useWalkie() as any;
  const eventScope = useEventScope();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const orgId = currentUser?.organizationId;
  const events = eventScope.events || [];
  const reload = async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('event_requirements')
      .select('*')
      .eq('organization_id', orgId)
      .eq('category', 'inventory')
      .order('created_at', { ascending: false });
    if (queryError) setError(queryError.message);
    else {
      setRows(data || []);
      setError('');
    }
    setLoading(false);
  };
  useEffect(() => {
    void reload();
  }, [orgId]); // eslint-disable-line
  const updateStatus = async (row: any, status: string) => {
    setBusyId(row.id);
    setError('');
    const { error: updateError } = await supabase
      .from('event_requirements')
      .update({ status })
      .eq('id', row.id)
      .eq('organization_id', orgId);
    if (updateError) setError(updateError.message);
    else setRows(old => old.map(item => (item.id === row.id ? { ...item, status } : item)));
    setBusyId('');
  };
  const visible = rows.filter(row => eventFilter === 'all' || row.event_id === eventFilter);
  const counts = STATUSES.map(s => [s, visible.filter(r => r.status === s).length] as const);

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Event requirements"
        hint="A shared list from Event Planning. Status changes here appear on the event requirement record."
      >
        <Select
          aria-label="Event"
          className={cx(inputCls(D), 'h-9 w-auto !py-1.5 text-xs')}
          value={eventFilter}
          onChange={e => setEventFilter(e.target.value)}
        >
          <option value="all">All events</option>
          {events.map((event: any) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </Select>
      </ViewHeader>
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      <Sheet
        title="Published inventory requirements"
        count={visible.length}
        tools={
          !loading && visible.length > 0 ? (
            <span className="flex flex-wrap gap-x-3 text-[11px] text-mute">
              {counts.map(([st, n]) => (
                <span key={st} className="capitalize">
                  {label(st)} <b className="tabular-nums text-ink">{n}</b>
                </span>
              ))}
            </span>
          ) : undefined
        }
      >
        <table className={cx(sheetTable, 'min-w-[1100px]')}>
          <thead className={sheetHead}>
            <tr>
              <th className={cx(th, 'w-10 text-right')}>#</th>
              <th className={th}>Event</th>
              <th className={th}>Requirement</th>
              <th className={th}>Responsible unit</th>
              <th className={cx(th, 'text-right')}>Qty</th>
              <th className={th}>Unit</th>
              <th className={th}>From department</th>
              <th className={th}>From location</th>
              <th className={th}>Notes</th>
              <th className={cx(th, 'w-36')}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <EmptyRow cols={10}>Loading event requirements…</EmptyRow>
            ) : !visible.length ? (
              <EmptyRow cols={10}>No inventory requirements have been published for this event.</EmptyRow>
            ) : (
              visible.map((row, n) => {
                const event = events.find((item: any) => item.id === row.event_id);
                return (
                  <tr key={row.id} className={rowHover}>
                    <td className={cx(td, num, 'text-faint')}>{n + 1}</td>
                    <td className={cx(td, 'text-ink-soft')}>{event?.name || 'Event'}</td>
                    <td className={cx(td, 'max-w-[240px] truncate font-medium text-ink')} title={row.title}>
                      {row.title}
                    </td>
                    <td className={cx(td, 'text-ink-soft')}>{row.department_name || '—'}</td>
                    <td className={cx(td, num, 'font-semibold text-ink')}>{row.quantity}</td>
                    <td className={cx(td, 'text-mute')}>{row.unit || '—'}</td>
                    <td className={cx(td, 'text-ink-soft')}>{row.collect_from_department || '—'}</td>
                    <td className={cx(td, 'text-ink-soft')}>
                      {row.collect_from_location || (!row.collect_from_department && row.collect_from) || '—'}
                    </td>
                    <td className={cx(td, 'max-w-[220px] truncate text-mute')} title={row.notes}>
                      {row.notes || '—'}
                    </td>
                    <td className={cx(td, 'py-0.5')}>
                      <Select
                        aria-label={`Inventory requirement status for ${row.title}`}
                        className="h-7 w-full rounded border border-line bg-field px-1.5 text-[11.5px] capitalize text-ink outline-none focus:border-blue-500"
                        disabled={busyId === row.id}
                        value={row.status}
                        onChange={e => void updateStatus(row, e.target.value)}
                      >
                        {STATUSES.map(status => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Sheet>
    </div>
  );
};
