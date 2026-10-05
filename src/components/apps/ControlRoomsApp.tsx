import React, { useMemo, useState } from 'react';
import {
  Server, MapPin, Phone, Users, Boxes, Siren, Check, Plus, X,
  ChevronDown, ChevronUp, Zap, Edit3, Trash2, Monitor, Tv,
  Cpu, AlertTriangle, CheckCircle, PauseCircle, Search, Activity,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useManpower } from '../../modules/manpower';
import { useInventory } from '../../modules/inventory';
import { useStore } from '../../pages/orgData';
import type { ControlRoom } from '../../types';

// ── Shared style tokens ──────────────────────────────────────────────────────
const input = 'bg-field border border-line-strong rounded-xl px-3 py-2 text-sm text-ink placeholder-faint w-full outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all';
const btnPrimary = 'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white transition-all whitespace-nowrap';
const btnGhost = 'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-line-strong text-ink-soft hover:bg-raised hover:text-ink transition-all whitespace-nowrap';
const btnDanger = 'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all whitespace-nowrap';
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

// ── Modal overlay wrapper ─────────────────────────────────────────────────────
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg text-mute hover:bg-raised hover:text-ink transition-colors"><X size={16} /></button>
      </div>
      <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
    </div>
  </div>
);

// ── Form for add/edit room ────────────────────────────────────────────────────
const EMPTY_FORM: Omit<ControlRoom, 'id'> = {
  code: '', name: '', location: '',
  videoWallScreens: 0, activeWorkstations: 0, totalWorkstations: 0,
  activeOperatorCount: 0, feedCount: 0,
  status: 'operational', primaryLead: '', phone: '',
};

