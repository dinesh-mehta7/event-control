import React, { useState } from 'react';
import { DEPT_OPTIONS } from '../types';
import type { Member, Room } from '../types';
import { Modal, btnGhost, btnPrimary, inputCls, labelCls } from '../ui';
import { digitsOnly, phoneInputProps } from '../../../lib/phone';

export const MemberForm: React.FC<{
  dark: boolean;
  rooms: Room[];
  members: Member[];
  edit: Member | null;
  presetRoom?: string;
  canAssignRoomMembers: boolean;
  onClose: () => void;
  onAdd: (names: string[], department: string, roomId: string | null, details?: Partial<Member>) => Promise<boolean>;
  onEdit: (id: string, patch: Partial<Omit<Member, 'id'>>) => Promise<boolean>;
}> = ({ dark, rooms, members, edit, presetRoom, canAssignRoomMembers, onClose, onAdd, onEdit }) => {
  const [names, setNames] = useState(edit?.name || '');
  const [dept, setDept] = useState(edit?.department || '');
  const [roomId, setRoomId] = useState(edit?.roomId || presetRoom || '');
  const [detail, setDetail] = useState({
    memberType: edit?.memberType || ('salary_based' as Member['memberType']),
    serialNo: edit?.serialNo || '',
    batchNo: edit?.batchNo || '',
    relation: edit?.relation || '',
    relationName: edit?.relationName || '',
    mobile: edit?.mobile || '',
    villageCity: edit?.villageCity || '',
    branch: edit?.branch || '',
    occupation: edit?.occupation || '',
    remarks: edit?.remarks || '',
    joiningDate: edit?.joiningDate || '',
    employeeCode: edit?.employeeCode || '',
    employeeId: edit?.employeeId || '',
    address: edit?.address || '',
    address2: edit?.address2 || '',
    expectedArrival: edit?.expectedArrival || '',
    teamName: edit?.teamName || '',
    teamLead: edit?.teamLead || '',
  });
  const [busy, setBusy] = useState(false);
  const freeIn = (r: Room) => r.capacity - members.filter(m => m.roomId === r.id && m.id !== edit?.id).length;
  const count = names
    .split('\n')
    .map(n => n.trim())
    .filter(Boolean).length;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = edit
      ? await onEdit(edit.id, {
          name: names,
          department: dept,
          ...(canAssignRoomMembers ? { roomId: roomId || null } : {}),
          ...detail,
        })
      : await onAdd(names.split('\n'), dept, roomId || null, detail);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={edit ? `Edit ${edit.name}` : 'Add members'} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {edit ? (
          <div>
            <label className={labelCls(dark)} htmlFor="mn">
              Name
            </label>
            <input
              id="mn"
              autoFocus
              required
              value={names}
              onChange={e => setNames(e.target.value)}
              className={inputCls(dark)}
            />
          </div>
        ) : (
          <div>
            <label className={labelCls(dark)} htmlFor="mns">
              Names — one per line{count > 1 ? ` (${count})` : ''}
            </label>
            <textarea
              id="mns"
              autoFocus
              required
              rows={5}
              value={names}
              onChange={e => setNames(e.target.value)}
              placeholder={'Jaspreet Kaur\nGurdeep Singh\n…'}
              className={inputCls(dark)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(dark)} htmlFor="md">
              Department (optional)
            </label>
            <select id="md" value={dept} onChange={e => setDept(e.target.value)} className={inputCls(dark)}>
              <option value="">—</option>
              {DEPT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls(dark)} htmlFor="mr">
              Room
            </label>
            <select
              id="mr"
              value={roomId}
              disabled={!canAssignRoomMembers}
              onChange={e => setRoomId(e.target.value)}
              className={inputCls(dark)}
            >
              <option value="">— Not in a room —</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id} disabled={freeIn(r) <= 0}>
                  {r.name} ({Math.max(0, freeIn(r))} free)
                </option>
              ))}
            </select>
          </div>
        </div>
        {!edit && (
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div>
              <label className={labelCls(dark)}>Member type</label>
              <select
                value={detail.memberType}
                onChange={e => setDetail(p => ({ ...p, memberType: e.target.value as Member['memberType'] }))}
                className={inputCls(dark)}
              >
                <option value="salary_based">Salary based (hired)</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual (main event)</option>
              </select>
            </div>
            <div>
              <label className={labelCls(dark)}>Sewa joining / promised date</label>
              <input
                type="date"
                value={detail.joiningDate}
                onChange={e => setDetail(p => ({ ...p, joiningDate: e.target.value, expectedArrival: e.target.value }))}
                className={inputCls(dark)}
              />
            </div>
          </div>
        )}
        {edit && (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="text-xs font-semibold text-mute">Member record</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls(dark)}>Member type</label>
                <select
                  value={detail.memberType}
                  onChange={e => setDetail(p => ({ ...p, memberType: e.target.value as Member['memberType'] }))}
                  className={inputCls(dark)}
                >
                  <option value="salary_based">Salary based (hired)</option>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual (main event)</option>
                </select>
              </div>
              <div>
                <label className={labelCls(dark)}>Sewa joining / promised date</label>
                <input
                  type="date"
                  value={detail.joiningDate}
                  onChange={e => setDetail(p => ({ ...p, joiningDate: e.target.value }))}
                  className={inputCls(dark)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['serialNo', 'Sr. No.'],
                  ['batchNo', 'Badge no.'],
                  ['relation', 'Relation'],
                  ['relationName', 'Relation name'],
                  ['mobile', 'Mobile'],
                  ['villageCity', 'Village / city'],
                  ['branch', 'Branch'],
                  ['occupation', 'Occupation'],
                  ['employeeCode', 'Employee code'],
                  ['employeeId', 'Employee ID'],
                  ['address', 'Address'],
                  ['address2', 'Address 2'],
                  ['remarks', 'Remarks'],
                  ['expectedArrival', 'Expected arrival date'],
                  ['teamName', 'Team'],
                  ['teamLead', 'Team lead'],
                ] as [keyof typeof detail, string][]
              ).map(([key, label]) => (
                <div key={key}>
                  <label className={labelCls(dark)}>{label}</label>
                  <input
                    type={key === 'expectedArrival' ? 'date' : 'text'}
                    {...(key === 'mobile' ? phoneInputProps : {})}
                    value={detail[key] as string}
                    onChange={e =>
                      setDetail(p => ({ ...p, [key]: key === 'mobile' ? digitsOnly(e.target.value) : e.target.value }))
                    }
                    className={inputCls(dark)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : edit ? 'Save' : `Add ${count > 1 ? count + ' members' : 'member'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
};
