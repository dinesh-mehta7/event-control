import React, { useEffect, useMemo, useState } from 'react';
import {
  Server,
  MapPin,
  Phone,
  Users,
  Boxes,
  Check,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Edit3,
  Trash2,
  Monitor,
  AlertTriangle,
  CheckCircle,
  PauseCircle,
  Search,
  Activity,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useManpower } from '../../modules/manpower';
import { useInventory } from '../../modules/inventory';
import { useEventScope } from '../../context/EventScopeContext';
import { useAccommodation } from '../../modules/accommodation';
import type { ControlRoom } from '../../types';
import { Modal, btnGhost, btnPrimary, input } from './controlRooms/shared';
import { ExtraAdd } from './controlRooms/ExtraAdd';
import { EMPTY_FORM, RoomForm } from './controlRooms/RoomForm';
import { ConfirmDelete } from './controlRooms/ConfirmDelete';
import { Select } from '../Select';

const btnDanger =
  'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all whitespace-nowrap';

const linkBtn = 'text-xs font-semibold text-blue-400 hover:underline whitespace-nowrap';

// ── Status display helpers ────────────────────────────────────────────────────
const STATUS_CFG = {
  operational: {
    label: 'Operational',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    icon: CheckCircle,
  },
  alert: {
    label: 'Alert',
    dot: 'bg-amber-400 animate-pulse',
    badge: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    icon: AlertTriangle,
  },
  standby: {
    label: 'Standby',
    dot: 'bg-slate-400',
    badge: 'bg-raised text-mute border border-line-strong',
    icon: PauseCircle,
  },
};

// ── Member assignment for a room (accordion) ─────────────────────────────────
interface Ops {
  members: Record<string, string[]>;
  invLoc: Record<string, string>;
  extras: Record<string, { id: string; name: string; qty: number }[]>;
}

const EMPTY_OPS: Ops = { members: {}, invLoc: {}, extras: {} };

