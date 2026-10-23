import React, { useEffect, useState } from 'react';
import { Card, Field, btnPrimary, inputCls } from '../../../components/ui';
import { useManpower } from '../../manpower';
import { useRequests } from '../RequestsContext';
import type { Req } from '../types';
import { Err } from './shared';
import { Select } from '../../../components/Select';

// After final approval, IT assigns the handover to a team or an IT Sewadar.
export const DeliveryAssignmentPanel: React.FC<{ r: Req }> = ({ r }) => {
  const { assignDelivery } = useRequests();
  const manpower = useManpower();
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
        This request is approved. Assign delivery now; stock tasks appear immediately, and purchase tasks appear after
        the goods arrive.
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
    </Card>
  );
};
