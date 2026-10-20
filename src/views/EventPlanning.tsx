import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Swap } from '../components/Swap';
import { memberMeta } from '../modules/manpower/memberMeta';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Plus,
  Radio,
  Users,
  Clipboard,
  CalendarClock,
  Trash2,
  UserRound,
  ClipboardCheck,
} from 'lucide-react';
import { useWalkie } from '../modules/walkie';
import { supabase } from '../modules/walkie/lib/supabaseClient';
import { useManpower } from '../modules/manpower';
import type { RoomRequirement } from '../modules/accommodation/types';
import { useEventScope } from '../context/EventScopeContext';
import { ClockTimePicker } from '../components/ClockTimePicker';
import { MeetingsList } from './meetings/MeetingsList';
import { DEPTS } from './orgData';
import * as XLSX from 'xlsx';
import {
  Attendance,
  BadgeOperation,
  DailyStaffingRequirement,
  EventFeedback,
  EventPlan,
  EventRadioRequest,
  RadioReturnReport,
  Requirement,
  Review,
} from './eventPlanning/types';
import { attendanceDayCount, localDay, shiftDay } from './eventPlanning/dates';

// Events already loaded this session, per organization, so coming back shows the workspace at once.
const eventsCache = new Map<string, any[]>();

const idFor = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const staffingCategoryKey = (value: string) => {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    Object.entries(DEPTS).find(([id, label]) =>
      [id, label].some(name => name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === normalized),
    )?.[0] || value
  );
};

const input =
  'w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none focus:border-blue-500';

const panel = 'rounded-xl border border-line bg-surface';

const action =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

const quiet =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-raised disabled:opacity-50';

const when = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const schemaError = (error: any) =>
  /does not exist|schema cache|could not find/i.test(error?.message || '')
    ? `${/collect_from_department|collect_from_location/i.test(error?.message || '') ? 'From department / location need supabase/migration_v88_requirement_source.sql.' : /event_radio_request_submit|p_collect_from|event_radio_requests.*collect_from/i.test(error?.message || '') ? 'Walkie-Talkie collection units need supabase/migration_v82_event_radio_collection_unit.sql.' : /room_requirements|accommodation_category|event_requirement_id|accommodation_rooms.*event_id/i.test(error?.message || '') ? 'Event accommodation syncing needs supabase/migration_v79_event_room_requirements.sql.' : /event_staffing_requirements|staffing_days|collect_from/i.test(error?.message || '') ? 'Event staffing and collection tracking need supabase/migration_v78_event_staffing_requirements.sql.' : 'Event planning needs its database setup. Run supabase/migration_v76_event_workflow_links.sql in the Supabase SQL Editor.'} Then reload this page.`
    : error?.message || 'Something went wrong. Please try again.';

const EVENT_SECTIONS = [
  {
    id: 'event-creation',
    label: 'Event Creation',
    description: 'Set up the event, choose its type, and select its calling list.',
    icon: CalendarDays,
  },
  {
    id: 'pre-event-meetings',
    label: 'Pre-Event Meetings',
    description: 'Schedule coordination meetings and capture minutes and action items.',
    icon: CalendarClock,
  },
  {
    id: 'requirement-management',
    label: 'Requirement Management',
    description: 'Collect unit requirements, set daily staffing, and track fulfilment.',
    icon: Clipboard,
  },
  {
    id: 'post-event-review',
    label: 'Post-Event Review',
    description: 'Review attendance, returns, lessons, and event closure.',
    icon: FileText,
  },
] as const;

