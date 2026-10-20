import React, { useState } from 'react';
import type { Room, RoomRequirement } from '../types';
import { Modal, btnGhost, btnPrimary, cx, inputCls, labelCls } from '../ui';

export const RoomForm: React.FC<{
  dark: boolean;
  room: Room | null;
  teams: { id: string; name: string; lead: string }[];
  onClose: () => void;
  onSave: (v: {
    name: string;
    category: Room['category'];
    block: string;
    capacity: number;
    notes: string;
    responsibleTeam: string;
    requirements: RoomRequirement[];
  }) => Promise<boolean>;
}> = ({ dark, room, teams, onClose, onSave }) => {
  const [name, setName] = useState(room?.name || '');
  const [category, setCategory] = useState<Room['category']>(room?.category || 'rest_room');
  const [responsibleTeam, setResponsibleTeam] = useState(room?.responsibleTeam || '');
  const [block, setBlock] = useState(room?.block || '');
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 4));
  const [notes, setNotes] = useState(room?.notes || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({
      name,
      category,
      block,
      capacity: Number(capacity),
      notes,
      responsibleTeam,
      requirements: room?.requirements || [],
    });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={room ? `Edit room ${room.name}` : 'Add room'} dark={dark} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls(dark)} htmlFor="rn">
              Room name / number
            </label>
            <input
              id="rn"
              autoFocus
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. A-101"
              className={inputCls(dark)}
            />
          </div>
          <div>
            <label className={labelCls(dark)} htmlFor="rb">
              Block / camp (optional)
            </label>
            <input
              id="rb"
              value={block}
              onChange={e => setBlock(e.target.value)}
              placeholder="e.g. Block A"
              className={inputCls(dark)}
            />
          </div>
        </div>
        <div>
          <label className={labelCls(dark)} htmlFor="rc">
            Room capacity (beds)
          </label>
          <input
            id="rc"
            type="number"
            min={1}
            max={500}
            required
            value={capacity}
            onChange={e => setCapacity(e.target.value)}
            className={inputCls(dark)}
          />
          <p className={cx('mt-1 text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>
            Capacity is used for member placement; beds are not room setup requirements.
          </p>
        </div>
        <div>
          <label className={labelCls(dark)} htmlFor="rno">
            Notes (optional)
          </label>
          <input
            id="rno"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Ground floor, AC"
            className={inputCls(dark)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save room'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
