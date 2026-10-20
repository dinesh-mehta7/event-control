import React from 'react';
import { Trash2 } from 'lucide-react';
import { Modal, btnGhost } from './shared';

// ── Confirm delete modal ──────────────────────────────────────────────────────
export const ConfirmDelete: React.FC<{ name: string; onConfirm: () => void; onClose: () => void }> = ({
  name,
  onConfirm,
  onClose,
}) => (
  <Modal title="Delete Control Room" onClose={onClose}>
    <div className="text-center py-4">
      <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
        <Trash2 size={22} className="text-red-400" />
      </div>
      <p className="text-sm text-ink mb-1">Are you sure you want to delete</p>
      <p className="text-base font-semibold text-ink mb-3">"{name}"?</p>
      <p className="text-xs text-mute mb-6">This action cannot be undone. All ops data for this room will be lost.</p>
      <div className="flex justify-center gap-3">
        <button onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-all"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  </Modal>
);
