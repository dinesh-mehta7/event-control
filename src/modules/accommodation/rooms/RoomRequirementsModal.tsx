import React, { useEffect, useState } from 'react';
import { Circle, CircleCheck, Plus, Trash2 } from 'lucide-react';
import type { Room, RoomRequirement } from '../types';
import { Modal, btnGhost, btnPrimary, cx, inputCls } from '../ui';

export const RoomRequirementsModal: React.FC<{
  dark: boolean;
  room: Room;
  canDefine: boolean;
  canFulfill: boolean;
  isPostEvent: boolean;
  onClose: () => void;
  onSave: (requirements: RoomRequirement[]) => Promise<boolean>;
}> = ({ dark, room, canDefine, canFulfill, isPostEvent, onClose, onSave }) => {
  const [items, setItems] = useState<RoomRequirement[]>(room.requirements.map(item => ({ ...item })));
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'prepare' | 'return'>(isPostEvent ? 'return' : 'prepare');
  useEffect(() => {
    if (isPostEvent) setPhase('return');
  }, [isPostEvent]);
  const changeItem = (index: number, patch: Partial<RoomRequirement>) =>
    setItems(current => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const isPrepared = (item: RoomRequirement) => item.quantity > 0 && item.readyQuantity >= item.quantity;
  const completeCount = items.filter(item => (phase === 'prepare' ? isPrepared(item) : item.returned)).length;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const cleaned = items
      .map(item => ({
        ...item,
        name: item.name.trim(),
        quantity: Math.max(0, Number(item.quantity) || 0),
        readyQuantity: Math.min(Math.max(0, Number(item.readyQuantity) || 0), Math.max(0, Number(item.quantity) || 0)),
        collectFrom: String(item.collectFrom || '').trim(),
        returned: !!item.returned,
      }))
      .filter(item => item.name);
    const ok = await onSave(cleaned);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={`Room checklist · ${room.name}`} dark={dark} xxl stickyHeader onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={cx('text-xs', dark ? 'text-gray-400' : 'text-gray-600')}>
              {room.category === 'rest_room'
                ? 'Assign and prepare necessities before the event. After it ends, collect them and mark each one returned.'
                : `The ${room.responsibleTeam || 'assigned'} team prepares this room before the event and returns its necessities afterward.`}
            </p>
          </div>
          <span
            className={cx(
              'shrink-0 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium tabular-nums',
              dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600',
            )}
          >
            {completeCount} / {items.length} {phase === 'prepare' ? 'prepared' : 'returned'}
          </span>
        </div>

        <div
          className={cx(
            'grid grid-cols-2 gap-1 rounded-lg border p-1',
            dark ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-gray-50',
          )}
          role="group"
          aria-label="Room work phase"
        >
          <button
            type="button"
            aria-pressed={phase === 'prepare'}
            onClick={() => setPhase('prepare')}
            className={cx(
              'rounded-md px-3 py-2 text-xs font-semibold transition-colors',
              phase === 'prepare'
                ? 'bg-blue-600 text-white'
                : dark
                  ? 'text-gray-400 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white',
            )}
          >
            <span className="mr-1.5">1</span>Before event · Prepare & accommodate
          </button>
          <button
            type="button"
            aria-pressed={phase === 'return'}
            onClick={() => setPhase('return')}
            className={cx(
              'rounded-md px-3 py-2 text-xs font-semibold transition-colors',
              phase === 'return'
                ? 'bg-blue-600 text-white'
                : dark
                  ? 'text-gray-400 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white',
            )}
          >
            <span className="mr-1.5">2</span>After event · Collect & return
          </button>
        </div>
        <p className={cx('text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>
          {phase === 'prepare'
            ? 'Complete each item as it is placed in the room. Room assignments are managed with Add people.'
            : isPostEvent
              ? 'Event is marked complete. Collect each prepared item from the room and mark it returned.'
              : 'After the event, collect each prepared item from the room. A return task can only be completed after preparation.'}
        </p>

        {items.length === 0 && (
          <p
            className={cx(
              'rounded-lg border border-dashed border-line px-3 py-8 text-center text-xs',
              dark ? 'text-gray-500' : 'text-gray-500',
            )}
          >
            No necessities added yet. Add the items needed for this room before the event.
          </p>
        )}
        {/* One row per necessity: details first, status next, the Done action last. */}
        {items.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="hidden grid-cols-[2rem_minmax(0,2fr)_5.5rem_minmax(0,1.5fr)_2.25rem_minmax(9rem,1fr)_10.5rem] items-center gap-2 border-b border-line bg-raised px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-mute sm:grid">
              <span className="text-right">#</span>
              <span>Necessity</span>
              <span>Needed</span>
              <span>Collect from</span>
              <span />
              <span>Status</span>
              <span className="text-right">Done</span>
            </div>
            <div className="max-h-[58vh] divide-y divide-line overflow-y-auto">
              {items.map((item, index) => {
                const done = phase === 'prepare' ? isPrepared(item) : item.returned;
                const editable = canDefine && phase === 'prepare';
                const cellInput = cx(inputCls(dark), 'h-9 !py-1 text-sm');
                return (
                  <div
                    key={index}
                    className={cx(
                      'grid grid-cols-1 items-center gap-2 px-3 py-2.5 sm:grid-cols-[2rem_minmax(0,2fr)_5.5rem_minmax(0,1.5fr)_2.25rem_minmax(9rem,1fr)_10.5rem]',
                      done && (dark ? 'bg-emerald-500/[0.05]' : 'bg-emerald-50/60'),
                    )}
                  >
                    <span className="hidden text-right text-xs tabular-nums text-faint sm:block">{index + 1}</span>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-mute sm:sr-only">Necessity</span>
                      <input
                        disabled={!editable}
                        value={item.name}
                        onChange={e => changeItem(index, { name: e.target.value })}
                        placeholder="Fan, mattress, blanket…"
                        aria-label={`Necessity ${index + 1}`}
                        className={cellInput}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-mute sm:sr-only">Needed</span>
                      <input
                        disabled={!editable}
                        type="number"
                        min={0}
                        value={item.quantity}
                        onChange={e =>
                          changeItem(index, {
                            quantity: Number(e.target.value),
                            readyQuantity: Math.min(item.readyQuantity, Number(e.target.value) || 0),
                            returned:
                              Number(e.target.value) > 0 && item.readyQuantity >= Number(e.target.value)
                                ? item.returned
                                : false,
                          })
                        }
                        aria-label={`Needed for necessity ${index + 1}`}
                        className={cx(cellInput, 'text-right tabular-nums')}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-mute sm:sr-only">Collect from</span>
                      <input
                        disabled={!editable}
                        value={item.collectFrom || ''}
                        onChange={e => changeItem(index, { collectFrom: e.target.value })}
                        placeholder="Store / block / contact"
                        aria-label={`Collect from for necessity ${index + 1}`}
                        className={cellInput}
                      />
                    </label>
                    <span className="flex sm:justify-center">
                      {editable && (
                        <button
                          type="button"
                          aria-label={`Remove ${item.name || 'necessity'}`}
                          title="Remove"
                          className="grid h-8 w-8 place-items-center rounded-md text-rose-400 hover:bg-rose-500/10"
                          onClick={() => setItems(current => current.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                    <div className="flex min-w-0 items-center gap-2 text-[11.5px]">
                      {done ? (
                        <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-amber-400" />
                      )}
                      <span className="min-w-0">
                        <span className={cx('block font-semibold', done ? 'text-emerald-400' : 'text-amber-300')}>
                          {done
                            ? phase === 'prepare'
                              ? 'Prepared'
                              : 'Returned'
                            : phase === 'prepare'
                              ? 'To prepare'
                              : 'To return'}
                        </span>
                        {phase === 'prepare' && (
                          <span className="block tabular-nums text-faint">
                            {Math.min(item.readyQuantity, item.quantity)} / {item.quantity} ready
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex sm:justify-end">
                      {canFulfill ? (
                        <button
                          type="button"
                          disabled={phase === 'prepare' ? item.quantity <= 0 : !isPrepared(item)}
                          onClick={() =>
                            changeItem(
                              index,
                              phase === 'prepare'
                                ? { readyQuantity: done ? 0 : item.quantity, returned: done ? false : item.returned }
                                : { returned: !item.returned },
                            )
                          }
                          className={cx(
                            'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto',
                            done
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20'
                              : 'border-blue-500/40 bg-blue-600 text-white hover:bg-blue-500',
                          )}
                        >
                          {done ? (
                            <>
                              <CircleCheck className="h-3.5 w-3.5" />
                              Done · undo
                            </>
                          ) : (
                            <>
                              <Circle className="h-3.5 w-3.5" />
                              Mark {phase === 'prepare' ? 'prepared' : 'returned'}
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-faint">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {canDefine && phase === 'prepare' && (
          <button
            type="button"
            className={btnGhost(dark)}
            onClick={() =>
              setItems(current => [
                ...current,
                { name: '', quantity: 1, readyQuantity: 0, collectFrom: '', returned: false },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add necessity
          </button>
        )}
        {!canDefine && (
          <p className={cx('text-[11.5px]', dark ? 'text-gray-500' : 'text-gray-500')}>
            {canFulfill
              ? 'Room necessities are managed by Accommodation or the responsible control-room team. Update task status here.'
              : 'View only. Task updates are limited to Accommodation or the responsible team.'}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" onClick={onClose} className={btnGhost(dark)}>
            Close
          </button>
          {(canDefine || canFulfill) && (
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? 'Saving…' : 'Save checklist'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
};
