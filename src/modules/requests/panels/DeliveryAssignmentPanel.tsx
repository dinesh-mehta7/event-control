import React, { useEffect, useState } from 'react';
import { Card, Field, btnPrimary, inputCls } from '../../../components/ui';
import { useManpower } from '../../manpower';
import { useRequests } from '../RequestsContext';
import type { Req } from '../types';
import { Err } from './shared';
import { TASK_STATUS, useDeliveryTasks } from './useDeliveryTasks';
import { Select } from '../../../components/Select';

// After final approval, IT assigns the handover to a team or an IT Sewadar.
export const DeliveryAssignmentPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { assignDelivery } = useRequests();
  const manpower = useManpower();
  const tasks = useDeliveryTasks(r);
  const itSewadars = manpower.sewadars.filter(person => person.department.toLowerCase().includes('it'));
  const [target, setTarget] = useState(() =>
    r.deliveryMemberId ? `member:${r.deliveryMemberId}` : r.deliveryTeam ? `team:${r.deliveryTeam}` : '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setTarget(r.deliveryMemberId ? `member:${r.deliveryMemberId}` : r.deliveryTeam ? `team:${r.deliveryTeam}` : '');
  }, [r.id, r.deliveryMemberId, r.deliveryTeam]);
  const save = async () => {
    if (!target) return setErr('Choose a team or IT Sewadar for the delivery task.');
    setBusy(true);
    setErr('');
    const delivery = target.startsWith('team:')
      ? { team: target.slice(5), memberId: '' }
      : { team: '', memberId: target.slice(7) };
    const e = await assignDelivery(r.id, delivery);
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Card title="Assign delivery task" tone="text-emerald-300">
      <p className="mb-3 text-sm text-mute">
        The assigned team gets one task per item on Team tasks. Completing the task there hands the item over here.
        Stock items get their task now; bought items when they reach the store.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Delivery team or IT Sewadar" className="min-w-[240px] flex-1">
          <Select className={inputCls} value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">Choose an assignee</option>
            {manpower.teams.length > 0 && (
              <optgroup label="Teams">
                {manpower.teams.map(team => (
                  <option key={team.id} value={`team:${team.name}`}>
                    {team.name}
                  </option>
                ))}
              </optgroup>
            )}
            {itSewadars.length > 0 && (
              <optgroup label="IT Sewadars">
                {itSewadars.map(person => (
                  <option key={person.id} value={`member:${person.id}`}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <button type="button" className={btnPrimary} disabled={busy || !target} onClick={save}>
          {busy ? 'Assigning…' : r.deliveryTeam || r.deliveryMemberId ? 'Update assignment' : 'Assign delivery task'}
        </button>
      </div>
      <div className="mt-2">
        <Err msg={err} />
      </div>
      {/* One delivery task per part on Team tasks; completing it there hands the part over here. */}
      {(r.deliveryTeam || r.deliveryMemberId) && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {r.parts.map(part => {
            const item = r.items.find(i => i.id === part.itemId);
            const task = tasks[part.id];
            const [label, tone] = task ? TASK_STATUS[task.status] || [task.status, 'bg-raised text-mute'] : ['', ''];
            return (
              <li key={part.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs">
                <span className="min-w-0">
                  <span className="font-medium text-ink">{item?.name || 'Item'}</span>
                  <span className="text-mute">
                    {' '}
                    · {part.qty} {item?.unit}
                  </span>
                </span>
                {task ? (
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${tone}`}>{label}</span>
                    <span className="text-mute">{task.assignedTo || task.team}</span>
                    <a href="#/tasks" className="font-medium text-blue-300 hover:underline">
                      Open task
                    </a>
                  </span>
                ) : part.status === 'done' ? (
                  <span className="text-emerald-300">Handed over</span>
                ) : (
                  <span className="text-mute">
                    {part.source === 'purchase'
                      ? 'Task is created when it arrives at the store'
                      : 'Task not created yet — press Update assignment'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
