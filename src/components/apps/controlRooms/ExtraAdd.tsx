import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { input } from './shared';

// ── Extra equipment add widget ────────────────────────────────────────────────
export const ExtraAdd: React.FC<{ onAdd: (name: string, qty: number) => void }> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const input2 =
    'bg-field border border-line-strong rounded-xl px-3 py-2 text-xs text-ink placeholder-faint outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all';
  const add = () => {
    const q = Math.max(1, parseInt(qty, 10) || 1);
    if (!name.trim()) return;
    onAdd(name.trim(), q);
    setName('');
    setQty('1');
  };
  return (
    <div className="flex gap-2">
      <input
        className={input2 + ' flex-1'}
        placeholder="Other equipment…"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') add();
        }}
      />
      <input
        className={input2 + ' w-16'}
        type="number"
        min={1}
        value={qty}
        onChange={e => setQty(e.target.value)}
        aria-label="Qty"
      />
      <button
        onClick={add}
        className="px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        aria-label="Add"
      >
        <Plus size={14} />
      </button>
    </div>
  );
};
