import React, { useState } from 'react';
import type { ControlRoom } from '../../../types';
import { digitsOnly, phoneInputProps } from '../../../lib/phone';
import { btnGhost, btnPrimary, input } from './shared';
import { Select } from '../../Select';

// ── Form for add/edit room ────────────────────────────────────────────────────
export const EMPTY_FORM: Omit<ControlRoom, 'id'> = {
  code: '',
  name: '',
  location: '',
  videoWallScreens: 0,
  activeWorkstations: 0,
  totalWorkstations: 0,
  activeOperatorCount: 0,
  feedCount: 0,
  status: 'operational',
  primaryLead: '',
  phone: '',
};

export const RoomForm: React.FC<{
  initial: Omit<ControlRoom, 'id'>;
  onSave: (data: Omit<ControlRoom, 'id'>) => void;
  onClose: () => void;
  isEdit?: boolean;
}> = ({ initial, onSave, onClose, isEdit }) => {
  const [f, setF] = useState(initial);
  const n = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF(p => ({ ...p, [k]: val }));
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    n(k, parseInt(e.target.value, 10) || (0 as any));

  const Label = ({ text }: { text: string }) => (
    <label className="block text-xs font-semibold text-mute mb-1 mt-4 uppercase tracking-wider">{text}</label>
  );
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (!f.code.trim() || !f.name.trim()) return;
        onSave(f);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Room Code" />
          <input
            className={input}
            placeholder="CR-06"
            value={f.code}
            onChange={e => n('code', e.target.value)}
            required
          />
        </div>
        <div>
          <Label text="Status" />
          <Select className={input} value={f.status} onChange={e => n('status', e.target.value as any)}>
            <option value="operational">Operational</option>
            <option value="alert">Alert</option>
            <option value="standby">Standby</option>
          </Select>
        </div>
      </div>
      <Label text="Room Name" />
      <input
        className={input}
        placeholder="e.g. Central IT Command Center"
        value={f.name}
        onChange={e => n('name', e.target.value)}
        required
      />
      <Label text="Location" />
      <input
        className={input}
        placeholder="Building, floor, zone…"
        value={f.location}
        onChange={e => n('location', e.target.value)}
      />
      <Label text="Primary Lead" />
      <input
        className={input}
        placeholder="Full name"
        value={f.primaryLead}
        onChange={e => n('primaryLead', e.target.value)}
      />
      <Label text="Phone" />
      <input
        className={input}
        {...phoneInputProps}
        placeholder="Digits only"
        value={f.phone}
        onChange={e => n('phone', digitsOnly(e.target.value))}
      />
      <p className="mt-4 rounded-lg bg-raised/60 px-3 py-2 text-xs text-mute">
        Assign members and record room materials after saving the room.
      </p>
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-line">
        <button type="button" onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary}>
          {isEdit ? 'Save Changes' : 'Add Room'}
        </button>
      </div>
    </form>
  );
};
