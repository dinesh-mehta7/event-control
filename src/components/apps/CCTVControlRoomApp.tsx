import React, { useCallback, useEffect, useState } from 'react';
import { memberMeta } from '../../modules/manpower/memberMeta';
import { CalendarDays, Check, ChevronLeft, ChevronRight, MapPin, Monitor, Pencil, Plus, UserRoundPlus } from 'lucide-react';
import { useEventScope } from '../../context/EventScopeContext';
import { ClockTimePicker } from '../ClockTimePicker';
import { useManpower } from '../../modules/manpower';
import { useWalkie } from '../../modules/walkie';
import { supabase } from '../../modules/walkie/lib/supabaseClient';
import { useAccommodation } from '../../modules/accommodation';
import { digitsOnly, phoneInputProps } from '../../lib/phone';

type ShiftKey = string;
type Room = { id: string; name: string; location: string; pc_count: number; accommodation_room_id?: string | null };
type Duty = { id: string; room_id: string; shift_date: string; shift_key: ShiftKey; shift_label?: string; shift_start?: string | null; shift_end?: string | null; member_id: string | null; member_name: string; mobile: string; attendance_status: 'scheduled' | 'arrived' | 'absent'; checked_in_at: string | null };
type Shift = { key: ShiftKey; label: string; time: string; from: number; to: number; start: string; end: string };
const SHIFTS: Shift[] = [
  { key: 'morning', label: 'Morning', time: '9:00 AM – 12:00 PM', from: 9, to: 12, start: '09:00', end: '12:00' },
  { key: 'noon', label: 'Noon', time: '12:00 PM – 3:00 PM', from: 12, to: 15, start: '12:00', end: '15:00' },
  { key: 'evening', label: 'Evening', time: '3:00 PM – 6:00 PM', from: 15, to: 18, start: '15:00', end: '18:00' },
  { key: 'night', label: 'Night', time: '6:00 PM – 9:00 PM', from: 18, to: 21, start: '18:00', end: '21:00' },
];
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const uid = () => `crd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const field = 'h-10 w-full rounded-lg border border-line bg-field px-3 text-sm text-ink outline-none focus:border-blue-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-soft transition hover:bg-raised disabled:opacity-50';
const primary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50';
const timeLabel = (value: string) => { const [h, m] = value.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); };

export const CCTVControlRoomApp: React.FC = () => {
  const auth: any = useWalkie();
  const manpower = useManpower();
  const accommodation = useAccommodation();
  const eventScope = useEventScope();
  const organizationId = auth.currentUser?.organizationId;
  const eventId = eventScope.scopeFor('cctv-control-room') || null;
  const accommodationEventId = eventScope.scopeFor('accommodation') || null;
  const scopeKey = eventId || 'normal';
  const sub = auth.currentUser?.subDepartment;
  const level = auth.currentUser?.level;
  const canPlan = level === 'owner' || level === 'dept_head' || (level === 'sub_dept_head' && ['cctv', 'control'].includes(sub));
  const canOperate = canPlan || ['cctv', 'control'].includes(sub);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedDate, setSelectedDate] = useState(localDate);
  const [selectedShift, setSelectedShift] = useState<ShiftKey>('morning');
  const [specialStart, setSpecialStart] = useState('');
  const [specialEnd, setSpecialEnd] = useState('');
  const [specialTimeOpen, setSpecialTimeOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState('');
  const [location, setLocation] = useState('');
  const [pcCount, setPcCount] = useState('');
  const [accommodationRoomId, setAccommodationRoomId] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickAdd, setQuickAdd] = useState(!canPlan);
  const [memberId, setMemberId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestMobile, setGuestMobile] = useState('');
  const selectedRoom = rooms.find(room => room.id === selectedRoomId) || rooms[0];
  const linkedAccommodationRoom = accommodation.rooms.find(room => room.id === selectedRoom?.accommodation_room_id);
  const linkedMembers = linkedAccommodationRoom ? accommodation.membersInRoom(linkedAccommodationRoom.id) : [];

  useEffect(() => {
    if (eventId !== accommodationEventId) eventScope.setScopeFor('accommodation', eventId || '');
  }, [eventId, accommodationEventId, eventScope.setScopeFor]);

  useEffect(() => { const timer = window.setInterval(() => setClockNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [roomResult, dutyResult] = await Promise.all([
      supabase.from('cctv_control_rooms').select('*').eq('organization_id', organizationId).eq('event_scope_key', scopeKey).order('name'),
      supabase.from('cctv_control_room_duties').select('*').eq('organization_id', organizationId).eq('event_scope_key', scopeKey).eq('shift_date', selectedDate).order('created_at'),
    ]);
    if (roomResult.error || dutyResult.error) {
      setLoadError(`${(roomResult.error || dutyResult.error)?.message || 'Could not load room schedule.'} — run supabase/migration_v60_cctv_control_room_sewa.sql.`);
    } else {
      setLoadError('');
      const nextRooms = (roomResult.data || []) as Room[];
      setRooms(nextRooms); setDuties((dutyResult.data || []) as Duty[]);
      setSelectedRoomId(current => nextRooms.some(r => r.id === current) ? current : nextRooms[0]?.id || '');
    }
    setLoading(false);
  }, [organizationId, scopeKey, selectedDate]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase.channel(`cctv-control-sewa-${organizationId}-${scopeKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cctv_control_rooms', filter: `organization_id=eq.${organizationId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cctv_control_room_duties', filter: `organization_id=eq.${organizationId}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [organizationId, scopeKey, refresh]);

  const openRoomForm = (room?: Room) => {
    setEditingRoom(room || null); setRoomName(room?.name || ''); setLocation(room?.location || ''); setPcCount(String(room?.pc_count ?? '')); setAccommodationRoomId(room?.accommodation_room_id || ''); setRoomFormOpen(true);
  };
  const saveRoom = async (e: React.FormEvent) => {
    e.preventDefault(); if (!organizationId || !roomName.trim() || !location.trim()) return;
    setBusy(true);
    const payload = { name: roomName.trim(), location: location.trim(), pc_count: Math.max(0, Number(pcCount) || 0), accommodation_room_id: accommodationRoomId || null };
    const query = editingRoom
      ? supabase.from('cctv_control_rooms').update(payload).eq('id', editingRoom.id).select().single()
      : supabase.from('cctv_control_rooms').insert({ id: uid(), organization_id: organizationId, event_id: eventId, event_scope_key: scopeKey, ...payload }).select().single();
    const { data, error } = await query;
    setBusy(false);
    if (error) { auth.addToast?.(`Could not save control room: ${error.message}`, 'error'); return; }
    setRooms(current => [...current.filter(room => room.id !== data.id), data as Room].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedRoomId(data.id); setRoomFormOpen(false); auth.addToast?.('Control room saved.');
  };
  const deleteRoom = async () => {
    if (!selectedRoom || !window.confirm(`Remove control room ${selectedRoom.name} and its shift roster?`)) return;
    const { error } = await supabase.from('cctv_control_rooms').delete().eq('id', selectedRoom.id);
    if (error) auth.addToast?.(`Could not remove room: ${error.message}`, 'error'); else void refresh();
  };

  const addDuty = async (e: React.FormEvent) => {
    e.preventDefault(); if (!organizationId || !selectedRoom || !canOperate || (!quickAdd && !canPlan)) return;
    const member = manpower.sewadars.find(person => person.id === memberId);
    const name = quickAdd ? guestName.trim() : member?.name || '';
    if (!name) return;
    setBusy(true);
    const activeShift = visibleShifts.find(shift => shift.key === selectedShift);
    const row = { id: uid(), organization_id: organizationId, event_id: eventId, event_scope_key: scopeKey, room_id: selectedRoom.id, shift_date: selectedDate, shift_key: selectedShift, shift_label: activeShift?.label || 'Special', shift_start: activeShift?.start || null, shift_end: activeShift?.end || null, member_id: quickAdd ? null : member?.id || null, member_name: name, mobile: quickAdd ? guestMobile.trim() : member?.phone || '', attendance_status: 'scheduled', assigned_by: auth.currentUser?.name || '' };
    const { data, error } = await supabase.from('cctv_control_room_duties').insert(row).select().single();
    setBusy(false);
    if (error) { auth.addToast?.(`Could not add shift member: ${error.message}`, 'error'); return; }
    setDuties(current => [...current, data as Duty]); setMemberId(''); setGuestName(''); setGuestMobile(''); auth.addToast?.(`${name} added to ${activeShift?.label || 'Special'} shift.`);
  };
  const markAttendance = async (duty: Duty, status: Duty['attendance_status']) => {
    if (!canOperate) return;
    const checked_in_at = status === 'arrived' ? duty.checked_in_at || new Date().toISOString() : null;
    setDuties(current => current.map(row => row.id === duty.id ? { ...row, attendance_status: status, checked_in_at } : row));
    const { error } = await supabase.from('cctv_control_room_duties').update({ attendance_status: status, checked_in_at }).eq('id', duty.id);
    if (error) { auth.addToast?.(`Could not update attendance: ${error.message}`, 'error'); void refresh(); }
  };
  const removeDuty = async (duty: Duty) => {
    const { error } = await supabase.from('cctv_control_room_duties').delete().eq('id', duty.id);
    if (error) auth.addToast?.(`Could not remove shift member: ${error.message}`, 'error'); else setDuties(current => current.filter(row => row.id !== duty.id));
  };

  const roomDuties = duties.filter(d => d.room_id === selectedRoom?.id);
  const specialShifts: Shift[] = Array.from(new Set(roomDuties.filter(d => d.shift_key.startsWith('special-')).map(d => d.shift_key))).map(key => {
    const duty = roomDuties.find(d => d.shift_key === key)!;
    const start = duty.shift_start || '09:00'; const end = duty.shift_end || '12:00';
    const [fromHour, fromMinute] = start.split(':').map(Number); const [toHour, toMinute] = end.split(':').map(Number);
    return { key, label: duty.shift_label || 'Special', start, end, from: fromHour + fromMinute / 60, to: toHour + toMinute / 60, time: `${timeLabel(start)} – ${timeLabel(end)}` };
  });
  const draftSpecialKey = specialStart && specialEnd ? `special-${specialStart.replace(':', '')}-${specialEnd.replace(':', '')}` : '';
  const draftSpecial: Shift | null = draftSpecialKey && specialStart < specialEnd ? (() => { const [fh, fm] = specialStart.split(':').map(Number); const [th, tm] = specialEnd.split(':').map(Number); return { key: draftSpecialKey, label: 'Special', start: specialStart, end: specialEnd, from: fh + fm / 60, to: th + tm / 60, time: `${timeLabel(specialStart)} – ${timeLabel(specialEnd)}` }; })() : null;
  const savedSpecial = specialShifts.find(s => s.key === selectedShift) || specialShifts[0];
  const specialShift: Shift = draftSpecial || savedSpecial || { key: 'special-pending', label: 'Special', start: '', end: '', from: 0, to: 0, time: 'Choose custom time' };
  const visibleShifts = [...SHIFTS, specialShift];
  const activeShift = visibleShifts.find(s => s.key === selectedShift) || SHIFTS[0];
  const currentHour = clockNow.getHours() + clockNow.getMinutes() / 60;
  const currentShift = visibleShifts.find(s => currentHour >= s.from && currentHour < s.to)?.key || null;
  const shiftDuties = roomDuties.filter(d => d.shift_key === selectedShift);
  const getShift = (key: ShiftKey) => roomDuties.filter(d => d.shift_key === key);
  const presentCount = shiftDuties.filter(d => d.attendance_status === 'arrived').length;
  const currentShiftDuties = selectedDate === localDate() && currentShift ? getShift(currentShift) : [];
  const currentShiftPresent = currentShiftDuties.filter(d => d.attendance_status === 'arrived').length;
  const usedMemberIds = new Set(shiftDuties.map(d => d.member_id).filter(Boolean));

  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Monitor className="h-5 w-5 text-blue-400" />CCTV Control Room · Sewa management</h2><p className="mt-1 text-xs text-mute">Room locations, PC setup, shift assignments and on-site attendance for the selected event.</p></div>{canPlan && <button className={primary} onClick={() => openRoomForm()}><Plus className="h-4 w-4" />Add control room</button>}</header>
    {loadError && <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{loadError}</div>}
    {roomFormOpen && <form onSubmit={saveRoom} className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[1fr_1.4fr_8rem_1.2fr_auto_auto] sm:items-end"><label className="text-xs text-mute">Control room name<input required value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="CCTV Control Room 1" className={`${field} mt-1`} /></label><label className="text-xs text-mute">Location<input required value={location} onChange={e => setLocation(e.target.value)} placeholder="Building / floor / area" className={`${field} mt-1`} /></label><label className="text-xs text-mute">PCs<input type="number" min={0} value={pcCount} onChange={e => setPcCount(e.target.value)} placeholder="0" className={`${field} mt-1`} /></label><label className="text-xs text-mute">Accommodation room<select value={accommodationRoomId} onChange={e => setAccommodationRoomId(e.target.value)} className={`${field} mt-1`}><option value="">Not linked</option>{accommodation.rooms.filter(room => room.category === 'control_room').map(room => <option key={room.id} value={room.id}>{room.name}{room.block ? ` · ${room.block}` : ''}</option>)}</select></label><button disabled={busy} className={primary}>{busy ? 'Saving…' : 'Save room'}</button><button type="button" className={button} onClick={() => setRoomFormOpen(false)}>Cancel</button></form>}
    <div className="relative"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-mute">Select a control room</h3><span className="text-[11.5px] text-mute">{rooms.length} room{rooms.length === 1 ? '' : 's'}</span></div><div className="flex gap-2 overflow-x-auto pb-2">
      {rooms.map(room => <button key={room.id} onClick={() => setSelectedRoomId(room.id)} className={`min-w-52 shrink-0 rounded-xl border p-3 text-left transition ${room.id === selectedRoom?.id ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30' : 'border-line bg-surface hover:bg-raised'}`}><span className="block truncate text-sm font-semibold text-ink">{room.name}</span><span className="mt-1 flex items-center gap-1 truncate text-[11.5px] text-mute"><MapPin className="h-3 w-3 shrink-0" />{room.location}</span><span className="mt-2 inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-[10.5px] text-ink-soft"><Monitor className="h-3 w-3" />{room.pc_count} PCs</span></button>)}
      {!rooms.length && !loading && <div className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-mute">No CCTV control rooms have been added for this event yet.</div>}
      </div></div>
    {selectedRoom && <>
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3"><div className="min-w-0 flex-1"><div className="font-semibold text-ink">{selectedRoom.name}</div><div className="mt-0.5 flex items-center gap-1 text-xs text-mute"><MapPin className="h-3.5 w-3.5" />{selectedRoom.location}</div></div><div className="rounded-lg bg-raised px-3 py-2 text-center"><span className="block text-lg font-bold tabular-nums text-ink">{selectedRoom.pc_count}</span><span className="text-[10.5px] uppercase text-mute">PCs</span></div><div className="rounded-lg bg-raised px-3 py-2 text-center"><span className="block text-lg font-bold tabular-nums text-ink">{roomDuties.length}</span><span className="text-[10.5px] uppercase text-mute">Shift assignments</span></div><div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-center"><span className="block text-lg font-bold tabular-nums text-emerald-300">{currentShiftDuties.length}</span><span className="text-[10.5px] uppercase text-emerald-300">On shift now · {currentShiftPresent} arrived</span></div>{currentShiftDuties.length > selectedRoom.pc_count && <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10.5px] text-amber-300">Current shift has more members than PCs</span>}{canPlan && <><button className={button} onClick={() => openRoomForm(selectedRoom)}><Pencil className="h-3.5 w-3.5" />Edit room</button><button className={`${button} text-rose-300`} onClick={() => void deleteRoom()}>Remove</button></>}</section>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">Accommodation requirements</h3><p className="mt-1 text-[11.5px] text-mute">Materials and pickup locations shared from Accommodation.</p></div><span className="rounded-md bg-raised px-2 py-1 text-[10.5px] text-mute">{linkedAccommodationRoom ? linkedAccommodationRoom.name : 'Not linked'}</span></div>
          {!linkedAccommodationRoom ? <p className="mt-3 rounded-lg border border-dashed border-line p-4 text-xs text-mute">Link this Control Room to its Accommodation control-room entry using Edit room to sync its materials and assigned members.</p> : linkedAccommodationRoom.requirements.length ? <div className="mt-3 divide-y divide-line">{linkedAccommodationRoom.requirements.map((item, index) => <div key={`${item.name}-${index}`} className="flex flex-wrap items-center gap-2 py-2 text-xs"><span className="min-w-28 flex-1 font-medium text-ink">{item.name}</span><span className="text-mute">{item.readyQuantity}/{item.quantity} ready</span>{item.collectFrom && <span className="text-mute">From: {item.collectFrom}</span>}{item.returned && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">Returned</span>}</div>)}</div> : <p className="mt-3 text-xs text-mute">No materials requested in Accommodation yet.</p>}
        </div>
        <div className="rounded-xl border border-line bg-surface p-3"><h3 className="text-sm font-semibold text-ink">Accommodation members</h3><p className="mt-1 text-[11.5px] text-mute">Members assigned to the linked room, alongside this event’s shift roster.</p>{linkedAccommodationRoom ? <div className="mt-3 flex flex-wrap gap-1.5">{linkedMembers.length ? linkedMembers.map(member => <span key={member.id} className="rounded-md bg-raised px-2 py-1 text-xs text-ink-soft">{member.name}{memberMeta(member) ? ` · ${memberMeta(member)}` : ''}{member.department ? ` · ${member.department}` : ''}</span>) : <span className="text-xs text-mute">No members assigned to this Accommodation room.</span>}</div> : <p className="mt-3 text-xs text-mute">Link an Accommodation room to show its members here.</p>}</div>
      </section>
      <section className="space-y-3 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">Shift roster</h3><p className="mt-0.5 text-[11.5px] text-mute">Each shift is three hours; select one to see who is scheduled and who has arrived.</p></div><label className="flex items-center gap-2 text-xs text-mute"><CalendarDays className="h-4 w-4" />Date<input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="h-9 rounded-lg border border-line bg-field px-2 text-ink" /></label></div>
        <div className="flex gap-2 overflow-x-auto pb-1">{visibleShifts.map((shift, index) => { const isSpecial = index === visibleShifts.length - 1; const count = getShift(shift.key).length; const live = shift.key === currentShift && selectedDate === localDate(); return <button key={isSpecial ? 'special-shift-card' : shift.key} onClick={() => { if (isSpecial && canPlan) { const time = savedSpecial || draftSpecial; if (time?.start && time?.end) { setSpecialStart(time.start); setSpecialEnd(time.end); } setSpecialTimeOpen(true); } else setSelectedShift(shift.key); }} className={`min-w-[190px] flex-1 rounded-xl border p-3 text-left transition ${selectedShift === shift.key ? 'border-blue-500 bg-blue-500/10' : 'border-line bg-raised hover:bg-surface'}`}><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-ink">{shift.label}</span>{live && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">NOW</span>}</span><span className="mt-1 block text-[11.5px] text-mute">{shift.time}</span><span className="mt-2 block text-[11.5px] text-mute">{count} assigned · {getShift(shift.key).filter(d => d.attendance_status === 'arrived').length} arrived</span></button>; })}</div>
      </section>
      {specialTimeOpen && canPlan && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setSpecialTimeOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="special-shift-title" className="w-full max-w-md rounded-xl border border-line bg-surface p-4 shadow-2xl"><div className="mb-4"><h3 id="special-shift-title" className="text-base font-semibold text-ink">Special shift time</h3><p className="mt-1 text-xs text-mute">Choose when this custom shift starts and ends.</p></div><div className="grid grid-cols-2 gap-3">{[['Start', specialStart, setSpecialStart], ['End', specialEnd, setSpecialEnd]].map(([label, value, setter]: any) => <label key={label} className="min-w-0 text-xs text-mute">{label}<ClockTimePicker label={`Special shift ${String(label).toLowerCase()}`} value={value} onChange={setter} className="mt-1" /></label>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" className={button} onClick={() => setSpecialTimeOpen(false)}>Cancel</button><button type="button" className={primary} disabled={!draftSpecial} onClick={() => { if (draftSpecial) { setSelectedShift(draftSpecial.key); setSpecialTimeOpen(false); } }}>Use special shift</button></div></section></div>}
      {(canPlan || (canOperate && quickAdd)) && <form onSubmit={addDuty} className={`grid min-w-0 items-end gap-2 rounded-xl border border-line bg-surface p-3 ${quickAdd ? 'sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]' : canPlan ? 'sm:grid-cols-[auto_minmax(0,1fr)_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
        {canPlan && <div className="flex flex-wrap items-center gap-2"> <button type="button" className={`${button} h-10 whitespace-nowrap ${!quickAdd ? 'border-blue-500/40 text-blue-300' : ''}`} onClick={() => setQuickAdd(false)}>Roster member</button><button type="button" className={`${button} h-10 whitespace-nowrap ${quickAdd ? 'border-blue-500/40 text-blue-300' : ''}`} onClick={() => setQuickAdd(true)}><UserRoundPlus className="h-3.5 w-3.5" />On the spot</button></div>}
        {quickAdd ? <><label className="min-w-0 text-xs text-mute">Name<input required value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Person's name" className={`${field} mt-1`} /></label><label className="min-w-0 text-xs text-mute">Mobile (optional)<input {...phoneInputProps} value={guestMobile} onChange={e => setGuestMobile(digitsOnly(e.target.value))} placeholder="Mobile number" className={`${field} mt-1`} /></label></> : <label className="min-w-0 text-xs text-mute">Sewadar<select required value={memberId} onChange={e => setMemberId(e.target.value)} className={`${field} mt-1`}><option value="">Choose a member…</option>{manpower.sewadars.filter(person => !usedMemberIds.has(person.id)).map(person => <option key={person.id} value={person.id}>{person.name}{memberMeta(person) ? ` · ${memberMeta(person)}` : ''}{person.phone ? ` · ${person.phone}` : ''}</option>)}</select></label>}
        <button className={`${primary} h-10 whitespace-nowrap`} disabled={busy}><Plus className="h-4 w-4" />Add to {activeShift.label}</button>
      </form>}
      <section className="overflow-hidden rounded-xl border border-line bg-surface"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5"><div><h4 className="text-sm font-semibold text-ink">{activeShift.label} · {activeShift.time}</h4><p className="mt-0.5 text-[11.5px] text-mute">{selectedDate} · {shiftDuties.length} scheduled · {presentCount} arrived</p></div><div className="flex gap-1"><button className={button} aria-label="Previous shift" onClick={() => setSelectedShift(visibleShifts[(visibleShifts.findIndex(s => s.key === selectedShift) - 1 + visibleShifts.length) % visibleShifts.length].key)}><ChevronLeft className="h-4 w-4" /></button><button className={button} aria-label="Next shift" onClick={() => setSelectedShift(visibleShifts[(visibleShifts.findIndex(s => s.key === selectedShift) + 1) % visibleShifts.length].key)}><ChevronRight className="h-4 w-4" /></button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-raised text-[10.5px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-2">Member</th><th className="px-3 py-2">Mobile</th><th className="px-3 py-2">Shift</th><th className="px-3 py-2">Attendance</th><th className="px-3 py-2">Arrived at</th>{canPlan && <th className="px-3 py-2">Action</th>}</tr></thead><tbody className="divide-y divide-line">{shiftDuties.map(duty => <tr key={duty.id}><td className="px-3 py-2.5 font-medium text-ink">{duty.member_name}{(() => { const p = manpower.sewadars.find(x => x.id === duty.member_id); return p && memberMeta(p) ? <span className="block text-[10.5px] font-normal text-mute">{memberMeta(p)}</span> : null; })()}{!duty.member_id && <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">On the spot</span>}</td><td className="px-3 py-2.5 text-mute">{duty.mobile || '—'}</td><td className="px-3 py-2.5 text-mute">{duty.shift_label || SHIFTS.find(s => s.key === duty.shift_key)?.label || 'Special'}</td><td className="px-3 py-2.5">{canOperate ? <select aria-label={`Attendance for ${duty.member_name}`} value={duty.attendance_status} onChange={e => void markAttendance(duty, e.target.value as Duty['attendance_status'])} className="h-8 rounded-md border border-line bg-field px-2 text-ink"><option value="scheduled">Not marked</option><option value="arrived">Arrived</option><option value="absent">Not arrived</option></select> : duty.attendance_status === 'arrived' ? 'Arrived' : duty.attendance_status === 'absent' ? 'Not arrived' : 'Not marked'}</td><td className="px-3 py-2.5 text-mute">{duty.checked_in_at ? new Date(duty.checked_in_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'}</td>{canPlan && <td className="px-3 py-2.5"><button className="text-[11.5px] text-rose-300 hover:text-rose-200" onClick={() => void removeDuty(duty)}>Remove</button></td>}</tr>)}{!shiftDuties.length && <tr><td colSpan={canPlan ? 6 : 5} className="px-4 py-12 text-center text-mute">No members assigned to this shift yet.</td></tr>}</tbody></table></div></section>
    </>}
    {!selectedRoom && !loading && canPlan && <p className="text-xs text-mute">Add the first CCTV control room to set up its location, PCs, shifts and Sewa roster.</p>}
    {loading && <p className="text-xs text-mute">Loading control rooms and shifts…</p>}
  </div>;
};