export const EventPlanning: React.FC<{ section?: string }> = ({ section }) => {
  const w: any = useWalkie();
  const manpower = useManpower();
  const eventScope = useEventScope();
  const user = w.currentUser;
  const orgId = user?.organizationId as string | undefined;
  const authChecked = Boolean(w.authChecked);
  const canPlan = ['owner', 'dept_head'].includes(user?.level);
  const canMarkAttendance =
    canPlan || (user?.level === 'sub_dept_head' && ['sewadars', 'accommodation'].includes(user?.subDepartment));
  const departments: any[] = w.departments || [];
  const profileDepartmentId = String(user?.departmentId || '');
  const ownDepartment = departments.find(
    (department: any) => department.id === profileDepartmentId || department.id === user?.subDepartment,
  );
  const ownDepartmentId = ownDepartment?.id || '';
  const requirementDepartments =
    user?.level === 'owner'
      ? departments
      : ownDepartmentId
        ? departments.filter(department => department.id === ownDepartmentId)
        : [];
  // "From where": any organisation department or IT sub-department, plus a free-text location.
  const sourceDepartments = useMemo(
    () =>
      Array.from(new Set([...departments.map((d: any) => d.name).filter(Boolean), ...Object.values(DEPTS)])).sort(
        (a, b) => a.localeCompare(b),
      ),
    [departments],
  );
  const sourceLabel = (dept: string, place: string) => [dept.trim(), place.trim()].filter(Boolean).join(' · ');
  const [events, setEvents] = useState<EventPlan[]>(() => (orgId && eventsCache.get(orgId)) || []);
  const selectedId = eventScope.scopeFor('event-reports');
  const setSelectedId = (id: string) => eventScope.setScopeFor('event-reports', id);
  const selected = events.find(e => e.id === selectedId) || null;
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState('');
  const [loading, setLoading] = useState(() => !(orgId && eventsCache.has(orgId)));
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [eventForm, setEventForm] = useState<{
    name: string;
    location: string;
    date: string;
    time: string;
    ownerDepartmentId: string;
    type: 'monthly' | 'annual' | 'special';
    memberIds: string[];
  }>({ name: '', location: '', date: '', time: '', ownerDepartmentId: '', type: 'monthly', memberIds: [] });
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [roomRequirementDrafts, setRoomRequirementDrafts] = useState<Record<string, RoomRequirement[]>>({});
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [badgeOperations, setBadgeOperations] = useState<BadgeOperation[]>([]);
  const [radioReturns, setRadioReturns] = useState<RadioReturnReport[]>([]);
  const [eventRadioRequests, setEventRadioRequests] = useState<EventRadioRequest[]>([]);
  const [radioRequestForm, setRadioRequestForm] = useState({
    walkies: '1',
    chargers: '0',
    earphones: '0',
    fromDepartment: '',
    fromLocation: '',
  });
  const [staffingRequirements, setStaffingRequirements] = useState<DailyStaffingRequirement[]>([]);
  const [review, setReview] = useState<Review>({
    id: '',
    lessons_learned: '',
    issues_faced: '',
    recommendations: '',
    closure_report: '',
  });
  const [searchMembers, setSearchMembers] = useState('');
  const [today, setToday] = useState(() => localDay(new Date()));
  const [requirementForm, setRequirementForm] = useState({
    category: 'it',
    departmentId: '',
    inventoryItemId: '',
    title: '',
    quantity: '1',
    unit: '',
    notes: '',
    fromDepartment: '',
    fromLocation: '',
  });
  const [requirementCategory, setRequirementCategory] = useState('it');
  const [feedback, setFeedback] = useState<EventFeedback[]>([]);
  const [eventSearch, setEventSearch] = useState('');
  const [staffingDaysBefore, setStaffingDaysBefore] = useState(7);
  const [staffingDaysAfter, setStaffingDaysAfter] = useState(7);
  const [staffingSelectedDate, setStaffingSelectedDate] = useState('');
  const [staffingCellDrafts, setStaffingCellDrafts] = useState<Record<string, string>>({});
  const [staffingBusy, setStaffingBusy] = useState(false);
  const [roomDraft, setRoomDraft] = useState({ kind: 'rest_room', block: '', team: '' });
  const activeSection = EVENT_SECTIONS.some(item => item.id === section) ? section! : EVENT_SECTIONS[0].id;
  useEffect(() => {
    if (user?.level !== 'owner' && ownDepartmentId)
      setRequirementForm(current => ({ ...current, departmentId: ownDepartmentId }));
  }, [user?.level, ownDepartmentId]);

  const scopeForRef = useRef(eventScope.scopeFor);
  scopeForRef.current = eventScope.scopeFor;
  const loadEvents = useCallback(async () => {
    if (!orgId) {
      if (authChecked) {
        setError('Your account is not connected to an organization.');
        setLoading(false);
      }
      return;
    }
    // Only the very first load shows the loading screen; later refreshes keep the page on screen.
    if (!eventsCache.has(orgId)) setLoading(true);
    setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error: loadError } = await supabase
        .from('event_plans')
        .select(
          'id,name,location,starts_at,ends_at,owner_name,owner_department_id,status,event_type,special_member_ids,staffing_days_before,staffing_days_after',
        )
        .eq('organization_id', orgId)
        .order('starts_at', { ascending: false })
        .abortSignal(controller.signal);
      if (loadError) throw loadError;
      const list = (data || []) as EventPlan[];
      eventsCache.set(orgId, list);
      setEvents(list);
      const current = scopeForRef.current('event-reports');
      if (!list.some(e => e.id === current)) setSelectedId(list[0]?.id || '');
    } catch (loadError: any) {
      setError(
        controller.signal.aborted
          ? 'Loading events took too long. Check your connection and try again.'
          : schemaError(loadError),
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [orgId, authChecked]); // eslint-disable-line react-hooks/exhaustive-deps -- picking an event must not reload the list

  const loadDetails = useCallback(
    async (eventId: string) => {
      if (!orgId || !eventId) return;
      const results = await Promise.all([
        supabase
          .from('event_attendance')
          .select('*')
          .eq('organization_id', orgId)
          .eq('event_id', eventId)
          .order('member_name'),
        supabase.from('event_reviews').select('*').eq('organization_id', orgId).eq('event_id', eventId).maybeSingle(),
        supabase
          .from('event_radio_requests')
          .select(
            'id,department_name,returned_walkies,returned_chargers,returned_earphones,returned_at,return_feedback,status,updated_at',
          )
          .eq('organization_id', orgId)
          .eq('event_id', eventId)
          .in('status', ['partial_return', 'returned'])
          .order('updated_at', { ascending: false }),
        supabase
          .from('sewadar_event_operations')
          .select('id,member_id,badge_issued,badge_at,badge_returned,badge_returned_at,arrival_status,arrived_at')
          .eq('organization_id', orgId)
          .eq('event_id', eventId),
        supabase
          .from('member_issues')
          .select('id,kind,title,details,reporter_name,sub_department,status,created_at')
          .eq('organization_id', orgId)
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        supabase
          .from('event_radio_requests')
          .select('id,department_name,collect_from,walkie_count,charger_count,earphone_count,status,created_at')
          .eq('organization_id', orgId)
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
      ]);
      const operationsResult = results[3];
      if (operationsResult.error) {
        setError(
          `${operationsResult.error.message} — run supabase/migration_v58_event_scoped_member_operations.sql, then reload the schema.`,
        );
        return;
      }
      const failed = results
        .slice(0, 3)
        .concat([results[4], results[5]])
        .find(r => r.error);
      if (failed?.error) {
        setError(schemaError(failed.error));
        return;
      }
      setAttendance((results[0].data || []) as Attendance[]);
      setReview(
        (results[1].data as Review) || {
          id: '',
          lessons_learned: '',
          issues_faced: '',
          recommendations: '',
          closure_report: '',
        },
      );
      setRadioReturns((results[2].data || []) as RadioReturnReport[]);
      setBadgeOperations((results[3].data || []) as BadgeOperation[]);
      setFeedback((results[4].data || []) as EventFeedback[]);
      setEventRadioRequests((results[5].data || []) as EventRadioRequest[]);
      const [requirementRows, staffingRows] = await Promise.all([
        supabase
          .from('event_requirements')
          .select('*')
          .eq('organization_id', orgId)
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        supabase
          .from('event_staffing_requirements')
          .select('*')
          .eq('organization_id', orgId)
          .eq('event_id', eventId)
          .order('requirement_date'),
      ]);
      const workflowError = [requirementRows, staffingRows].find(result => result.error);
      if (workflowError?.error) {
        setError(schemaError(workflowError.error));
        return;
      }
      setRequirements((requirementRows.data || []) as Requirement[]);
      setStaffingRequirements((staffingRows.data || []) as DailyStaffingRequirement[]);
    },
    [orgId],
  );

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    if (!selectedId) return;
    for (const module of ['sewadars', 'accommodation', 'control'])
      if (eventScope.scopeFor(module) !== selectedId) eventScope.setScopeFor(module, selectedId);
  }, [selectedId, eventScope.scopeFor, eventScope.setScopeFor]);
  useEffect(() => {
    if (selected) {
      setStaffingDaysBefore(selected.staffing_days_before ?? 7);
      setStaffingDaysAfter(selected.staffing_days_after ?? 7);
    }
  }, [selected?.id]);
  useEffect(() => {
    if (selectedId) void loadDetails(selectedId);
  }, [selectedId, loadDetails]);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDay(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!orgId || !selectedId) return;
    const channel = supabase
      .channel(`event-report-${selectedId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_radio_requests', filter: `organization_id=eq.${orgId}` },
        (payload: any) => {
          if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId)
            void loadDetails(selectedId);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_attendance', filter: `organization_id=eq.${orgId}` },
        (payload: any) => {
          if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId)
            void loadDetails(selectedId);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sewadar_event_operations', filter: `organization_id=eq.${orgId}` },
        (payload: any) => {
          if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId)
            void loadDetails(selectedId);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_staffing_requirements', filter: `organization_id=eq.${orgId}` },
        (payload: any) => {
          if (payload.new?.event_id === selectedId || payload.old?.event_id === selectedId)
            void loadDetails(selectedId);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, selectedId, loadDetails]);

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !eventForm.name.trim() || !eventForm.date || !eventForm.time) return;
    setBusy(true);
    setError('');
    const eventId = idFor('event');
    const startsAt = new Date(`${eventForm.date}T${eventForm.time}`).toISOString();
    const ownerDepartment = departments.find(department => department.id === eventForm.ownerDepartmentId);
    const { error: createError } = await supabase.from('event_plans').insert({
      id: eventId,
      organization_id: orgId,
      name: eventForm.name.trim(),
      location: eventForm.location.trim(),
      starts_at: startsAt,
      ends_at: null,
      owner_name: ownerDepartment?.name || '',
      owner_department_id: ownerDepartment?.id || null,
      event_type: eventForm.type,
      special_member_ids: eventForm.type === 'special' ? eventForm.memberIds : [],
      staffing_days_before: staffingDaysBefore,
      staffing_days_after: staffingDaysAfter,
    });
    if (createError) {
      setError(schemaError(createError));
      setBusy(false);
      return;
    }
    setBusy(false);
    setShowCreate(false);
    setSelectedId(eventId);
    await eventScope.refreshEvents();
    await loadEvents();
  };

  const updateEvent = async (patch: Partial<EventPlan>) => {
    if (!selected || !orgId || !canPlan) return;
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase
      .from('event_plans')
      .update(patch)
      .eq('id', selected.id)
      .eq('organization_id', orgId);
    if (updateError) setError(schemaError(updateError));
    else setEvents(old => old.map(e => (e.id === selected.id ? { ...e, ...patch } : e)));
    setBusy(false);
  };

  const updateEventStatus = async (event: EventPlan, status: string) => {
    if (!orgId || !canPlan) return;
    setStatusBusyId(event.id);
    setError('');
    const { error: updateError } = await supabase
      .from('event_plans')
      .update({ status })
      .eq('id', event.id)
      .eq('organization_id', orgId);
    if (updateError) setError(schemaError(updateError));
    else setEvents(old => old.map(row => (row.id === event.id ? { ...row, status } : row)));
    setStatusBusyId('');
  };

  const addRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !requirementForm.title.trim()) return;
    const isAccommodation = requirementCategory === 'accommodation';
    if (isAccommodation && roomDraft.kind === 'control_room' && !roomDraft.team) {
      setError('Choose the Sewadar team responsible for this control room.');
      return;
    }
    const department = departments.find(d => d.id === requirementForm.departmentId);
    const requirementId = idFor('event-req');
    setBusy(true);
    setError('');
    const roomItems: RoomRequirement[] = [];
    const payload: any = {
      id: requirementId,
      organization_id: orgId,
      event_id: selected.id,
      category: requirementCategory,
      inventory_item_id: null,
      department_id: isAccommodation ? null : department?.id || null,
      department_name: isAccommodation ? '' : department?.name || '',
      title: requirementForm.title.trim(),
      quantity: Math.max(isAccommodation ? 1 : 0, Number(requirementForm.quantity) || 0),
      unit: isAccommodation ? (roomDraft.kind === 'rest_room' ? 'beds' : 'seats') : requirementForm.unit.trim(),
      notes: isAccommodation ? '' : requirementForm.notes.trim(),
      collect_from: isAccommodation ? '' : sourceLabel(requirementForm.fromDepartment, requirementForm.fromLocation),
      collect_from_department: isAccommodation ? '' : requirementForm.fromDepartment.trim(),
      collect_from_location: isAccommodation ? '' : requirementForm.fromLocation.trim(),
    };
    if (isAccommodation) {
      payload.accommodation_category = roomDraft.kind;
      payload.room_requirements = roomItems;
    }
    const { error: saveError } = await supabase.from('event_requirements').insert(payload);
    if (saveError) setError(schemaError(saveError));
    else {
      if (isAccommodation) {
        const roomId = idFor('room');
        const { error: roomError } = await supabase.from('accommodation_rooms').insert({
          id: roomId,
          organization_id: orgId,
          event_id: selected.id,
          event_requirement_id: requirementId,
          name: requirementForm.title.trim(),
          category: roomDraft.kind,
          block: roomDraft.block.trim(),
          capacity: Math.max(1, Number(requirementForm.quantity) || 1),
          notes: '',
          responsible_team: roomDraft.kind === 'control_room' ? roomDraft.team : '',
          requirements_by_scope: { [selected.id]: roomItems },
          readiness_by_scope: { [selected.id]: {} },
        });
        if (roomError) {
          await supabase.from('event_requirements').delete().eq('id', requirementId).eq('organization_id', orgId);
          setError(`${schemaError(roomError)} The room was not saved.`);
          setBusy(false);
          return;
        }
      }
      setRequirementForm({
        category: requirementCategory,
        departmentId: ownDepartmentId,
        inventoryItemId: '',
        title: '',
        quantity: '1',
        unit: '',
        notes: '',
        fromDepartment: '',
        fromLocation: '',
      });
      setRoomDraft({ kind: 'rest_room', block: '', team: '' });
      await loadDetails(selected.id);
    }
    setBusy(false);
  };

  const addWalkieRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !canPlan) return;
    if (user?.level === 'owner' && !user?.departmentId) {
      setError('Assign this account to a department before sending an event radio request.');
      return;
    }
    const walkies = Number(radioRequestForm.walkies);
    const chargers = Number(radioRequestForm.chargers);
    const earphones = Number(radioRequestForm.earphones);
    const radioFrom = sourceLabel(radioRequestForm.fromDepartment, radioRequestForm.fromLocation);
    if (!radioFrom) {
      setError('Choose the department or enter the location to collect the radios from.');
      return;
    }
    if (![walkies, chargers, earphones].every(value => Number.isInteger(value) && value >= 0) || walkies < 1) {
      setError('Enter whole-number quantities and request at least one walkie-talkie.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: requestError } = await supabase.rpc('event_radio_request_submit', {
      p_event_id: selected.id,
      p_walkies: walkies,
      p_chargers: chargers,
      p_earphones: earphones,
      p_collect_from: radioFrom,
    });
    if (requestError) setError(schemaError(requestError));
    else {
      setRadioRequestForm({ walkies: '1', chargers: '0', earphones: '0', fromDepartment: '', fromLocation: '' });
      await loadDetails(selected.id);
    }
    setBusy(false);
  };

  const roomNecessities = (item: Requirement) => roomRequirementDrafts[item.id] ?? item.room_requirements ?? [];
  const addRoomNecessity = (item: Requirement) =>
    setRoomRequirementDrafts(old => ({
      ...old,
      [item.id]: [
        ...(old[item.id] ?? item.room_requirements ?? []),
        { name: '', quantity: 1, readyQuantity: 0, collectFrom: '', returned: false },
      ],
    }));
  const editRoomNecessity = (item: Requirement, index: number, patch: Partial<RoomRequirement>) =>
    setRoomRequirementDrafts(old => {
      const rows = old[item.id] ?? item.room_requirements ?? [];
      return { ...old, [item.id]: rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)) };
    });
  const removeRoomNecessity = (item: Requirement, index: number) =>
    setRoomRequirementDrafts(old => {
      const rows = old[item.id] ?? item.room_requirements ?? [];
      return { ...old, [item.id]: rows.filter((_, rowIndex) => rowIndex !== index) };
    });
  const saveRoomNecessities = async (item: Requirement) => {
    if (!selected || !orgId || !canPlan) return;
    const cleaned = roomNecessities(item)
      .map(row => {
        const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
        return {
          ...row,
          name: row.name.trim(),
          quantity,
          readyQuantity: Math.min(quantity, Math.max(0, Math.floor(Number(row.readyQuantity) || 0))),
          collectFrom: (row.collectFrom || '').trim(),
          returned: Boolean(row.returned),
        };
      })
      .filter(row => row.name);
    setBusy(true);
    setError('');
    const { data: room, error: lookupError } = await supabase
      .from('accommodation_rooms')
      .select('id')
      .eq('organization_id', orgId)
      .eq('event_id', selected.id)
      .eq('event_requirement_id', item.id)
      .single();
    if (lookupError || !room) {
      setError(schemaError(lookupError || { message: 'Room record not found.' }));
      setBusy(false);
      return;
    }
    const { error: rpcError } = await supabase.rpc('accommodation_update_room_requirements', {
      p_room_id: room.id,
      p_scope_key: selected.id,
      p_requirements: cleaned,
    });
    if (rpcError) {
      setError(schemaError(rpcError));
      setBusy(false);
      return;
    }
    const { error: updateError } = await supabase
      .from('event_requirements')
      .update({ room_requirements: cleaned })
      .eq('id', item.id)
      .eq('organization_id', orgId);
    if (updateError)
      setError(
        `Room necessities were saved, but the requirement list could not be refreshed: ${schemaError(updateError)}`,
      );
    setRequirements(old => old.map(row => (row.id === item.id ? { ...row, room_requirements: cleaned } : row)));
    setRoomRequirementDrafts(old => ({ ...old, [item.id]: cleaned }));
    setBusy(false);
  };

  const deleteRequirement = async (item: Requirement) => {
    if (!selected || !orgId || !canPlan) return;
    setBusy(true);
    setError('');
    const { error: deleteError } = await supabase
      .from('event_requirements')
      .delete()
      .eq('id', item.id)
      .eq('organization_id', orgId);
    if (deleteError) setError(schemaError(deleteError));
    else setRequirements(old => old.filter(row => row.id !== item.id));
    setBusy(false);
  };

  const saveStaffingCell = async (date: string, category: string, rawValue: string) => {
    if (!selected || !orgId || !canPlan) return;
    const key = `${date}:${category}`;
    const existing = staffingRequirements.find(
      row => row.requirement_date === date && staffingCategoryKey(row.category) === category,
    );
    setError('');
    if (!rawValue.trim()) {
      if (existing) {
        setStaffingBusy(true);
        const { error: deleteError } = await supabase
          .from('event_staffing_requirements')
          .delete()
          .eq('id', existing.id)
          .eq('organization_id', orgId);
        if (deleteError) setError(schemaError(deleteError));
        else setStaffingRequirements(old => old.filter(row => row.id !== existing.id));
        setStaffingBusy(false);
      }
      setStaffingCellDrafts(old => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      return;
    }
    const row = {
      id: existing?.id || idFor('staffing-req'),
      organization_id: orgId,
      event_id: selected.id,
      requirement_date: date,
      category,
      required_count: Math.max(0, Math.floor(Number(rawValue) || 0)),
      notes: existing?.notes || '',
      updated_at: new Date().toISOString(),
    };
    setStaffingBusy(true);
    const query = existing
      ? supabase.from('event_staffing_requirements').update(row).eq('id', existing.id)
      : supabase.from('event_staffing_requirements').insert(row);
    const { data, error: saveError } = await query.select('*').single();
    if (saveError) setError(schemaError(saveError));
    else
      setStaffingRequirements(old =>
        [
          ...old.filter(item => !(item.requirement_date === date && staffingCategoryKey(item.category) === category)),
          data as DailyStaffingRequirement,
        ].sort((a, b) => a.requirement_date.localeCompare(b.requirement_date) || a.category.localeCompare(b.category)),
      );
    setStaffingBusy(false);
    setStaffingCellDrafts(old => {
      const next = { ...old };
      if (saveError) next[key] = rawValue;
      else delete next[key];
      return next;
    });
  };

  const updateRequirementStatus = async (item: Requirement, status: Requirement['status']) => {
    if (!orgId || !canPlan) return;
    setBusy(true);
    setError('');
    const { error: saveError } = await supabase
      .from('event_requirements')
      .update({ status })
      .eq('id', item.id)
      .eq('organization_id', orgId);
    if (saveError) setError(schemaError(saveError));
    else setRequirements(old => old.map(row => (row.id === item.id ? { ...row, status } : row)));
    setBusy(false);
  };

  const setMemberAttendance = async (
    member: (typeof manpower.sewadars)[number],
    current: Attendance | undefined,
    next: 'present' | 'checked_out' | 'absent',
  ) => {
    if (!selected || !orgId || !canMarkAttendance) return;
    const now = new Date().toISOString();
    const row = {
      id: current?.id || idFor('attendance'),
      organization_id: orgId,
      event_id: selected.id,
      member_id: member.id,
      member_name: member.name,
      status: next,
      checked_in_at: next === 'present' ? current?.checked_in_at || now : current?.checked_in_at || null,
      checked_out_at: next === 'checked_out' ? now : null,
      notes: current?.notes || '',
    };
    setBusy(true);
    setError('');
    const { error: saveError } = await supabase
      .from('event_attendance')
      .upsert(row, { onConflict: 'event_id,member_id' });
    if (saveError) setError(schemaError(saveError));
    else await loadDetails(selected.id);
    setBusy(false);
  };

  const saveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !orgId || !canPlan) return;
    setBusy(true);
    setError('');
    const { error: saveError } = await supabase.from('event_reviews').upsert(
      {
        id: review.id || idFor('event-review'),
        organization_id: orgId,
        event_id: selected.id,
        lessons_learned: review.lessons_learned,
        issues_faced: review.issues_faced,
        recommendations: review.recommendations,
        closure_report: review.closure_report,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_id' },
    );
    if (saveError) setError(schemaError(saveError));
    else await loadDetails(selected.id);
    setBusy(false);
  };

  const attendanceByMember = useMemo(() => new Map(attendance.map(a => [a.member_id, a])), [attendance]);
  const badgeByMember = useMemo(() => new Map(badgeOperations.map(op => [op.member_id, op])), [badgeOperations]);
  const setBadgeState = async (memberId: string, change: 'issue' | 'return') => {
    if (!selected || !orgId || !canMarkAttendance) return;
    setBusy(true);
    setError('');
    const { data: existing, error: readError } = await supabase
      .from('sewadar_event_operations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('event_scope_key', selected.id)
      .eq('member_id', memberId)
      .maybeSingle();
    if (readError) {
      setError(schemaError(readError));
      setBusy(false);
      return;
    }
    const now = new Date().toISOString();
    const row = {
      id: existing?.id || idFor('sewadar-op'),
      organization_id: orgId,
      event_id: selected.id,
      event_scope_key: selected.id,
      member_id: memberId,
      arrival_status: existing?.arrival_status || 'pending',
      arrived_at: existing?.arrived_at || null,
      badge_issued: change === 'issue' ? true : existing?.badge_issued || false,
      badge_at: change === 'issue' ? existing?.badge_at || now : existing?.badge_at || null,
      badge_returned: change === 'return' ? true : existing?.badge_returned || false,
      badge_returned_at: change === 'return' ? now : existing?.badge_returned_at || null,
      updated_at: now,
    };
    const { error: saveError } = await supabase
      .from('sewadar_event_operations')
      .upsert(row, { onConflict: 'organization_id,event_scope_key,member_id' });
    if (saveError) setError(schemaError(saveError));
    else await loadDetails(selected.id);
    setBusy(false);
  };
  const eventMembers = useMemo(() => {
    const eligible = manpower.sewadars.filter(member => member.memberType !== 'salary_based');
    const type = selected?.event_type || 'annual';
    const roster =
      type === 'monthly'
        ? eligible.filter(member => member.memberType === 'monthly')
        : type === 'special'
          ? eligible.filter(member => (selected?.special_member_ids || []).includes(member.id))
          : eligible;
    const query = searchMembers.trim().toLowerCase();
    return roster.filter(s => `${s.name} ${s.phone} ${s.teamName} ${s.batchNo}`.toLowerCase().includes(query));
  }, [manpower.sewadars, searchMembers, selected]);
  const downloadAttendance = () => {
    if (!selected) return;
    const rows = [
      [
        'Event',
        'Sewadar',
        'Phone',
        'Team',
        'Status',
        'Arrived at',
        'Returned back',
        'Badge',
        'Badge returned at',
        'Attendance days',
        'Notes',
      ],
      ...eventMembers.map(member => {
        const record = attendanceByMember.get(member.id);
        const status =
          record?.status === 'present'
            ? 'Here now'
            : record?.status === 'checked_out'
              ? 'Returned back'
              : record?.status === 'absent'
                ? 'Absent'
                : 'Expected';
        const badge = badgeByMember.get(member.id);
        return [
          selected.name,
          member.name,
          member.phone || '',
          member.teamName || '',
          status,
          record?.checked_in_at ? new Date(record.checked_in_at).toLocaleString('en-IN') : '',
          record?.checked_out_at ? new Date(record.checked_out_at).toLocaleString('en-IN') : '',
          badge?.badge_returned ? 'Returned' : badge?.badge_issued ? 'Issued' : 'Not issued',
          badge?.badge_returned_at ? new Date(badge.badge_returned_at).toLocaleString('en-IN') : '',
          record ? attendanceDayCount(record, today) : 0,
          record?.notes || '',
        ];
      }),
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${
      selected.name
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'event'
    }-attendance.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const attendanceStats = useMemo(
    () => ({
      active: attendance.filter(a => a.status === 'present').length,
      returned: attendance.filter(a => a.status === 'checked_out').length,
      absent: attendance.filter(a => a.status === 'absent').length,
      days: attendance.reduce((sum, a) => sum + attendanceDayCount(a, today), 0),
    }),
    [attendance, today],
  );
  const eventRoster = useMemo(() => {
    const eligible = manpower.sewadars.filter(member => member.memberType !== 'salary_based');
    if (selected?.event_type === 'monthly') return eligible.filter(member => member.memberType === 'monthly');
    if (selected?.event_type === 'special')
      return eligible.filter(member => (selected.special_member_ids || []).includes(member.id));
    return eligible;
  }, [manpower.sewadars, selected]);
  const staffingDates = useMemo(() => {
    if (!selected) return [] as string[];
    const eventDate = localDay(selected.starts_at);
    return Array.from({ length: staffingDaysBefore + staffingDaysAfter + 1 }, (_, index) =>
      shiftDay(eventDate, index - staffingDaysBefore),
    );
  }, [selected, staffingDaysBefore, staffingDaysAfter]);
  useEffect(() => {
    if (selected && !staffingDates.includes(staffingSelectedDate))
      setStaffingSelectedDate(localDay(selected.starts_at));
  }, [selected?.id, staffingDates.join('|')]);
  const visibleEvents = useMemo(
    () =>
      events
        .filter(event =>
          `${event.name} ${event.location} ${event.owner_name} ${event.status}`
            .toLowerCase()
            .includes(eventSearch.trim().toLowerCase()),
        )
        .sort((a, b) => {
          const rank = (status: string) =>
            status === 'live' ? 0 : ['planning', 'ready'].includes(status) ? 1 : status === 'complete' ? 2 : 3;
          return (
            rank(a.status) - rank(b.status) ||
            (rank(a.status) === 1
              ? new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
              : new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
          );
        }),
    [events, eventSearch],
  );
  const scopedRequirements = useMemo(
    () =>
      requirements.filter(
        item =>
          item.category === 'accommodation' ||
          user?.level === 'owner' ||
          (!!ownDepartmentId && item.department_id === ownDepartmentId),
      ),
    [requirements, user?.level, ownDepartmentId],
  );
  const visibleRequirements = useMemo(
    () => scopedRequirements.filter(item => item.category === requirementCategory),
    [scopedRequirements, requirementCategory],
  );
  const exportEvents = () => {
    const rows = events.map(event => ({
      'Event name': event.name,
      Location: event.location,
      'Date & time': new Date(event.starts_at).toLocaleString('en-IN'),
      'Event owner (department)':
        departments.find(department => department.id === event.owner_department_id)?.name || event.owner_name,
      Type: event.event_type || 'annual',
      Status: event.status,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Event name': 'No events' }]),
      'Events',
    );
    XLSX.writeFile(workbook, 'event-list.xlsx');
  };
  // ---- Requirement downloads: every field, for the whole event or a single requirement ----------------
  const CATEGORY_LABEL: Record<string, string> = {
    it: 'IT',
    sewadar: 'Sewadar',
    inventory: 'Inventory',
    accommodation: 'Accommodation',
    other: 'Other',
  };
  const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN') : '');
  const requirementRow = (row: Requirement) => {
    const needs = row.room_requirements || [];
    return {
      'Requirement ID': row.id,
      'Event name': selected?.name || '',
      'Event location': selected?.location || '',
      'Event starts': when(selected?.starts_at),
      'Event ends': when(selected?.ends_at),
      Category: CATEGORY_LABEL[row.category] || row.category,
      'Requirement / room': row.title,
      'Responsible unit': row.department_name || (row.category === 'accommodation' ? '' : 'Unassigned'),
      'Responsible unit ID': row.department_id || '',
      Quantity: row.quantity,
      Unit: row.unit,
      'Specifications / notes': row.notes,
      'From department': row.collect_from_department || '',
      'From location': row.collect_from_location || (!row.collect_from_department ? row.collect_from || '' : ''),
      'From (combined)': row.collect_from || '',
      Status: row.status.replace(/_/g, ' '),
      'Room category': row.accommodation_category ? row.accommodation_category.replace('_', ' ') : '',
      'Room necessities': needs.length,
      'Necessities ready': needs.filter(n => n.quantity > 0 && n.readyQuantity >= n.quantity).length,
      'Inventory item ID': row.inventory_item_id || '',
      'Created at': when(row.created_at),
    };
  };
  const necessityRows = (rows: Requirement[]) =>
    rows.flatMap(row =>
      (row.room_requirements || []).map((n, i) => ({
        'Requirement ID': row.id,
        Room: row.title,
        'Room category': (row.accommodation_category || '').replace('_', ' '),
        '#': i + 1,
        Necessity: n.name,
        Needed: n.quantity,
        Ready: n.readyQuantity,
        'Still needed': Math.max(0, n.quantity - n.readyQuantity),
        'Collect from': n.collectFrom || '',
        Returned: n.returned ? 'Yes' : 'No',
      })),
    );
  // Split "Department · Location" (radio requests and older entries keep one combined value).
  const splitFrom = (combined: string) => {
    const [a, ...rest] = (combined || '').split(' · ');
    return rest.length ? { dept: a, place: rest.join(' · ') } : { dept: '', place: a || '' };
  };
  const mainRows = (rows: Requirement[], radio: any[] = []) =>
    [
      ...rows.flatMap(row => {
        const base = { 'Event name': selected?.name || '', Category: CATEGORY_LABEL[row.category] || row.category };
        if (row.category === 'accommodation') {
          const needs = row.room_requirements || [];
          if (!needs.length)
            return [
              {
                ...base,
                'Requirement / room': row.title,
                'Required item': '—',
                Quantity: row.quantity,
                Unit: row.unit,
                'From department': '',
                'From location': '',
              },
            ];
          return needs.map(n => ({
            ...base,
            'Requirement / room': row.title,
            'Required item': n.name,
            Quantity: n.quantity,
            Unit: '',
            'From department': '',
            'From location': n.collectFrom || '',
          }));
        }
        const legacy = row.collect_from_department ? null : splitFrom(row.collect_from || '');
        return [
          {
            ...base,
            'Requirement / room': row.title,
            'Required item': row.title,
            Quantity: row.quantity,
            Unit: row.unit,
            'From department': row.collect_from_department || legacy?.dept || '',
            'From location': row.collect_from_location || legacy?.place || '',
          },
        ];
      }),
      ...radio.flatMap((r: any) => {
        const from = splitFrom(r.collect_from || '');
        const base = {
          'Event name': selected?.name || '',
          Category: 'Walkie-Talkie',
          'Requirement / room': `Radio request · ${r.department_name || 'Department'}`,
          'From department': from.dept,
          'From location': from.place,
        };
        return (
          [
            ['Walkie-talkies', r.walkie_count],
            ['Chargers', r.charger_count],
            ['Earphones', r.earphone_count],
          ] as const
        )
          .filter(([, n]) => Number(n) > 0)
          .map(([item, n]) => ({ ...base, 'Required item': item, Quantity: n, Unit: 'pcs' }));
      }),
    ].map(r => ({
      'Event name': r['Event name'],
      Category: r.Category,
      'Requirement / room': r['Requirement / room'],
      'Required item': r['Required item'],
      Quantity: r.Quantity,
      Unit: r.Unit,
      'From department': r['From department'],
      'From location': r['From location'],
    }));
  const fitColumns = (sheet: XLSX.WorkSheet, rows: Record<string, unknown>[]) => {
    const keys = Object.keys(rows[0] || {});
    sheet['!cols'] = keys.map(k => ({
      wch: Math.min(48, Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)) + 2),
    }));
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  };
  const addSheet = (book: XLSX.WorkBook, name: string, rows: Record<string, unknown>[], empty: string) => {
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: empty }]);
    if (rows.length) fitColumns(sheet, rows);
    XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
  };
  const fileBase = () =>
    selected?.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'event';

  const exportRequirements = async () => {
    const book = XLSX.utils.book_new();
    // Radio requests with every column (including returns), read fresh for the export.
    const radio = selected
      ? await supabase
          .from('event_radio_requests')
          .select('*')
          .eq('organization_id', orgId)
          .eq('event_id', selected.id)
          .order('created_at')
      : { data: [] as any[] };
    addSheet(book, 'Requirements', mainRows(requirements, radio.data || []), 'No requirements for this event');
    addSheet(book, 'All details', requirements.map(requirementRow), 'No requirements for this event');
    for (const category of ['it', 'sewadar', 'inventory', 'accommodation', 'other']) {
      const rows = requirements.filter(row => row.category === category);
      if (rows.length || category !== 'inventory')
        addSheet(
          book,
          CATEGORY_LABEL[category],
          rows.map(requirementRow),
          `No ${CATEGORY_LABEL[category]} requirements`,
        );
    }
    addSheet(
      book,
      'Room necessities',
      necessityRows(requirements.filter(row => row.category === 'accommodation')),
      'No room necessities',
    );
    addSheet(
      book,
      'Walkie-Talkie',
      (radio.data || []).map((r: any) => ({
        'Request ID': r.id,
        'Event name': selected?.name || '',
        Department: r.department_name,
        'From (department · location)': r.collect_from || '',
        'Walkie-talkies': r.walkie_count,
        Chargers: r.charger_count,
        Earphones: r.earphone_count,
        Status: String(r.status || '').replace(/_/g, ' '),
        'Returned walkies': r.returned_walkies ?? '',
        'Returned chargers': r.returned_chargers ?? '',
        'Returned earphones': r.returned_earphones ?? '',
        'Returned at': when(r.returned_at),
        'Return feedback': r.return_feedback || '',
        'Requested at': when(r.created_at),
        'Updated at': when(r.updated_at),
      })),
      'No walkie-talkie requests for this event',
    );
    XLSX.writeFile(book, `${fileBase()}-requirements.xlsx`);
  };
  // One requirement: every field as Field / Value rows, plus its room necessities.
  const exportRequirement = (row: Requirement) => {
    const book = XLSX.utils.book_new();
    addSheet(book, 'Requirement', mainRows([row]), '');
    addSheet(
      book,
      'All details',
      Object.entries(requirementRow(row)).map(([Field, Value]) => ({ Field, Value })),
      '',
    );
    if (row.category === 'accommodation')
      addSheet(book, 'Room necessities', necessityRows([row]), 'No necessities for this room');
    const name =
      row.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'requirement';
    XLSX.writeFile(book, `${fileBase()}-${name}.xlsx`);
  };
  const downloadEventReport = async (event: EventPlan) => {
    if (!orgId) return;
    setBusy(true);
    setError('');
    const [
      meetingsResult,
      requirementsResult,
      tasksResult,
      attendanceResult,
      reviewResult,
      feedbackResult,
      staffingResult,
    ] = await Promise.all([
      supabase
        .from('meetings')
        .select('title,starts_at,agenda,minutes,status,mode,place,created_by_name')
        .eq('organization_id', orgId)
        .eq('event_id', event.id)
        .eq('kind', 'meeting'),
      supabase.from('event_requirements').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('manpower_tasks').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('event_attendance').select('*').eq('organization_id', orgId).eq('event_id', event.id),
      supabase.from('event_reviews').select('*').eq('organization_id', orgId).eq('event_id', event.id).maybeSingle(),
      supabase
        .from('member_issues')
        .select('kind,title,details,reporter_name,sub_department,status,created_at')
        .eq('organization_id', orgId)
        .eq('event_id', event.id),
      supabase
        .from('event_staffing_requirements')
        .select('requirement_date,category,required_count,notes')
        .eq('organization_id', orgId)
        .eq('event_id', event.id)
        .order('requirement_date'),
    ]);
    const failed = [
      meetingsResult,
      requirementsResult,
      tasksResult,
      attendanceResult,
      reviewResult,
      feedbackResult,
      staffingResult,
    ].find(result => result.error);
    if (failed?.error) {
      setError(schemaError(failed.error));
      setBusy(false);
      return;
    }
    const workbook = XLSX.utils.book_new();
    const addSheet = (name: string, rows: any[]) =>
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'No records' }]),
        name,
      );
    addSheet('Event', [
      {
        'Event name': event.name,
        Location: event.location,
        'Date & time': new Date(event.starts_at).toLocaleString('en-IN'),
        'Owner department':
          departments.find(department => department.id === event.owner_department_id)?.name || event.owner_name,
        Type: event.event_type || 'annual',
        Status: event.status,
      },
    ]);
    addSheet('Meetings', meetingsResult.data || []);
    addSheet('Requirements', requirementsResult.data || []);
    addSheet('Daily staffing', staffingResult.data || []);
    addSheet('Tasks', tasksResult.data || []);
    addSheet('Attendance', attendanceResult.data || []);
    addSheet('Department feedback', feedbackResult.data || []);
    addSheet('Review', reviewResult.data ? [reviewResult.data] : []);
    const safe =
      event.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'event';
    XLSX.writeFile(workbook, `${safe}-event-report.xlsx`);
    setBusy(false);
  };
  const sectionTitle = EVENT_SECTIONS.find(item => item.id === activeSection)!;
  const SectionIcon = sectionTitle.icon;
  const reviewMetrics: { label: string; value: number; icon: React.ComponentType<any> }[] = [
    { label: 'Sewadars present', value: attendanceStats.active, icon: Users },
    { label: 'Not present', value: attendanceStats.absent, icon: UserRound },
    { label: 'Walkie return reports', value: radioReturns.length, icon: Radio },
    { label: 'Unit feedback', value: feedback.length, icon: ClipboardCheck },
  ];

  return (
    <div className="space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <SectionIcon size={18} className="text-blue-400" />
          <h2 className="text-xl font-semibold text-ink">{sectionTitle.label}</h2>
        </div>
        <p className="mt-1 text-sm text-mute">{sectionTitle.description}</p>
      </header>
      {error && (
        <div
          role="alert"
          className="animate-calm-enter flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          <span>{error}</span>
          {orgId && !loading && (
            <button
              type="button"
              className="rounded-md border border-rose-400/30 px-3 py-1.5 font-medium text-rose-200 hover:bg-rose-400/10"
              onClick={() => void loadEvents()}
            >
              Retry loading
            </button>
          )}
        </div>
      )}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading events"
          className="h-0.5 overflow-hidden rounded-full bg-blue-500/10"
        >
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-blue-300 via-blue-400 to-blue-500 animate-loading-sweep" />
        </div>
      )}
      <Swap k={activeSection} indexOf={k => EVENT_SECTIONS.findIndex(item => item.id === k)}>
        <div className="space-y-4">
          {activeSection === 'event-creation' && (
            <>
              <section className={`${panel} overflow-hidden`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
                  <input
                    className={`${input} max-w-xs`}
                    placeholder="Search events"
                    aria-label="Search events"
                    value={eventSearch}
                    onChange={e => setEventSearch(e.target.value)}
                  />
                  <span className="text-xs text-mute">
                    {visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <button type="button" className={quiet} onClick={exportEvents}>
                      <Download size={14} />
                      Export Excel
                    </button>
                    {canPlan && (
                      <button className={action} type="button" onClick={() => setShowCreate(value => !value)}>
                        <Plus size={15} />
                        {showCreate ? 'Close' : 'Add event'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-raised text-xs uppercase tracking-wide text-mute">
                      <tr>
                        {['Event name', 'Location', 'Date & time', 'Event owner (department)', 'Status', 'Reports'].map(
                          label => (
                            <th key={label} className="px-4 py-3">
                              {label}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {visibleEvents.map((event, index) => (
                        <tr key={event.id} className={event.status === 'live' ? 'bg-emerald-500/[0.06]' : ''}>
                          <td className="px-4 py-3 font-medium text-ink">
                            {event.name}
                            {event.status === 'live' && index === 0 && (
                              <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-300">
                                Ongoing · Top priority
                              </span>
                            )}
                            <div className="text-xs capitalize text-mute">{event.event_type || 'annual'}</div>
                          </td>
                          <td className="px-4 py-3 text-ink-soft">{event.location || '—'}</td>
                          <td className="px-4 py-3 text-ink-soft">{when(event.starts_at)}</td>
                          <td className="px-4 py-3 text-ink-soft">
                            {departments.find(department => department.id === event.owner_department_id)?.name ||
                              event.owner_name ||
                              '—'}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              aria-label={`Status for ${event.name}`}
                              className={`${input} min-w-36`}
                              disabled={!canPlan || statusBusyId === event.id}
                              value={event.status}
                              onChange={e => void updateEventStatus(event, e.target.value)}
                            >
                              <option value="planning">Planning</option>
                              <option value="ready">Ready</option>
                              <option value="live">Live</option>
                              <option value="complete">Complete</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={quiet}
                                type="button"
                                disabled={busy}
                                onClick={() => void downloadEventReport(event)}
                              >
                                <Download size={13} />
                                Excel report
                              </button>
                              <button
                                className={quiet}
                                type="button"
                                onClick={() => {
                                  setSelectedId(event.id);
                                  location.hash = '#/events/post-event-review';
                                }}
                              >
                                View reports
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!visibleEvents.length && (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-sm text-mute">
                            No events match this search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              {showCreate && (
                <form
                  onSubmit={createEvent}
                  className={`animate-calm-enter ${panel} grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4`}
                >
                  <label className="text-xs text-mute">
                    Event name
                    <input
                      required
                      className={`${input} mt-1`}
                      value={eventForm.name}
                      onChange={e => setEventForm({ ...eventForm, name: e.target.value })}
                      placeholder="Annual gathering"
                    />
                  </label>
                  <label className="text-xs text-mute">
                    Location
                    <input
                      required
                      className={`${input} mt-1`}
                      value={eventForm.location}
                      onChange={e => setEventForm({ ...eventForm, location: e.target.value })}
                      placeholder="Main hall"
                    />
                  </label>
                  <label className="text-xs text-mute">
                    Event date
                    <input
                      required
                      type="date"
                      className={`${input} mt-1`}
                      value={eventForm.date}
                      onChange={e => setEventForm({ ...eventForm, date: e.target.value })}
                    />
                  </label>
                  <label className="text-xs text-mute">
                    Start time
                    <ClockTimePicker
                      label="Event start time"
                      className="mt-1"
                      value={eventForm.time}
                      onChange={time => setEventForm({ ...eventForm, time })}
                    />
                  </label>
                  <label className="text-xs text-mute">
                    Event owner (department)
                    <select
                      required
                      className={`${input} mt-1`}
                      value={eventForm.ownerDepartmentId}
                      onChange={e => setEventForm({ ...eventForm, ownerDepartmentId: e.target.value })}
                    >
                      <option value="">Choose department</option>
                      {departments.map((department: any) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-mute">
                    Event type
                    <select
                      required
                      className={`${input} mt-1`}
                      value={eventForm.type}
                      onChange={e =>
                        setEventForm({ ...eventForm, type: e.target.value as typeof eventForm.type, memberIds: [] })
                      }
                    >
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                      <option value="special">Special</option>
                    </select>
                  </label>
                  {eventForm.type === 'special' && (
                    <div className="sm:col-span-2 xl:col-span-4">
                      <div className="mb-1 text-xs text-mute">Choose Sewadars for this event’s calling list.</div>
                      <div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-line bg-raised/40 p-2 sm:grid-cols-2 xl:grid-cols-3">
                        {manpower.sewadars
                          .filter(member => member.memberType !== 'salary_based')
                          .map(member => (
                            <label
                              key={member.id}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink hover:bg-raised"
                            >
                              <input
                                type="checkbox"
                                checked={eventForm.memberIds.includes(member.id)}
                                onChange={e =>
                                  setEventForm(current => ({
                                    ...current,
                                    memberIds: e.target.checked
                                      ? [...current.memberIds, member.id]
                                      : current.memberIds.filter(id => id !== member.id),
                                  }))
                                }
                              />
                              <span className="truncate">
                                {member.name}
                                {memberMeta(member) && <span className="ml-1.5 text-mute">{memberMeta(member)}</span>}
                              </span>
                              <span className="ml-auto text-mute">
                                {member.memberType === 'monthly' ? 'Regular' : 'Annual'}
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-end">
                    <button
                      className={action}
                      disabled={busy || (eventForm.type === 'special' && eventForm.memberIds.length === 0)}
                    >
                      {busy ? 'Saving…' : 'Save event'}
                    </button>
                  </div>
                </form>
              )}
              {!selected ? (
                <div className={`${panel} p-8 text-center text-sm text-mute`}>
                  {loading ? 'Loading your events…' : 'Create an event to begin planning.'}
                </div>
              ) : (
                <>
                  <section className={`${panel} space-y-3 p-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-ink">{selected.name}</h3>
                        <p className="text-sm text-mute">
                          {selected.event_type || 'Annual'} event · {when(selected.starts_at)} · Organized by{' '}
                          {departments.find(department => department.id === selected.owner_department_id)?.name ||
                            selected.owner_name ||
                            '—'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={quiet}
                        disabled={busy}
                        onClick={() => void downloadEventReport(selected)}
                      >
                        <Download size={14} />
                        Download event report
                      </button>
                    </div>
                    {canPlan && (
                      <label className="block max-w-xl text-xs text-mute">
                        Location
                        <input
                          className={`${input} mt-1`}
                          value={selected.location}
                          onChange={e =>
                            setEvents(old =>
                              old.map(row => (row.id === selected.id ? { ...row, location: e.target.value } : row)),
                            )
                          }
                          onBlur={e => void updateEvent({ location: e.target.value })}
                        />
                      </label>
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {activeSection === 'pre-event-meetings' && (
            <>
              {!selected ? (
                <div className={`${panel} p-6 text-sm text-mute`}>
                  {loading ? 'Loading your events…' : 'Create an event first to schedule its coordination meetings.'}
                </div>
              ) : (
                <>
                  <MeetingsList eventId={selected.id} />
                </>
              )}
            </>
          )}

          {activeSection === 'requirement-management' && (
            <>
              {!selected ? (
                <div className={`${panel} p-6 text-sm text-mute`}>
                  {loading ? 'Loading your events…' : 'Create an event first to manage requirements.'}
                </div>
              ) : (
                <>
                  <section className={`${panel} overflow-hidden`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
                      <div className="flex flex-wrap gap-2">
                        {['it', 'sewadar', 'accommodation', 'walkie'].map(category => {
                          const active = requirementCategory === category;
                          return (
                            <button
                              type="button"
                              key={category}
                              onClick={() => {
                                setRequirementCategory(category);
                                setRequirementForm(old => ({ ...old, category, inventoryItemId: '', title: '' }));
                              }}
                              className={`rounded-lg px-3 py-2 text-xs font-medium capitalize ${active ? 'bg-blue-600 text-white' : 'text-ink-soft hover:bg-raised'}`}
                            >
                              {category === 'it'
                                ? 'IT'
                                : category === 'sewadar'
                                  ? 'Sewadar'
                                  : category === 'walkie'
                                    ? 'Walkie-Talkie'
                                    : 'Accommodation'}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className={quiet}
                        onClick={() => void exportRequirements()}
                        title="Every requirement with all fields, room necessities and walkie-talkie requests"
                      >
                        <Download size={14} />
                        Download all requirements
                      </button>
                    </div>
                    <div className="px-4 py-3">
                      <h3 className="text-sm font-semibold text-ink">
                        {requirementCategory === 'it'
                          ? 'IT'
                          : requirementCategory === 'sewadar'
                            ? 'Sewadar deployment'
                            : requirementCategory === 'accommodation'
                              ? 'Accommodation'
                              : 'Walkie-Talkie'}{' '}
                        requirements
                      </h3>
                      <p className="mt-1 text-xs text-mute">
                        {requirementCategory === 'sewadar'
                          ? 'Plan sub-department headcounts by date for this event.'
                          : requirementCategory === 'accommodation'
                            ? 'Create rooms, then add their necessities below.'
                            : requirementCategory === 'walkie'
                              ? 'Request walkie-talkies, chargers, and earphones through the event radio approval workflow.'
                              : 'Collect requirements from the responsible external department and track fulfilment here.'}
                      </p>
                    </div>
                    {requirementCategory === 'sewadar' && selected && (
                      <section className="border-t border-line">
                        <div className="border-b border-line bg-gradient-to-r from-blue-500/[0.06] via-transparent to-transparent p-3 sm:p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-300">
                                <UserRound size={16} />
                              </span>
                              <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-ink">Sewadar requirements</h3>
                                <p className="mt-0.5 text-[11.5px] text-mute">
                                  Set the headcount needed from each sub-department by date.
                                </p>
                              </div>
                            </div>
                            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-mute">
                              <Users size={13} className="text-blue-300" />
                              {eventRoster.length} eligible
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 rounded-lg border border-line bg-surface/70 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(180px,1.3fr)] sm:items-end">
                            <label className="text-[10.5px] font-medium text-mute">
                              Days before event
                              <input
                                aria-label="Staffing days before event"
                                disabled={!canPlan}
                                className={`${input} mt-1 h-9`}
                                type="number"
                                min={0}
                                max={30}
                                value={staffingDaysBefore}
                                onChange={e =>
                                  setStaffingDaysBefore(Math.min(30, Math.max(0, Number(e.target.value) || 0)))
                                }
                                onBlur={() => void updateEvent({ staffing_days_before: staffingDaysBefore })}
                              />
                            </label>
                            <label className="text-[10.5px] font-medium text-mute">
                              Days after event
                              <input
                                aria-label="Staffing days after event"
                                disabled={!canPlan}
                                className={`${input} mt-1 h-9`}
                                type="number"
                                min={0}
                                max={30}
                                value={staffingDaysAfter}
                                onChange={e =>
                                  setStaffingDaysAfter(Math.min(30, Math.max(0, Number(e.target.value) || 0)))
                                }
                                onBlur={() => void updateEvent({ staffing_days_after: staffingDaysAfter })}
                              />
                            </label>
                            <div className="flex h-9 items-center gap-2 rounded-md bg-raised/50 px-3 text-[11.5px] text-mute">
                              <CalendarDays size={13} className="shrink-0 text-blue-300" />
                              <span>Planning window includes the event day</span>
                            </div>
                          </div>
                        </div>
                        {(() => {
                          const selectedIndex = staffingDates.indexOf(staffingSelectedDate);
                          const dateRows = staffingRequirements.filter(
                            row => row.requirement_date === staffingSelectedDate,
                          );
                          const total = Object.keys(DEPTS).reduce((sum, id) => {
                            const row = dateRows.find(item => staffingCategoryKey(item.category) === id);
                            const draft = staffingCellDrafts[`${staffingSelectedDate}:${id}`];
                            return sum + Number(draft !== undefined ? draft : (row?.required_count ?? 0) || 0);
                          }, 0);
                          const configured = Object.entries(DEPTS).filter(([id]) => {
                            const row = dateRows.find(item => staffingCategoryKey(item.category) === id);
                            const draft = staffingCellDrafts[`${staffingSelectedDate}:${id}`];
                            return draft !== undefined ? draft.trim() !== '' : !!row;
                          }).length;
                          const isEventDay = staffingSelectedDate === localDay(selected.starts_at);
                          return (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised/20 px-3 py-2.5 sm:px-4">
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className={quiet}
                                    aria-label="Previous date"
                                    disabled={selectedIndex <= 0}
                                    onClick={() => setStaffingSelectedDate(staffingDates[selectedIndex - 1] || '')}
                                  >
                                    <ChevronLeft size={14} />
                                  </button>
                                  <label className="relative">
                                    <span className="sr-only">Select staffing date</span>
                                    <CalendarDays
                                      size={13}
                                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-300"
                                    />
                                    <input
                                      type="date"
                                      min={staffingDates[0]}
                                      max={staffingDates[staffingDates.length - 1]}
                                      className={`${input} h-9 w-40 pl-8`}
                                      value={staffingSelectedDate}
                                      onChange={e => setStaffingSelectedDate(e.target.value)}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className={quiet}
                                    aria-label="Next date"
                                    disabled={selectedIndex < 0 || selectedIndex >= staffingDates.length - 1}
                                    onClick={() => setStaffingSelectedDate(staffingDates[selectedIndex + 1] || '')}
                                  >
                                    <ChevronRight size={14} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="rounded-md border border-line bg-surface px-2.5 py-1 text-right">
                                    <span className="block text-[10px] uppercase tracking-wide text-mute">
                                      {isEventDay
                                        ? 'Event day'
                                        : staffingSelectedDate < localDay(selected.starts_at)
                                          ? 'Before event'
                                          : 'After event'}
                                    </span>
                                    <span className="text-[11.5px] font-medium text-ink">
                                      Day {selectedIndex + 1} of {staffingDates.length}
                                    </span>
                                  </div>
                                  <div className="rounded-md border border-blue-500/20 bg-blue-500/[0.06] px-2.5 py-1 text-right">
                                    <span className="block text-[10px] uppercase tracking-wide text-mute">
                                      Total required
                                    </span>
                                    <span className="text-sm font-semibold tabular-nums text-ink">{total}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="p-3 sm:p-4">
                                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <h4 className="text-xs font-semibold text-ink">Sub-department staffing</h4>
                                    <p className="mt-0.5 text-[10.5px] text-mute">
                                      Enter the number needed. Leave blank when none are required.
                                    </p>
                                  </div>
                                  <span className="rounded-md border border-line bg-raised px-2 py-1 text-[10.5px] tabular-nums text-mute">
                                    {configured} / {Object.keys(DEPTS).length} planned
                                  </span>
                                </div>
                                <div className="mb-1 hidden grid-cols-[minmax(0,1fr)_5rem] gap-3 px-2 text-[10px] font-medium uppercase tracking-wide text-mute sm:grid">
                                  <span>Sub-department</span>
                                  <span className="text-center">Needed</span>
                                </div>
                                <div
                                  key={staffingSelectedDate}
                                  className="animate-calm-enter grid gap-1.5 sm:grid-cols-2"
                                >
                                  {Object.entries(DEPTS).map(([id, label]) => {
                                    const row = dateRows.find(item => staffingCategoryKey(item.category) === id);
                                    const key = `${staffingSelectedDate}:${id}`;
                                    const value = staffingCellDrafts[key] ?? (row ? String(row.required_count) : '');
                                    return (
                                      <label
                                        key={id}
                                        className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 rounded-md border border-line/80 bg-surface px-2.5 py-1.5 transition-colors focus-within:border-blue-400/60"
                                      >
                                        <span className="min-w-0 truncate text-xs font-medium text-ink">{label}</span>
                                        <input
                                          aria-label={`${label} Sewadars required on ${staffingSelectedDate}`}
                                          disabled={!canPlan || staffingBusy}
                                          type="number"
                                          min={0}
                                          step={1}
                                          inputMode="numeric"
                                          placeholder="0"
                                          value={value}
                                          onChange={e =>
                                            setStaffingCellDrafts(old => ({ ...old, [key]: e.target.value }))
                                          }
                                          onBlur={e =>
                                            void saveStaffingCell(staffingSelectedDate, id, e.currentTarget.value)
                                          }
                                          className={`h-8 w-full rounded-md border text-center text-xs tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-default disabled:opacity-75 ${value !== '' ? 'border-line bg-field text-ink' : 'border-line/70 bg-field/40 text-mute'}`}
                                        />
                                      </label>
                                    );
                                  })}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[10.5px] text-mute">
                                  <span>
                                    {staffingBusy
                                      ? 'Saving changes…'
                                      : canPlan
                                        ? 'Changes save when you leave a field.'
                                        : 'View only'}
                                  </span>
                                  <span>Daily attendance comparisons are on the Dashboard.</span>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </section>
                    )}
                    {canPlan && !['sewadar', 'walkie'].includes(requirementCategory) && (
                      <form
                        onSubmit={addRequirement}
                        className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 xl:grid-cols-4"
                      >
                        <h4 className="sm:col-span-2 xl:col-span-4 text-sm font-semibold text-ink">
                          {requirementCategory === 'accommodation'
                            ? 'Add a room'
                            : `Add ${requirementCategory === 'it' ? 'IT' : requirementCategory} requirement`}
                        </h4>
                        {requirementCategory === 'accommodation' ? (
                          <>
                            <label className="text-xs text-mute">
                              Room name
                              <input
                                required
                                className={`${input} mt-1`}
                                placeholder="e.g. Rest room 1"
                                value={requirementForm.title}
                                onChange={e => setRequirementForm({ ...requirementForm, title: e.target.value })}
                              />
                            </label>
                            <label className="text-xs text-mute">
                              Room category
                              <select
                                className={`${input} mt-1`}
                                value={roomDraft.kind}
                                onChange={e => setRoomDraft({ ...roomDraft, kind: e.target.value })}
                              >
                                <option value="rest_room">Rest room</option>
                                <option value="control_room">Control room</option>
                              </select>
                            </label>
                            <label className="text-xs text-mute">
                              Capacity
                              <input
                                required
                                type="number"
                                min="1"
                                className={`${input} mt-1`}
                                value={requirementForm.quantity}
                                onChange={e =>
                                  setRequirementForm({
                                    ...requirementForm,
                                    quantity: e.target.value,
                                    unit: roomDraft.kind === 'rest_room' ? 'beds' : 'seats',
                                  })
                                }
                              />
                            </label>
                            <label className="text-xs text-mute">
                              Block / location
                              <input
                                className={`${input} mt-1`}
                                value={roomDraft.block}
                                onChange={e => setRoomDraft({ ...roomDraft, block: e.target.value })}
                                placeholder="Block or location"
                              />
                            </label>
                            {roomDraft.kind === 'control_room' && (
                              <label className="text-xs text-mute">
                                Responsible Sewadar team
                                <select
                                  required
                                  className={`${input} mt-1`}
                                  value={roomDraft.team}
                                  onChange={e => setRoomDraft({ ...roomDraft, team: e.target.value })}
                                >
                                  <option value="">Select team</option>
                                  {manpower.teams.map(team => (
                                    <option key={team.id} value={team.id}>
                                      {team.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <p className="text-xs text-mute sm:col-span-2 xl:col-span-4">
                              After creating the room, add its necessities in the room list below.
                            </p>
                          </>
                        ) : (
                          <>
                            <label className="text-xs text-mute">
                              Responsible unit
                              <select
                                required={user?.level !== 'owner' || !!requirementDepartments.length}
                                className={`${input} mt-1`}
                                value={requirementForm.departmentId}
                                onChange={e => setRequirementForm({ ...requirementForm, departmentId: e.target.value })}
                              >
                                <option value="">Choose unit</option>
                                {requirementDepartments.map((d: any) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs text-mute">
                              Equipment or service needed
                              <input
                                required
                                className={`${input} mt-1`}
                                placeholder="Describe what is needed"
                                value={requirementForm.title}
                                onChange={e => setRequirementForm({ ...requirementForm, title: e.target.value })}
                              />
                            </label>
                            <label className="text-xs text-mute">
                              Quantity and unit
                              <div className="mt-1 flex gap-2">
                                <input
                                  required
                                  type="number"
                                  min="0"
                                  className={input}
                                  value={requirementForm.quantity}
                                  onChange={e => setRequirementForm({ ...requirementForm, quantity: e.target.value })}
                                />
                                <input
                                  className={input}
                                  placeholder="units"
                                  value={requirementForm.unit}
                                  onChange={e => setRequirementForm({ ...requirementForm, unit: e.target.value })}
                                />
                              </div>
                            </label>
                            <label className="text-xs text-mute">
                              Specifications / details
                              <input
                                className={`${input} mt-1`}
                                placeholder="Timing, location, sizes, or other details"
                                value={requirementForm.notes}
                                onChange={e => setRequirementForm({ ...requirementForm, notes: e.target.value })}
                              />
                            </label>
                            <label className="text-xs text-mute">
                              From department
                              <select
                                className={`${input} mt-1`}
                                value={requirementForm.fromDepartment}
                                onChange={e =>
                                  setRequirementForm({ ...requirementForm, fromDepartment: e.target.value })
                                }
                              >
                                <option value="">Choose department</option>
                                {sourceDepartments.map(name => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs text-mute">
                              From location
                              <input
                                list="event-requirement-source-places"
                                className={`${input} mt-1`}
                                placeholder="e.g. Store room 2, Block B"
                                value={requirementForm.fromLocation}
                                onChange={e => setRequirementForm({ ...requirementForm, fromLocation: e.target.value })}
                              />
                              <datalist id="event-requirement-source-places">
                                <option value="Main Control Room" />
                                <option value="Canteen" />
                                <option value="Store" />
                                <option value="IT Office" />
                                <option value="Security" />
                              </datalist>
                            </label>
                          </>
                        )}
                        <button
                          className={`${action} justify-self-start`}
                          disabled={
                            busy ||
                            (requirementCategory !== 'accommodation' && user?.level !== 'owner' && !ownDepartmentId)
                          }
                        >
                          <Plus size={14} />
                          {requirementCategory === 'accommodation' ? 'Add room' : 'Add requirement'}
                        </button>
                      </form>
                    )}
                    {requirementCategory === 'walkie' && (
                      <section className="border-t border-line">
                        {canPlan && (
                          <form
                            onSubmit={addWalkieRequest}
                            className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 sm:items-end"
                          >
                            <label className="text-xs font-medium text-mute">
                              From department
                              <select
                                className={`${input} mt-1`}
                                value={radioRequestForm.fromDepartment}
                                onChange={event =>
                                  setRadioRequestForm(old => ({ ...old, fromDepartment: event.target.value }))
                                }
                              >
                                <option value="">Choose department</option>
                                {sourceDepartments.map(name => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                              <span className="mt-1 block text-[10.5px] font-normal text-faint">
                                Which department hands over the radios.
                              </span>
                            </label>
                            <label className="text-xs font-medium text-mute">
                              From location
                              <input
                                list="event-radio-source-places"
                                className={`${input} mt-1`}
                                placeholder="e.g. Main Control Room"
                                value={radioRequestForm.fromLocation}
                                onChange={event =>
                                  setRadioRequestForm(old => ({ ...old, fromLocation: event.target.value }))
                                }
                              />
                              <datalist id="event-radio-source-places">
                                <option value="Main Control Room" />
                                <option value="Walkie-Talkie Store" />
                                <option value="IT Office" />
                                <option value="Control Room" />
                              </datalist>
                              <span className="mt-1 block text-[10.5px] font-normal text-faint">
                                Where the team collects them.
                              </span>
                            </label>
                            {(
                              [
                                ['walkies', 'Walkie-talkies', 'At least one set is required'],
                                ['chargers', 'Chargers', 'Optional'],
                                ['earphones', 'Earphones', 'Optional'],
                              ] as const
                            ).map(([key, label, hint]) => (
                              <label key={key} className="text-xs font-medium text-mute">
                                {label}
                                <input
                                  required
                                  type="number"
                                  min={key === 'walkies' ? 1 : 0}
                                  step="1"
                                  inputMode="numeric"
                                  className={`${input} mt-1`}
                                  value={radioRequestForm[key]}
                                  onChange={event =>
                                    setRadioRequestForm(old => ({ ...old, [key]: event.target.value }))
                                  }
                                />
                                <span className="mt-1 block text-[10.5px] font-normal text-faint">{hint}</span>
                              </label>
                            ))}
                            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
                              <button className={action} disabled={busy || !selected}>
                                {busy ? 'Sending…' : 'Send radio request'} <Radio size={14} />
                              </button>
                              <span className="text-[10.5px] text-mute">
                                This creates a request in the event radio approval queue.
                              </span>
                            </div>
                          </form>
                        )}
                        <div className="border-t border-line px-4 py-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h4 className="text-xs font-semibold text-ink">Event radio requests</h4>
                              <p className="mt-0.5 text-[10.5px] text-mute">
                                Shared with IT Services → Walkie-Talkie → Event radio requests.
                              </p>
                            </div>
                            <span className="text-[10.5px] text-mute">
                              {eventRadioRequests.length} request{eventRadioRequests.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          {eventRadioRequests.length ? (
                            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
                              {eventRadioRequests.map(request => (
                                <article
                                  key={request.id}
                                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium text-ink">
                                      {request.department_name}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-mute">
                                      <span>From · {request.collect_from || 'Not specified'}</span>
                                      <span>{request.walkie_count} walkie-talkies</span>
                                      <span>{request.charger_count} chargers</span>
                                      <span>{request.earphone_count} earphones</span>
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-line bg-raised px-2 py-1 text-[10.5px] capitalize text-ink-soft">
                                    {request.status.replace(/_/g, ' ')}
                                  </span>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="rounded-lg border border-dashed border-line p-5 text-center text-xs text-mute">
                              No radio requests have been submitted for this event yet.
                            </p>
                          )}
                        </div>
                      </section>
                    )}
                    {requirementCategory !== 'sewadar' &&
                      requirementCategory !== 'walkie' &&
                      (!visibleRequirements.length ? (
                        <div className="border-t border-line p-6 text-center text-sm text-mute">
                          No {requirementCategory} requirements recorded for this event and unit.
                        </div>
                      ) : requirementCategory === 'accommodation' ? (
                        <div className="border-t border-line divide-y divide-line">
                          {visibleRequirements.map(item => (
                            <article key={item.id} className="p-4 sm:p-5">
                              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px_40px] sm:items-center">
                                <div className="min-w-0">
                                  <h4 className="truncate text-sm font-semibold text-ink">{item.title}</h4>
                                  <p className="mt-1 text-xs capitalize text-mute">
                                    {(item.accommodation_category || 'rest_room').replace('_', ' ')}{' '}
                                    <span aria-hidden="true">·</span> {item.quantity} {item.unit}
                                  </p>
                                </div>
                                <label className="text-[11.5px] font-medium text-mute">
                                  Room status
                                  <select
                                    aria-label={'Status for ' + item.title}
                                    className="mt-1 w-full rounded-md border border-line bg-field px-3 py-2 text-sm text-ink outline-none focus:border-blue-500"
                                    disabled={!canPlan || busy}
                                    value={item.status}
                                    onChange={e =>
                                      void updateRequirementStatus(item, e.target.value as Requirement['status'])
                                    }
                                  >
                                    {['requested', 'in_progress', 'ready', 'not_needed'].map(value => (
                                      <option key={value} value={value}>
                                        {value.replace('_', ' ')}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {canPlan ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-rose-300 hover:bg-raised disabled:opacity-50"
                                    disabled={busy}
                                    onClick={() => void deleteRequirement(item)}
                                    aria-label={'Delete room ' + item.title}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                ) : (
                                  <span />
                                )}
                              </div>
                              <section className="mt-4 rounded-lg border border-line bg-raised/30 p-3 sm:p-4">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <h5 className="text-sm font-semibold text-ink">Room necessities</h5>
                                    <p className="mt-1 text-xs text-mute">
                                      Equipment and supplies needed in this room.
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      className={quiet}
                                      onClick={() => exportRequirement(item)}
                                      title="Download this room and its necessities (all fields)"
                                    >
                                      <Download size={13} /> Download room
                                    </button>
                                    {canPlan && (
                                      <button
                                        type="button"
                                        className={quiet}
                                        disabled={busy}
                                        onClick={() => addRoomNecessity(item)}
                                      >
                                        <Plus size={13} /> Add necessity
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {roomNecessities(item).length === 0 ? (
                                  <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-mute">
                                    No necessities added yet.
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {roomNecessities(item).map((need, index) => (
                                      <div
                                        key={index}
                                        className="grid gap-2 rounded-md border border-line/70 bg-surface p-3 sm:grid-cols-[minmax(0,2fr)_110px_minmax(0,2fr)_40px] sm:items-end"
                                      >
                                        <label className="text-[11.5px] font-medium text-mute">
                                          Necessity
                                          <input
                                            className={input + ' mt-1'}
                                            aria-label={'Necessity name ' + (index + 1)}
                                            placeholder="e.g. Bedsheets"
                                            value={need.name}
                                            disabled={!canPlan || busy}
                                            onChange={e => editRoomNecessity(item, index, { name: e.target.value })}
                                          />
                                        </label>
                                        <label className="text-[11.5px] font-medium text-mute">
                                          Quantity
                                          <input
                                            className={input + ' mt-1'}
                                            aria-label={'Necessity quantity ' + (index + 1)}
                                            type="number"
                                            min="0"
                                            placeholder="Qty"
                                            value={need.quantity}
                                            disabled={!canPlan || busy}
                                            onChange={e =>
                                              editRoomNecessity(item, index, { quantity: Number(e.target.value) })
                                            }
                                          />
                                        </label>
                                        <label className="text-[11.5px] font-medium text-mute">
                                          Collect from
                                          <input
                                            className={input + ' mt-1'}
                                            aria-label={'Collect from for necessity ' + (index + 1)}
                                            placeholder="Store, unit, or contact"
                                            value={need.collectFrom || ''}
                                            disabled={!canPlan || busy}
                                            onChange={e =>
                                              editRoomNecessity(item, index, { collectFrom: e.target.value })
                                            }
                                          />
                                        </label>
                                        {canPlan && (
                                          <button
                                            type="button"
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-rose-300 hover:bg-raised disabled:opacity-50"
                                            disabled={busy}
                                            onClick={() => removeRoomNecessity(item, index)}
                                            aria-label={'Remove necessity ' + (index + 1)}
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {canPlan && (
                                  <div className="mt-4 flex justify-end border-t border-line pt-3">
                                    <button
                                      type="button"
                                      className={action}
                                      disabled={busy}
                                      onClick={() => void saveRoomNecessities(item)}
                                    >
                                      Save necessities
                                    </button>
                                  </div>
                                )}
                              </section>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="overflow-x-auto border-t border-line">
                          <table className="w-full min-w-[820px] text-left text-xs">
                            <thead className="bg-raised text-mute">
                              <tr>
                                {[
                                  'Requirement',
                                  'Responsible unit',
                                  'Quantity',
                                  'Specifications',
                                  'From department',
                                  'From location',
                                  'Status',
                                  '',
                                ].map((label, index) => (
                                  <th key={label + index} className="px-4 py-3 font-semibold uppercase tracking-wide">
                                    {label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {visibleRequirements.map(item => (
                                <tr key={item.id}>
                                  <td className="px-4 py-3 font-medium text-ink">{item.title}</td>
                                  <td className="px-4 py-3 text-ink-soft">{item.department_name || 'Unassigned'}</td>
                                  <td className="px-4 py-3 text-ink-soft">
                                    {item.quantity} {item.unit}
                                  </td>
                                  <td className="max-w-md whitespace-pre-wrap px-4 py-3 text-ink-soft">
                                    {item.notes || '—'}
                                  </td>
                                  <td className="px-4 py-3 text-ink-soft">{item.collect_from_department || '—'}</td>
                                  <td className="px-4 py-3 text-ink-soft">
                                    {item.collect_from_location ||
                                      (!item.collect_from_department && item.collect_from) ||
                                      '—'}
                                  </td>
                                  <td className="px-4 py-3">
                                    <select
                                      aria-label={`Status for ${item.title}`}
                                      className={`${input} min-w-36`}
                                      disabled={!canPlan || busy}
                                      value={item.status}
                                      onChange={e =>
                                        void updateRequirementStatus(item, e.target.value as Requirement['status'])
                                      }
                                    >
                                      {['requested', 'in_progress', 'ready', 'not_needed'].map(value => (
                                        <option key={value} value={value}>
                                          {value.replace('_', ' ')}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        className={quiet}
                                        onClick={() => exportRequirement(item)}
                                        aria-label={`Download ${item.title}`}
                                        title="Download this requirement (all fields)"
                                      >
                                        <Download size={13} />
                                      </button>
                                      {canPlan && (
                                        <button
                                          type="button"
                                          className={`${quiet} text-rose-300`}
                                          disabled={busy}
                                          onClick={() => void deleteRequirement(item)}
                                          aria-label={`Delete requirement ${item.title}`}
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                  </section>
                </>
              )}
            </>
          )}

          {activeSection === 'post-event-review' &&
            (!selected ? (
              <div className={`${panel} p-6 text-sm text-mute`}>
                {loading ? 'Loading your events…' : 'Create an event first to record its review.'}
              </div>
            ) : (
              <>
                <section className={`${panel} overflow-hidden`}>
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-blue-500/10 via-transparent to-emerald-500/10 p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-300">
                        <FileText size={19} />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-ink">Close out {selected.name}</h3>
                          <span className="rounded-full bg-raised px-2 py-1 text-[10.5px] font-semibold capitalize text-mute">
                            {selected.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-mute">
                          Review what happened, capture unit feedback, reconcile returns, and record the closeout.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={quiet}
                      disabled={busy}
                      onClick={() => void downloadEventReport(selected)}
                    >
                      <Download size={14} />
                      Export event report
                    </button>
                  </div>
                </section>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {reviewMetrics.map(({ label, value, icon: Icon }) => (
                    <article key={label} className={`${panel} flex items-center gap-3 p-4`}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-blue-300">
                        <Icon size={16} />
                      </span>
                      <div>
                        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-mute">{label}</div>
                        <div className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</div>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <section className={`${panel} overflow-hidden`}>
                    <div className="border-b border-line p-4">
                      <h3 className="text-sm font-semibold">Department feedback and reported issues</h3>
                      <p className="mt-1 text-xs text-mute">
                        Feedback linked to this event, including reports submitted from the department feedback flow.
                      </p>
                    </div>
                    {feedback.length ? (
                      <div className="divide-y divide-line">
                        {feedback.map(item => (
                          <article key={item.id} className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <h4 className="text-sm font-medium text-ink">{item.title || item.kind}</h4>
                                <p className="mt-1 text-xs text-mute">
                                  {item.sub_department || 'Department'} · {item.reporter_name || 'Reporter'} ·{' '}
                                  {new Date(item.created_at).toLocaleString('en-IN')}
                                </p>
                              </div>
                              <span className="rounded-full bg-raised px-2 py-1 text-xs text-ink-soft">
                                {item.status || item.kind}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{item.details}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="p-4 text-sm text-mute">
                        No department feedback or issue reports are linked to this event yet.
                      </p>
                    )}
                  </section>
                  <section className={`${panel} overflow-hidden`}>
                    <div className="border-b border-line p-4">
                      <div className="flex items-center gap-2">
                        <Radio size={16} className="text-blue-400" />
                        <div>
                          <h3 className="text-sm font-semibold">Walkie return feedback</h3>
                          <p className="mt-1 text-xs text-mute">
                            Department feedback recorded when event radios are returned.
                          </p>
                        </div>
                      </div>
                    </div>
                    {radioReturns.length ? (
                      <div className="divide-y divide-line">
                        {radioReturns.map(r => (
                          <article key={r.id} className="p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-ink">{r.department_name}</div>
                              <div className="text-xs text-mute">
                                {r.returned_walkies} walkies · {r.returned_chargers} chargers · {r.returned_earphones}{' '}
                                earphones
                              </div>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
                              {r.return_feedback || 'No feedback recorded.'}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="p-4 text-sm text-mute">No walkie returns recorded for this event yet.</p>
                    )}
                  </section>
                </div>
                <form onSubmit={saveReview} className={`${panel} space-y-3 p-4`}>
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-blue-400" />
                    <div>
                      <h3 className="text-sm font-semibold">Event review and closure</h3>
                      <p className="mt-1 text-xs text-mute">
                        Capture lessons, issues, recommendations, and the closure report.
                      </p>
                    </div>
                  </div>
                  {(
                    [
                      ['lessons_learned', 'Lessons learned'],
                      ['issues_faced', 'Issues faced'],
                      ['recommendations', 'Recommendations'],
                      ['closure_report', 'Closure report'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block text-xs text-mute">
                      {label}
                      <textarea
                        className={`${input} mt-1`}
                        rows={2}
                        value={review[key]}
                        disabled={!canPlan}
                        onChange={e => setReview(old => ({ ...old, [key]: e.target.value }))}
                      />
                    </label>
                  ))}
                  {canPlan && (
                    <button className={action} disabled={busy}>
                      {busy ? 'Saving…' : 'Save review'}
                    </button>
                  )}
                </form>
              </>
            ))}
        </div>
      </Swap>
    </div>
  );
};
