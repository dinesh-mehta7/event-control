import React, { useState } from 'react';
import { memberMeta } from '../../manpower/memberMeta';
import { Search } from 'lucide-react';
import { DEPT_LABEL } from '../types';
import type { Member, Room } from '../types';
import { Modal, btnGhost, btnPrimary, cx, inputCls } from '../ui';

export const RoomAssignmentModal: React.FC<{
  dark: boolean;
  room: Room;
  members: Member[];
  presentMembers: Member[];
  eventSelected: boolean;
  onClose: () => void;
  onSave: (memberIds: string[]) => Promise<boolean>;
}> = ({ dark, room, members, presentMembers, eventSelected, onClose, onSave }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    presentMembers.filter(member => member.roomId === room.id).map(member => member.id),
  );
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const filteredPresentMembers = presentMembers.filter(
    member =>
      !query ||
      [member.name, member.department, DEPT_LABEL[member.department], member.mobile].some(value =>
        String(value || '')
          .toLocaleLowerCase()
          .includes(query),
      ),
  );
  const assignedElsewhere = (member: Member) => member.roomId && member.roomId !== room.id;
  const stayingNonPresent = members.filter(
    member => member.roomId === room.id && !presentMembers.some(present => present.id === member.id),
  ).length;
  const maxSelectable = Math.max(0, room.capacity - stayingNonPresent);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const ok = await onSave(selectedIds);
    setBusy(false);
    if (ok) onClose();
  };
  const toggle = (id: string, checked: boolean) =>
    setSelectedIds(current => (checked ? [...current, id] : current.filter(value => value !== id)));
  return (
    <Modal title={`Add present Sewadars · ${room.name}`} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className={cx('text-xs', dark ? 'text-gray-400' : 'text-gray-600')}>
          Select members marked Present for the event. Only members already in the Sewadar roster are listed.
        </p>
        {!eventSelected ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            Select an event in the header to see present Sewadars.
          </p>
        ) : !presentMembers.length ? (
          <p
            className={cx(
              'rounded-lg border border-dashed border-line p-5 text-center text-xs',
              dark ? 'text-gray-500' : 'text-gray-500',
            )}
          >
            No Sewadars are currently marked Present for this event.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search present Sewadars…"
                aria-label="Search present Sewadars"
                className={cx(inputCls(dark), 'pl-9')}
              />
            </div>
            <div className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {filteredPresentMembers.map(member => {
                const elsewhere = assignedElsewhere(member);
                const checked = selectedIds.includes(member.id);
                return (
                  <label
                    key={member.id}
                    className={cx(
                      'flex items-center gap-3 px-3 py-2.5 text-sm',
                      elsewhere ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!!elsewhere || (!checked && selectedIds.length >= maxSelectable)}
                      onChange={event => toggle(member.id, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {member.name}
                      {memberMeta(member) && (
                        <span className="ml-1.5 text-xs font-normal opacity-70">{memberMeta(member)}</span>
                      )}
                    </span>
                    {member.department && (
                      <span className={cx('text-xs', dark ? 'text-gray-400' : 'text-gray-600')}>
                        {DEPT_LABEL[member.department] || member.department}
                      </span>
                    )}
                    {elsewhere && <span className="text-[10.5px] text-amber-300">Already assigned</span>}
                  </label>
                );
              })}
              {!filteredPresentMembers.length && (
                <p className={cx('p-4 text-center text-xs', dark ? 'text-gray-500' : 'text-gray-500')}>
                  No present Sewadars match “{search}”.
                </p>
              )}
            </div>
          </>
        )}
        <p className={cx('text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>
          {selectedIds.length} selected · {maxSelectable} bed(s) available
        </p>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !eventSelected} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save room members'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