const RoomForm: React.FC<{
  initial: Omit<ControlRoom, 'id'>;
  onSave: (data: Omit<ControlRoom, 'id'>) => void;
  onClose: () => void;
  isEdit?: boolean;
}> = ({ initial, onSave, onClose, isEdit }) => {
  const [f, setF] = useState(initial);
  const n = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF(p => ({ ...p, [k]: val }));
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => n(k, parseInt(e.target.value, 10) || 0 as any);

  const Label = ({ text }: { text: string }) => <label className="block text-xs font-semibold text-mute mb-1 mt-4 uppercase tracking-wider">{text}</label>;
  return (
    <form onSubmit={e => { e.preventDefault(); if (!f.code.trim() || !f.name.trim()) return; onSave(f); }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Room Code" />
          <input className={input} placeholder="CR-06" value={f.code} onChange={e => n('code', e.target.value)} required />
        </div>
        <div>
          <Label text="Status" />
          <select className={input} value={f.status} onChange={e => n('status', e.target.value as any)}>
            <option value="operational">Operational</option>
            <option value="alert">Alert</option>
            <option value="standby">Standby</option>
          </select>
        </div>
      </div>
      <Label text="Room Name" />
      <input className={input} placeholder="e.g. Central IT Command Center" value={f.name} onChange={e => n('name', e.target.value)} required />
      <Label text="Location" />
      <input className={input} placeholder="Building, floor, zone…" value={f.location} onChange={e => n('location', e.target.value)} />
      <Label text="Primary Lead" />
      <input className={input} placeholder="Full name" value={f.primaryLead} onChange={e => n('primaryLead', e.target.value)} />
      <Label text="Phone" />
      <input className={input} placeholder="+91 …" value={f.phone} onChange={e => n('phone', e.target.value)} />
      <p className="mt-4 rounded-lg bg-raised/60 px-3 py-2 text-xs text-mute">Assign members and record room materials after saving the room.</p>
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-line">
        <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
        <button type="submit" className={btnPrimary}>{isEdit ? 'Save Changes' : 'Add Room'}</button>
      </div>
    </form>
  );
};

// ── Confirm delete modal ──────────────────────────────────────────────────────
const ConfirmDelete: React.FC<{ name: string; onConfirm: () => void; onClose: () => void }> = ({ name, onConfirm, onClose }) => (
  <Modal title="Delete Control Room" onClose={onClose}>
    <div className="text-center py-4">
      <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
        <Trash2 size={22} className="text-red-400" />
      </div>
      <p className="text-sm text-ink mb-1">Are you sure you want to delete</p>
      <p className="text-base font-semibold text-ink mb-3">"{name}"?</p>
      <p className="text-xs text-mute mb-6">This action cannot be undone. All ops data for this room will be lost.</p>
      <div className="flex justify-center gap-3">
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button onClick={() => { onConfirm(); onClose(); }} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-all">
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  </Modal>
);

// ── Member assignment for a room (accordion) ─────────────────────────────────
interface Ops { members: Record<string, string[]>; invLoc: Record<string, string>; extras: Record<string, { id: string; name: string; qty: number }[]> }
const EMPTY_OPS: Ops = { members: {}, invLoc: {}, extras: {} };

// ── Main component ────────────────────────────────────────────────────────────
export const ControlRoomsApp: React.FC = () => {
  const { controlRooms, updateControlRoomStatus,
    addControlRoom, editControlRoom, deleteControlRoom } = useApp();
  const { sewadars } = useManpower();
  const inv = useInventory();
  const [ops, setOps] = useStore<Ops>('eitc_cr_ops', EMPTY_OPS);

  // UI state
  const [q, setQ] = useState('');
  const [expandId, setExpandId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<string | null>(null); // roomId open for ops editing
  const [addOpen, setAddOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<ControlRoom | null>(null);
  const [deleteRoom, setDeleteRoom] = useState<ControlRoom | null>(null);

  const patch = (f: (o: Ops) => Ops) => setOps(f(ops));
  const person = (id: string) => sewadars.find(s => s.id === id);
  const membersOf = (rid: string) => (ops.members[rid] || []).map(person).filter(Boolean) as typeof sewadars;
  const assignedElsewhere = (rid: string) => new Set(Object.entries(ops.members).filter(([k]) => k !== rid).flatMap(([, v]) => v));
  const heldAt = (rid: string) => { const loc = ops.invLoc[rid]; return loc ? inv.holdings.filter(h => h.location === loc && h.qty > 0) : []; };

  // Filter rooms
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return controlRooms;
    return controlRooms.filter(r =>
      r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t) || r.location.toLowerCase().includes(t) || r.primaryLead.toLowerCase().includes(t)
    );
  }, [controlRooms, q]);

  // Quick counts for temporary IT setups and their assigned resources.
  const operationalCount = controlRooms.filter(r => r.status === 'operational').length;
  const totalMembers = Object.values(ops.members).reduce((n, ids) => n + ids.length, 0);
  const totalMaterial = controlRooms.reduce((n, r) => n + heldAt(r.id).reduce((sum, h) => sum + h.qty, 0) + (ops.extras[r.id] || []).reduce((sum, e) => sum + e.qty, 0), 0);

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

      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Server, label: 'Setups', value: controlRooms.length, sub: `${operationalCount} active` },
          { icon: Users, label: 'Assigned members', value: totalMembers, sub: 'across all setups' },
          { icon: Boxes, label: 'Materials assigned', value: totalMaterial, sub: 'units linked / listed' },
        ].map(({ icon: I, label, value, sub }) => (
          <div key={label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-mute uppercase tracking-wide mb-1">
              <I size={12} className="text-blue-400" />{label}
            </div>
            <div className="text-lg font-bold text-ink tabular-nums">{value}</div>
            <div className="text-[10px] text-mute">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, code, location or lead…"
          className={input.replace('px-3', 'pl-10 pr-3')} />
      </div>

      {/* ── Rooms table / list ───────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-12 text-center">
          <Monitor size={40} className="mx-auto mb-3 text-mute opacity-40" />
          <p className="text-sm text-mute">{q ? 'No rooms match your search.' : 'No control rooms yet. Add one above.'}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-line bg-raised/50 text-[10px] font-semibold uppercase tracking-wider text-mute">
            <span>Temporary setup</span><span>Location / Lead</span><span>Members</span><span>Status</span><span></span>
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
                      <div className="flex items-center gap-1"><MapPin size={11} />{r.location}</div>
                      <div className="flex items-center gap-1 mt-0.5"><Users size={11} />{r.primaryLead}</div>
                      <div className="flex items-center gap-1 mt-0.5"><Phone size={11} />{r.phone}</div>
                    </div>
                    {/* Temporary team and room equipment summary */}
                    <div className="text-xs text-mute"><span className="text-ink font-semibold">{mem.length}</span> members<div className="mt-0.5">{held.length + extras.length} material types</div></div>
                    {/* Status */}
                    <div className="flex flex-col gap-1.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                        <cfg.icon size={11} />{cfg.label}
                      </span>
                      <button onClick={() => updateControlRoomStatus(r.id, r.status === 'alert' ? 'operational' : r.status === 'operational' ? 'alert' : 'operational')}
                        className="text-xs text-blue-400 hover:underline text-left">
                        {r.status === 'alert' ? 'Clear alert' : r.status === 'operational' ? 'Raise alert' : 'Set operational'}
                      </button>
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditRoom(r)} className="p-2 rounded-lg text-mute hover:bg-raised hover:text-blue-400 transition-colors" title="Edit room">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => setDeleteRoom(r)} className="p-2 rounded-lg text-mute hover:bg-raised hover:text-red-400 transition-colors" title="Delete room">
                        <Trash2 size={14} />
                      </button>
                      <button onClick={() => setExpandId(expanded ? null : r.id)}
                        className="p-2 rounded-lg text-mute hover:bg-raised hover:text-ink transition-colors" title={expanded ? 'Collapse' : 'View members and materials'}>
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
                            <span className="text-xs font-semibold text-mute uppercase tracking-wider flex items-center gap-1.5"><Users size={12} />Assigned Members ({mem.length})</span>
                            {!editing && <button onClick={() => setEditMode(r.id)} className="text-xs text-blue-400 hover:underline">+ Assign</button>}
                          </div>
                          {mem.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {mem.map(m => (
                                <span key={m.id} className="inline-flex items-center gap-1.5 text-xs bg-surface border border-line text-ink rounded-full pl-2.5 pr-1.5 py-1">
                                  <span className={`w-1.5 h-1.5 rounded-full ${m.arrival === 'arrived' ? 'bg-emerald-400' : 'bg-line-strong'}`} />
                                  {m.name}
                                  {editing && (
                                    <button aria-label={`Remove ${m.name}`} onClick={() => patch(o => ({ ...o, members: { ...o.members, [r.id]: (o.members[r.id] || []).filter(x => x !== m.id) } }))} className="p-0.5 rounded-full hover:bg-red-500/20 text-mute hover:text-red-400">
                                      <X size={11} />
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : <p className="text-xs text-mute">No members assigned.</p>}
                          {editing && (
                            <select className={input + ' mt-2 text-xs'} value="" aria-label="Add member"
                              onChange={e => { const id = e.target.value; if (id) patch(o => ({ ...o, members: { ...o.members, [r.id]: [...(o.members[r.id] || []), id] } })); }}>
                              <option value="">Add a member…</option>
                              {free.sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                                <option key={s.id} value={s.id}>{s.name} {s.department === 'control' ? '· Control' : ''}</option>
                              ))}
                            </select>
                          )}
                        </div>

                        {/* Equipment */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-mute uppercase tracking-wider flex items-center gap-1.5"><Boxes size={12} />Equipment ({held.length + extras.length})</span>
                          </div>
                          {held.length || extras.length ? (
                            <ul className="text-xs space-y-1.5">
                              {held.map(h => { const it = inv.items.find(x => x.id === h.itemId); return (<li key={h.itemId} className="flex justify-between gap-2"><span className="text-ink truncate">{it?.name || 'Item'}</span><span className="text-mute shrink-0">{h.qty} {it?.unit || ''}</span></li>); })}
                              {extras.map(x => (
                                <li key={x.id} className="flex justify-between gap-2 items-center">
                                  <span className="text-ink truncate">{x.name} <span className="text-faint">· other</span></span>
                                  <span className="text-mute shrink-0 inline-flex items-center gap-1">{x.qty}
                                    {editing && <button aria-label={`Remove ${x.name}`} onClick={() => patch(o => ({ ...o, extras: { ...o.extras, [r.id]: (o.extras[r.id] || []).filter(e => e.id !== x.id) } }))} className="p-0.5 rounded hover:bg-red-500/20 text-mute hover:text-red-400"><X size={11} /></button>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="text-xs text-mute">{ops.invLoc[r.id] ? 'Nothing issued yet.' : 'No inventory location linked.'}</p>}

                          {/* Inventory location linkage & extra add */}
                          {editing && (
                            <div className="mt-3 space-y-2">
                              <select className={input + ' text-xs'} value={ops.invLoc[r.id] || ''} aria-label="Inventory location"
                                onChange={e => patch(o => ({ ...o, invLoc: { ...o.invLoc, [r.id]: e.target.value } }))}>
                                <option value="">Link inventory location…</option>
                                {inv.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                              <ExtraAdd onAdd={(name, qty) => patch(o => ({ ...o, extras: { ...o.extras, [r.id]: [...(o.extras[r.id] || []), { id: 'x' + Date.now(), name, qty }] } }))} />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4 pt-3 border-t border-line">
                        {editing
                          ? <button onClick={() => setEditMode(null)} className={btnPrimary + ' !py-1.5 !text-xs'}><Check size={13} />Done</button>
                          : <button onClick={() => setEditMode(r.id)} className={btnGhost + ' !py-1.5 !text-xs'}><Edit3 size={13} />Edit Ops</button>
                        }
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-[10px] text-mute">
        <span className="flex items-center gap-1.5"><Activity size={12} className="text-blue-400" />{controlRooms.length} temporary setups · {operationalCount} active</span>
        <span>{totalMembers} members · {totalMaterial} material units assigned</span>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {addOpen && (
        <Modal title="Add Control Room" onClose={() => setAddOpen(false)}>
          <RoomForm initial={EMPTY_FORM} onSave={d => { addControlRoom(d); setAddOpen(false); }} onClose={() => setAddOpen(false)} />
        </Modal>
      )}
      {editRoom && (
        <Modal title={`Edit · ${editRoom.code}`} onClose={() => setEditRoom(null)}>
          <RoomForm initial={editRoom} onSave={d => { editControlRoom(editRoom.id, d); setEditRoom(null); }} onClose={() => setEditRoom(null)} isEdit />
        </Modal>
      )}
      {deleteRoom && <ConfirmDelete name={`${deleteRoom.code} — ${deleteRoom.name}`} onConfirm={() => deleteControlRoom(deleteRoom.id)} onClose={() => setDeleteRoom(null)} />}
    </div>
  );
};

// ── Extra equipment add widget ────────────────────────────────────────────────
const ExtraAdd: React.FC<{ onAdd: (name: string, qty: number) => void }> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const input2 = 'bg-field border border-line-strong rounded-xl px-3 py-2 text-xs text-ink placeholder-faint outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all';
  const add = () => { const q = Math.max(1, parseInt(qty, 10) || 1); if (!name.trim()) return; onAdd(name.trim(), q); setName(''); setQty('1'); };
  return (
    <div className="flex gap-2">
      <input className={input2 + ' flex-1'} placeholder="Other equipment…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
      <input className={input2 + ' w-16'} type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} aria-label="Qty" />
      <button onClick={add} className="px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors" aria-label="Add"><Plus size={14} /></button>
    </div>
  );
};