// ── Main component ────────────────────────────────────────────────────────────
export const ControlRoomsApp: React.FC = () => {
  const { controlRooms, updateControlRoomStatus, addControlRoom, editControlRoom, deleteControlRoom } = useApp();
  const { sewadars } = useManpower();
  const inv = useInventory();
  const eventScope = useEventScope();
  const { scopeFor, setScopeFor } = eventScope;
  const eventId = scopeFor('control') || 'normal';
  const accommodation = useAccommodation();
  const eventRooms = accommodation.rooms.filter(
    room => room.category === 'control_room' && room.eventId === (eventId === 'normal' ? null : eventId),
  );
  const activeEventName = eventScope.events.find(event => event.id === eventId)?.name;
  useEffect(() => {
    const accommodationEventId = eventId === 'normal' ? '' : eventId;
    if (scopeFor('accommodation') !== accommodationEventId) setScopeFor('accommodation', accommodationEventId);
  }, [eventId, scopeFor, setScopeFor]);
  const opsKey = `eitc_cr_ops:${eventId}`;
  const [savedOps, setSavedOps] = useState<{ key: string; value: Ops }>(() => {
    try {
      return {
        key: opsKey,
        value:
          JSON.parse(
            localStorage.getItem(opsKey) ||
              (eventId === 'normal' ? localStorage.getItem('eitc_cr_ops') : null) ||
              'null',
          ) || EMPTY_OPS,
      };
    } catch {
      return { key: opsKey, value: EMPTY_OPS };
    }
  });
  const ops = useMemo<Ops>(() => {
    if (savedOps.key === opsKey) return savedOps.value;
    try {
      return (
        JSON.parse(
          localStorage.getItem(opsKey) || (eventId === 'normal' ? localStorage.getItem('eitc_cr_ops') : null) || 'null',
        ) || EMPTY_OPS
      );
    } catch {
      return EMPTY_OPS;
    }
  }, [savedOps, opsKey]);
  const setOps = (next: Ops | ((current: Ops) => Ops)) =>
    setSavedOps(current => ({ key: opsKey, value: typeof next === 'function' ? next(ops) : next }));
  useEffect(() => {
    try {
      localStorage.setItem(opsKey, JSON.stringify(ops));
    } catch {
      /* storage may be disabled */
    }
  }, [opsKey, ops]);

  // UI state
  const [q, setQ] = useState('');
  const [expandId, setExpandId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<string | null>(null); // roomId open for ops editing
  const [addOpen, setAddOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<ControlRoom | null>(null);
  const [deleteRoom, setDeleteRoom] = useState<ControlRoom | null>(null);

  const patch = (f: (o: Ops) => Ops) => setOps(f);
  const person = (id: string) => sewadars.find(s => s.id === id);
  const membersOf = (rid: string) => (ops.members[rid] || []).map(person).filter(Boolean) as typeof sewadars;
  const assignedElsewhere = (rid: string) =>
    new Set(
      Object.entries(ops.members)
        .filter(([k]) => k !== rid)
        .flatMap(([, v]) => v),
    );
  const heldAt = (rid: string) => {
    const loc = ops.invLoc[rid];
    return loc ? inv.holdings.filter(h => h.location === loc && h.qty > 0) : [];
  };

  // Filter rooms
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return controlRooms;
    return controlRooms.filter(
      r =>
        r.name.toLowerCase().includes(t) ||
        r.code.toLowerCase().includes(t) ||
        r.location.toLowerCase().includes(t) ||
        r.primaryLead.toLowerCase().includes(t),
    );
  }, [controlRooms, q]);

  // Quick counts for temporary IT setups and their assigned resources.
  const operationalCount = controlRooms.filter(r => r.status === 'operational').length;
  const totalMembers = Object.values(ops.members).reduce((n, ids: string[]) => n + ids.length, 0);
  const totalMaterial = controlRooms.reduce(
    (n, r) =>
      n + heldAt(r.id).reduce((sum, h) => sum + h.qty, 0) + (ops.extras[r.id] || []).reduce((sum, e) => sum + e.qty, 0),
    0,
  );

  return (
    <div className="space-y-4">
      {/* ── Header row ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Temporary IT Setups</h2>
          <p className="text-xs text-mute mt-0.5">Track setup locations, leads, assigned members and materials.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className={btnPrimary}>
          <Plus size={16} /> Add Room
        </button>
      </div>

      {eventId !== 'normal' && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              Event control rooms · {activeEventName || 'Selected event'}
            </h3>
            <p className="mt-1 text-xs text-mute">
              Rooms added under Event Planning → Requirement Management appear here. Rest rooms stay in Accommodation.
            </p>
          </div>
          {eventRooms.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {eventRooms.map(room => (
                <article key={room.id} className="rounded-lg border border-line bg-raised/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-ink">{room.name}</h4>
                      <p className="mt-1 text-xs text-mute">
                        {room.block || 'Location not set'} · Capacity {room.capacity}
                        {room.responsibleTeam ? ` · ${room.responsibleTeam}` : ''}
                      </p>
                    </div>
                    <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10.5px] font-medium text-blue-300">
                      Event room
                    </span>
                  </div>
                  <div className="mt-3 border-t border-line pt-2">
                    {room.requirements.length ? (
                      <ul className="space-y-1">
                        {room.requirements.map((item, index) => (
                          <li key={`${item.name}-${index}`} className="flex justify-between gap-2 text-xs">
                            <span className="text-ink-soft">{item.name}</span>
                            <span className="text-mute">
                              {item.readyQuantity}/{item.quantity} ready
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-mute">No necessities added yet.</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line p-5 text-center text-xs text-mute">
              No control rooms added for this event yet.
            </p>
          )}
        </section>
      )}

      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Server, label: 'Setups', value: controlRooms.length, sub: `${operationalCount} active` },
          { icon: Users, label: 'Assigned members', value: totalMembers, sub: 'across all setups' },
          { icon: Boxes, label: 'Materials assigned', value: totalMaterial, sub: 'units linked / listed' },
        ].map(({ icon: I, label, value, sub }) => (
          <div key={label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-mute uppercase tracking-wide mb-1">
              <I size={12} className="text-blue-400" />
              {label}
            </div>
            <div className="text-lg font-bold text-ink tabular-nums">{value}</div>
            <div className="text-[10.5px] text-mute">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name, code, location or lead…"
          className={input.replace('px-3', 'pl-10 pr-3')}
        />
      </div>

      {/* ── Rooms table / list ───────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-12 text-center">
          <Monitor size={40} className="mx-auto mb-3 text-mute opacity-40" />
          <p className="text-sm text-mute">
            {q ? 'No rooms match your search.' : 'No control rooms yet. Add one above.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-line bg-raised/50 text-[10.5px] font-semibold uppercase tracking-wider text-mute">
            <span>Temporary setup</span>
            <span>Location / Lead</span>
            <span>Members</span>
            <span>Status</span>
            <span></span>
          </div>
          <div className="divide-y divide-line">
            {filtered.map(r => {
              const cfg = STATUS_CFG[r.status] || STATUS_CFG.operational;
              const mem = membersOf(r.id);
              const held = heldAt(r.id);
              const extras = ops.extras[r.id] || [];
              const expanded = expandId === r.id;
              const editing = editMode === r.id;
              const gone = assignedElsewhere(r.id);
              const free = sewadars.filter(s => !gone.has(s.id) && !(ops.members[r.id] || []).includes(s.id));

              return (
                <div key={r.id} className={r.status === 'alert' ? 'bg-amber-500/5' : ''}>
                  {/* Main row */}
                  <div className="grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-2 lg:gap-4 px-4 py-3 items-center">
                    {/* Room name */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className="text-xs font-mono font-bold text-blue-400">{r.code}</span>
                      </div>
                      <div className="text-sm font-semibold text-ink mt-0.5">{r.name}</div>
                    </div>
                    {/* Location / lead */}
                    <div className="text-xs text-mute">
                      <div className="flex items-center gap-1">
                        <MapPin size={11} />
                        {r.location}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Users size={11} />
                        {r.primaryLead}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Phone size={11} />
                        {r.phone}
                      </div>
                    </div>
                    {/* Temporary team and room equipment summary */}
                    <div className="text-xs text-mute">
                      <span className="text-ink font-semibold">{mem.length}</span> members
                      <div className="mt-0.5">{held.length + extras.length} material types</div>
                    </div>
                    {/* Status */}
                    <div className="flex flex-col gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}
                      >
                        <cfg.icon size={11} />
                        {cfg.label}
                      </span>
                      <button
                        onClick={() =>
                          updateControlRoomStatus(
                            r.id,
                            r.status === 'alert' ? 'operational' : r.status === 'operational' ? 'alert' : 'operational',
                          )
                        }
                        className="text-xs text-blue-400 hover:underline text-left"
                      >
                        {r.status === 'alert'
                          ? 'Clear alert'
                          : r.status === 'operational'
                            ? 'Raise alert'
                            : 'Set operational'}
                      </button>
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditRoom(r)}
                        className="p-2 rounded-lg text-mute hover:bg-raised hover:text-blue-400 transition-colors"
                        title="Edit room"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteRoom(r)}
                        className="p-2 rounded-lg text-mute hover:bg-raised hover:text-red-400 transition-colors"
                        title="Delete room"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => setExpandId(expanded ? null : r.id)}
                        className="p-2 rounded-lg text-mute hover:bg-raised hover:text-ink transition-colors"
                        title={expanded ? 'Collapse' : 'View members and materials'}
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Expandable ops panel */}
                  {expanded && (
                    <div className="px-5 pb-5 border-t border-line bg-raised/30 animate-slide-up">
                      <div className="grid lg:grid-cols-2 gap-4 pt-3">
                        {/* Members */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-mute uppercase tracking-wider flex items-center gap-1.5">
                              <Users size={12} />
                              Assigned Members ({mem.length})
                            </span>
                            {!editing && (
                              <button
                                onClick={() => setEditMode(r.id)}
                                className="text-xs text-blue-400 hover:underline"
                              >
                                + Assign
                              </button>
                            )}
                          </div>
                          {mem.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {mem.map(m => (
                                <span
                                  key={m.id}
                                  className="inline-flex items-center gap-1.5 text-xs bg-surface border border-line text-ink rounded-full pl-2.5 pr-1.5 py-1"
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${m.arrival === 'arrived' ? 'bg-emerald-400' : 'bg-line-strong'}`}
                                  />
                                  {m.name}
                                  {editing && (
                                    <button
                                      aria-label={`Remove ${m.name}`}
                                      onClick={() =>
                                        patch(o => ({
                                          ...o,
                                          members: {
                                            ...o.members,
                                            [r.id]: (o.members[r.id] || []).filter(x => x !== m.id),
                                          },
                                        }))
                                      }
                                      className="p-0.5 rounded-full hover:bg-red-500/20 text-mute hover:text-red-400"
                                    >
                                      <X size={11} />
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-mute">No members assigned.</p>
                          )}
                          {editing && (
                            <Select
                              className={input + ' mt-2 text-xs'}
                              value=""
                              aria-label="Add member"
                              onChange={e => {
                                const id = e.target.value;
                                if (id)
                                  patch(o => ({
                                    ...o,
                                    members: { ...o.members, [r.id]: [...(o.members[r.id] || []), id] },
                                  }));
                              }}
                            >
                              <option value="">Add a member…</option>
                              {free
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map(s => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} {s.department === 'control' ? '· Control' : ''}
                                  </option>
                                ))}
                            </Select>
                          )}
                        </div>

                        {/* Equipment */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-mute uppercase tracking-wider flex items-center gap-1.5">
                              <Boxes size={12} />
                              Equipment ({held.length + extras.length})
                            </span>
                          </div>
                          {held.length || extras.length ? (
                            <ul className="text-xs space-y-1.5">
                              {held.map(h => {
                                const it = inv.items.find(x => x.id === h.itemId);
                                return (
                                  <li key={h.itemId} className="flex justify-between gap-2">
                                    <span className="text-ink truncate">{it?.name || 'Item'}</span>
                                    <span className="text-mute shrink-0">
                                      {h.qty} {it?.unit || ''}
                                    </span>
                                  </li>
                                );
                              })}
                              {extras.map(x => (
                                <li key={x.id} className="flex justify-between gap-2 items-center">
                                  <span className="text-ink truncate">
                                    {x.name} <span className="text-faint">· other</span>
                                  </span>
                                  <span className="text-mute shrink-0 inline-flex items-center gap-1">
                                    {x.qty}
                                    {editing && (
                                      <button
                                        aria-label={`Remove ${x.name}`}
                                        onClick={() =>
                                          patch(o => ({
                                            ...o,
                                            extras: {
                                              ...o.extras,
                                              [r.id]: (o.extras[r.id] || []).filter(e => e.id !== x.id),
                                            },
                                          }))
                                        }
                                        className="p-0.5 rounded hover:bg-red-500/20 text-mute hover:text-red-400"
                                      >
                                        <X size={11} />
                                      </button>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-mute">
                              {ops.invLoc[r.id] ? 'Nothing issued yet.' : 'No inventory location linked.'}
                            </p>
                          )}

                          {/* Inventory location linkage & extra add */}
                          {editing && (
                            <div className="mt-3 space-y-2">
                              <Select
                                className={input + ' text-xs'}
                                value={ops.invLoc[r.id] || ''}
                                aria-label="Inventory location"
                                onChange={e => patch(o => ({ ...o, invLoc: { ...o.invLoc, [r.id]: e.target.value } }))}
                              >
                                <option value="">Link inventory location…</option>
                                {inv.locations.map(l => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </Select>
                              <ExtraAdd
                                onAdd={(name, qty) =>
                                  patch(o => ({
                                    ...o,
                                    extras: {
                                      ...o.extras,
                                      [r.id]: [...(o.extras[r.id] || []), { id: 'x' + Date.now(), name, qty }],
                                    },
                                  }))
                                }
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4 pt-3 border-t border-line">
                        {editing ? (
                          <button onClick={() => setEditMode(null)} className={btnPrimary + ' !py-1.5 !text-xs'}>
                            <Check size={13} />
                            Done
                          </button>
                        ) : (
                          <button onClick={() => setEditMode(r.id)} className={btnGhost + ' !py-1.5 !text-xs'}>
                            <Edit3 size={13} />
                            Edit Ops
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-[10.5px] text-mute">
        <span className="flex items-center gap-1.5">
          <Activity size={12} className="text-blue-400" />
          {controlRooms.length} temporary setups · {operationalCount} active
        </span>
        <span>
          {totalMembers} members · {totalMaterial} material units assigned
        </span>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {addOpen && (
        <Modal title="Add Control Room" onClose={() => setAddOpen(false)}>
          <RoomForm
            initial={EMPTY_FORM}
            onSave={d => {
              addControlRoom(d);
              setAddOpen(false);
            }}
            onClose={() => setAddOpen(false)}
          />
        </Modal>
      )}
      {editRoom && (
        <Modal title={`Edit · ${editRoom.code}`} onClose={() => setEditRoom(null)}>
          <RoomForm
            initial={editRoom}
            onSave={d => {
              editControlRoom(editRoom.id, d);
              setEditRoom(null);
            }}
            onClose={() => setEditRoom(null)}
            isEdit
          />
        </Modal>
      )}
      {deleteRoom && (
        <ConfirmDelete
          name={`${deleteRoom.code} — ${deleteRoom.name}`}
          onConfirm={() => deleteControlRoom(deleteRoom.id)}
          onClose={() => setDeleteRoom(null)}
        />
      )}
    </div>
  );
};
