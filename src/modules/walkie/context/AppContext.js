import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useModuleEventScope } from '../../../context/EventScopeContext';

const AppContext = createContext();

// ----------------------------------------------------------------------------
// Row <-> app-shape mappers. The rest of the app (all the View components)
// was built against these camelCase shapes, so we translate Postgres's
// snake_case rows into exactly the same shapes here. Nothing outside this
// file needs to know Supabase exists.
// ----------------------------------------------------------------------------
const mapWalkie = (row) => ({
  id: row.id,
  label: row.label,
  model: row.model,
  status: row.status,
  departmentId: row.department_id || '',
  channel: row.channel || '',
  assignedPerson: row.assigned_person_name
    ? { name: row.assigned_person_name, contact: row.assigned_person_contact || '' }
    : null,
  isRented: row.is_rented === true,
  notes: row.notes || ''
});

const mapDepartment = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  channelNumber: row.channel_number,
  code: row.code || ''
});

const mapAllocation = (row) => ({
  id: row.id,
  departmentId: row.department_id || '',
  walkieIds: Array.isArray(row.walkie_ids) ? row.walkie_ids : [],
  date: row.date,
  allocatedBy: row.allocated_by || '',
  remarks: row.remarks || '',
  status: row.status,
  chargerCount: row.charger_count || 0,
  earphoneCount: row.earphone_count || 0,
  returnedDate: row.returned_date || undefined
});

const mapMaintenance = (row) => ({
  id: row.id,
  walkieId: row.walkie_id,
  issue: row.issue,
  date: row.date,
  technician: row.technician,
  status: row.status
});

const mapHistory = (row) => ({
  id: row.id,
  action: row.action,
  details: row.details,
  timestamp: new Date(row.created_at).toLocaleString(),
  type: row.type || 'info'
});

const mapDepartmentHead = (row) => ({
  id: row.id,
  departmentId: row.department_id,
  name: row.name,
  mobileNumber: row.mobile_number
});

const mapDelivery = (row) => ({
  id: row.id,
  departmentId: row.department_id || '',
  walkieCount: row.walkie_count,
  chargerCount: row.charger_count,
  earphoneCount: row.earphone_count || 0,
  status: row.status,
  deliveredBy: row.delivered_by || '',
  signedBy: row.signed_by || '',
  remarks: row.remarks || '',
  deliveredAt: row.delivered_at || null,
  returnedAt: row.returned_at || null,
  createdAt: row.created_at
});

const mapInventorySettings = (row) => ({
  totalEarphones: row.total_earphones || 0,
  totalChargers: row.total_chargers || 0,
  chargersMaintenance: row.chargers_maintenance || 0,
  earphonesMaintenance: row.earphones_maintenance || 0
});

// Builds a WhatsApp click-to-send link (no API key needed — opens WhatsApp
// with the message pre-filled, the user taps Send themselves).
const buildWhatsAppLink = (mobileNumber, message) => {
  const digits = (mobileNumber || '').replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

const safeJsonParse = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null && saved !== 'undefined') {
      const parsed = JSON.parse(saved);
      if (parsed !== undefined && parsed !== null) return parsed;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to parse localStorage key "${key}":`, e);
  }
  return fallback;
};

// Friendly hint when PostgREST says a column/table is missing — this is what
// happens when a SQL migration hasn't been run (or the API schema cache is stale).
const describeDbError = (error) => {
  const msg = error?.message || 'Unknown error';
  if (/schema cache|column .* does not exist|could not find/i.test(msg)) {
    return `${msg} — run supabase/migration_v6_backend_fixes.sql in the Supabase SQL Editor, then retry.`;
  }
  return msg;
};

export function AppProvider({ children }) {
  const eventId = useModuleEventScope('walkie') || null;
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  // Which auth screen is showing when there's no signed-in user:
  // 'login' | 'signup' | 'forgot' | 'reset'
  const [authView, setAuthView] = useState('login');
  // One-off banner text shown on the auth screens (e.g. "check your email")
  const [authNotice, setAuthNotice] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Admin-only: full user list for the Users management screen
  const [allProfiles, setAllProfiles] = useState([]);
  // The signed-in user's organization (name + join code) — fetched once we
  // know their organizationId.
  const [currentOrganization, setCurrentOrganization] = useState(null);

  // Business data lives ONLY in Supabase. It used to be cached in localStorage
  // and seeded with demo rows, which meant a failed fetch silently showed
  // fake/stale data (and leaked one account's data to the next login on the
  // same browser). Start empty and fill from the database.
  const [walkies, setWalkies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [history, setHistory] = useState([]);
  const [departmentHeads, setDepartmentHeads] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [inventorySettings, setInventorySettings] = useState({ totalEarphones: 0, totalChargers: 0, chargersMaintenance: 0, earphonesMaintenance: 0 });

  // Royal (dark + saffron palette) is the default theme. `themeV` moves every browser to Royal once;
  // after that, whatever the person picks in the account menu (Light, Dark or Royal) is kept.
  const [settings, setSettings] = useState(() => {
    const s = safeJsonParse('wt_settings', {
      orgName: 'Apex Security & Logistics',
      logo: '📻',
      theme: 'dark',
      palette: 'saffron',
      defaultAllocator: 'Administrator',
      role: 'Admin'
    });
    return s.themeV === 5 ? s : { ...s, theme: 'dark', palette: 'saffron', themeV: 5 };
  });

  const [currentTab, setCurrentTab] = useState('dashboard');
  const [globalSearch, setGlobalSearch] = useState('');
  const [toasts, setToasts] = useState([]);

  // Helper: Toast notifications
  // The toast itself handles auto-dismiss (it pauses while hovered); this only adds and removes.
  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.filter(t => !(t.message === message && t.type === type)), { id, message, type }]);
  }, []);
  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Helper: Log Action
  const logAction = useCallback(async (action, details, type = 'info') => {
    try {
      await supabase.from('history').insert({
        id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        action,
        details,
        type,
        organization_id: currentUser?.organizationId
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to log action:', e);
    }
  }, [currentUser]);

  // Auth profile loader. It FAILS CLOSED: on any error or empty result it retries, and if it still cannot
  // read the profile it returns null (the caller treats that as "not signed in"). It never invents an
  // approved, active user, so a network or RLS hiccup cannot let a pending or disabled person in.
  const loadProfile = useCallback(async (userId) => {
    const delays = [0, 600, 1800];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (!error && data) {
          return {
            id: data.id,
            name: data.name,
            email: data.email,
            role: data.role,
            isActive: data.is_active !== false,
            organizationId: data.organization_id || null,
            approved: data.approved !== false,   // an existing row decides; only a failed read is treated as not signed in
            level: data.level || (data.role === 'Admin' ? 'owner' : 'other'),
            subDepartment: data.sub_department || null,
            departmentId: data.department_id || null
          };
        }
      } catch (e) { /* retry */ }
    }
    return null;
  }, []);

  useEffect(() => {
    let isMounted = true;

    // If the user landed here from a Supabase password-reset email, Supabase
    // puts type=recovery in the URL and fires PASSWORD_RECOVERY below — jump
    // straight to the reset-password screen instead of the dashboard.
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setAuthView('reset');
    }

    const FAIL_NOTICE = 'We could not load your account. Check your connection and sign in again.';
    let currentId = null; // the user whose profile is already loaded (a token refresh must not reload or log out)

    const applySession = async (session) => {
      if (!session?.user) {
        currentId = null;
        if (isMounted) setCurrentUser(null);
        return;
      }
      const profile = await loadProfile(session.user.id);
      if (!isMounted) return;
      if (!profile) {
        // Cannot confirm who this is: fail closed.
        currentId = null;
        setCurrentUser(null);
        setAuthNotice(FAIL_NOTICE);
        await supabase.auth.signOut();
        return;
      }
      if (!profile.isActive) {
        currentId = null;
        await supabase.auth.signOut();
        if (isMounted) {
          setCurrentUser(null);
          setAuthNotice('Your account has been disabled. Contact an administrator.');
        }
        return;
      }
      currentId = profile.id;
      setCurrentUser(profile);
    };

    supabase.auth.getSession().then(async ({ data }) => {
      await applySession(data?.session);
      if (isMounted) setAuthChecked(true);
    }).catch(() => {
      if (isMounted) {
        setCurrentUser(null);
        setAuthChecked(true);
      }
    });

    // IMPORTANT: this callback must not await Supabase calls. supabase-js holds an auth lock while it runs
    // the callback, so awaiting a query (or signOut) in here can deadlock every later request. We only
    // schedule the work for the next tick.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        if (isMounted) setAuthView('reset');
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return; // nothing changed about who they are
      if (event === 'SIGNED_IN' && session?.user && session.user.id === currentId) return; // tab refocus re-fires SIGNED_IN
      setTimeout(() => { applySession(session); }, 0);
    });

    return () => {
      isMounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    if (currentUser) {
      setSettings(prev => ({ ...prev, role: currentUser.role, defaultAllocator: currentUser.name }));
    }
  }, [currentUser]);

  const mapOrganization = (o) => ({ id: o.id, name: o.name, joinCode: o.join_code, logoUrl: o.logo_url || null });

  // Fetch the current user's organization (name + join code for Admins to
  // share) whenever it becomes known, and keep it live via realtime so a
  // renamed org / regenerated join code shows up without a refresh.
  useEffect(() => {
    if (!currentUser?.organizationId) {
      setCurrentOrganization(null);
      return;
    }
    let isMounted = true;
    supabase.from('organizations').select('*').eq('id', currentUser.organizationId).maybeSingle()
      .then(({ data }) => {
        if (isMounted && data) {
          setCurrentOrganization(mapOrganization(data));
        }
      });

    const channel = supabase
      .channel(`org-${currentUser.organizationId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'organizations', filter: `id=eq.${currentUser.organizationId}` }, (payload) => {
        if (isMounted && payload.new) {
          setCurrentOrganization(mapOrganization(payload.new));
        }
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [currentUser?.organizationId]);

  // The organization name lives in the database; keep the UI's copy in sync
  // so the sidebar/slips never show a stale name cached in this browser.
  useEffect(() => {
    if (currentOrganization?.name) {
      setSettings(prev => (prev.orgName === currentOrganization.name ? prev : { ...prev, orgName: currentOrganization.name }));
    }
  }, [currentOrganization]);

  // Live-updates the signed-in user's own profile (role/approved/is_active)
  // so a pending user's screen updates the moment an Admin approves them,
  // with no need to log out and back in.
  useEffect(() => {
    if (!currentUser?.id) return;
    const channel = supabase
      .channel(`self-profile-${currentUser.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${currentUser.id}` }, (payload) => {
        const row = payload.new;
        if (!row) return;
        const isActive = row.is_active !== false;
        if (!isActive) {
          supabase.auth.signOut();
          setCurrentUser(null);
          setAuthNotice('Your account has been disabled. Contact an administrator.');
          return;
        }
        setCurrentUser(prev => (prev ? {
          ...prev,
          role: row.role,
          isActive,
          approved: row.approved !== false,
          organizationId: row.organization_id || prev.organizationId,
          // keep the hierarchy live too, so a promotion (e.g. to Accommodation
          // head) takes effect without logging out and in again
          level: row.level || prev.level,
          subDepartment: row.sub_department || null
        } : prev));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id]);

  // NOTE: there used to be a hardcoded fallback here that logged people in as
  // Admin/Operator/Client using fixed demo passwords, even if Supabase auth
  // rejected them. That's a critical hole (anyone could type those emails and
  // get full Admin access without a real account) and has been removed —
  // every login now goes through real Supabase Auth, no exceptions.
  const login = async (email, password) => {
    const cleanEmail = email.toLowerCase().trim();
    setAuthLoading(true);
    setAuthNotice(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password
      });

      if (error) {
        if (/email not confirmed/i.test(error.message)) {
          setAuthNotice('Please verify your email before signing in — check your inbox for the confirmation link.');
        } else {
          addToast('Invalid email or password.', 'error');
        }
        return false;
      }

      if (data?.user) {
        const profile = await loadProfile(data.user.id);
        if (!profile) {
          await supabase.auth.signOut();
          addToast('We could not load your account. Please try again.', 'error');
          return false;
        }
        if (!profile.isActive) {
          await supabase.auth.signOut();
          setAuthNotice('Your account has been disabled. Contact an administrator.');
          return false;
        }
        setCurrentUser(profile);
        setCurrentTab('dashboard');
        // No toast here: the sign-in screen's welcome animation already greets the person.
        return true;
      }
    } catch (err) {
      addToast('Something went wrong signing in. Please try again.', 'error');
    } finally {
      setAuthLoading(false);
    }
    return false;
  };

  // New accounts JOIN an existing organization by join code (signer becomes a
  // Client, pending approval from that organization's head). Creating a new
  // organization is not allowed — the handle_new_user() trigger enforces this
  // server-side; this metadata is just the request.
  const signUp = async (name, email, password, _orgMode, joinCode) => {
    const cleanEmail = email.toLowerCase().trim();
    setAuthLoading(true);
    setAuthNotice(null);
    try {
      const metaData = { name: name.trim(), org_mode: 'join', join_code: (joinCode || '').trim().toUpperCase() };

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: metaData,
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (error) {
        addToast(error.message || 'Could not create account.', 'error');
        return false;
      }

      // If email confirmation is enabled, Supabase returns a user with no
      // active session yet — send them back to login with instructions.
      if (data?.user && !data.session) {
        setAuthNotice('Account created! Check your email to verify your address, then sign in.');
        setAuthView('login');
        return true;
      }

      if (data?.session?.user) {
        const profile = await loadProfile(data.session.user.id);
        if (!profile) {
          await supabase.auth.signOut();
          setAuthNotice('Account created! Please sign in.');
          setAuthView('login');
          return true;
        }
        setCurrentUser(profile);
        setCurrentTab('dashboard');
        addToast(profile.approved ? `Welcome, ${profile.name}!` : `Account created, ${profile.name}! Waiting on approval from your organization's admin.`, 'success');
        return true;
      }

      setAuthNotice('Account created! You can now sign in.');
      setAuthView('login');
      return true;
    } catch (err) {
      addToast('Something went wrong creating your account.', 'error');
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const sendPasswordReset = async (email) => {
    setAuthLoading(true);
    setAuthNotice(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
        redirectTo: `${window.location.origin}/`
      });
      if (error) {
        addToast(error.message || 'Could not send reset email.', 'error');
        return false;
      }
      setAuthNotice('If an account exists for that email, a reset link is on its way.');
      setAuthView('login');
      return true;
    } catch (err) {
      addToast('Something went wrong requesting a reset link.', 'error');
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  // Called from the reset-password screen, which the user only reaches via
  // the emailed link (Supabase gives them a temporary recovery session).
  const updatePassword = async (newPassword) => {
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        addToast(error.message || 'Could not update password.', 'error');
        return false;
      }
      addToast('Password updated. You can sign in with it now.', 'success');
      await supabase.auth.signOut();
      setCurrentUser(null);
      setAuthView('login');
      return true;
    } catch (err) {
      addToast('Something went wrong updating your password.', 'error');
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const resendVerificationEmail = async (email) => {
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: email.toLowerCase().trim() });
      if (error) {
        addToast(error.message || 'Could not resend verification email.', 'error');
        return false;
      }
      setAuthNotice('Verification email resent — check your inbox.');
      return true;
    } catch (err) {
      addToast('Something went wrong resending the email.', 'error');
      return false;
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) { }
    setCurrentUser(null);
    setAuthView('login');
    addToast('Logged out successfully.', 'info');
  };

  // --------------------------------------------------------------------------
  // ADMIN: USER MANAGEMENT (assign roles, disable access)
  // --------------------------------------------------------------------------
  const fetchAllUsers = useCallback(async () => {
    if (currentUser?.role !== 'Admin') return;
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if (!error && Array.isArray(data)) {
      setAllProfiles(data.map(p => ({
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        isActive: p.is_active !== false,
        approved: p.approved !== false,
        level: p.level || 'other',
        subDepartment: p.sub_department || null,
        departmentId: p.department_id || null,
        createdAt: p.created_at
      })));
    }
  }, [currentUser]);

  const updateUserRole = async (userId, role) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can change roles.', 'error');
      return false;
    }
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
    if (error) {
      addToast(`Failed to update role: ${error.message}`, 'error');
      return false;
    }
    setAllProfiles(prev => prev.map(p => (p.id === userId ? { ...p, role } : p)));
    logAction('Role Changed', `${currentUser.name} set a user's role to ${role}`, 'warning');
    addToast('Role updated.', 'success');
    return true;
  };

  // Admin: set where someone sits in the org hierarchy. This is what decides
  // who may edit Accommodation rooms (level 'owner') and the live meal menu
  // (level 'sub_dept_head' + sub-department 'accommodation').
  const updateUserHierarchy = async (userId, level, subDepartment, departmentId) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can change access levels.', 'error');
      return false;
    }
    const sub = (level === 'sub_dept_head' || level === 'staff') ? (subDepartment || null) : null;
    if (level === 'sub_dept_head' && !sub) {
      addToast('Pick a department for a Sub-dept head.', 'error');
      return false;
    }
    const { data, error } = await supabase.from('profiles')
      .update({ level, sub_department: sub, department_id: departmentId || null }).eq('id', userId).select('level, sub_department, department_id').single();
    if (error || !data) {
      addToast(`Failed to update access level: ${describeDbError(error)}`, 'error');
      return false;
    }
    if (data.level !== level) {
      addToast('The database refused the change. Run supabase/migration_v4_hierarchy.sql first.', 'error');
      return false;
    }
    setAllProfiles(prev => prev.map(p => (p.id === userId ? { ...p, level: data.level, subDepartment: data.sub_department, departmentId: data.department_id } : p)));
    logAction('Access Level Changed', `${currentUser.name} set a user to ${level}${sub ? ` (${sub})` : ''}`, 'warning');
    addToast('Access level updated.', 'success');
    return true;
  };

  const setUserActive = async (userId, isActive) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can enable/disable users.', 'error');
      return false;
    }
    if (userId === currentUser?.id) {
      addToast("You can't disable your own account.", 'error');
      return false;
    }

    // Access control must be enforced by the database, never by this browser's
    // localStorage — so if the DB update fails we report the failure honestly
    // instead of pretending the user was disabled.
    const { error: profileError } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', userId);
    if (profileError) {
      addToast(`Could not ${isActive ? 'enable' : 'disable'} user: ${describeDbError(profileError)}`, 'error');
      return false;
    }
    setAllProfiles(prev => prev.map(p => (p.id === userId ? { ...p, isActive } : p)));

    logAction(isActive ? 'User Re-enabled' : 'User Disabled', `${currentUser.name} ${isActive ? 're-enabled' : 'disabled'} a user account`, 'warning');
    addToast(isActive ? 'User re-enabled.' : 'User access disabled.', 'success');
    return true;
  };

  // Approves a pending sign-up for this organization, letting them in.
  const approveUser = async (userId) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can approve new accounts.', 'error');
      return false;
    }

    setAllProfiles(prev => prev.map(p => (p.id === userId ? { ...p, approved: true } : p)));

    const { error } = await supabase.from('profiles').update({ approved: true }).eq('id', userId);
    if (error) {
      addToast(`Failed to approve user: ${error.message}`, 'error');
      setAllProfiles(prev => prev.map(p => (p.id === userId ? { ...p, approved: false } : p)));
      return false;
    }

    const approvedUser = allProfiles.find(p => p.id === userId);
    logAction('User Approved', `${currentUser.name} approved ${approvedUser ? approvedUser.name : 'a new user'} to join the organization`, 'success');
    addToast('User approved — they now have access.', 'success');
    return true;
  };

  // Denies a pending sign-up (keeps them unapproved AND disables the
  // account so they can't retry indefinitely without an admin's say-so).
  const denyUser = async (userId) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can deny new accounts.', 'error');
      return false;
    }
    const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', userId);
    if (error) {
      addToast(`Could not deny request: ${describeDbError(error)}`, 'error');
      return false;
    }
    setAllProfiles(prev => prev.map(p => (p.id === userId ? { ...p, isActive: false } : p)));

    logAction('User Denied', `${currentUser.name} denied a pending account request`, 'warning');
    addToast('Request denied.', 'success');
    return true;
  };

  // Regenerates the organization's join code (Admin only) — useful if the
  // old code was shared too widely.
  const regenerateJoinCode = async () => {
    if (currentUser?.role !== 'Admin' || !currentUser.organizationId) {
      addToast('Only Administrators can regenerate the join code.', 'error');
      return false;
    }
    const newCode = Math.random().toString(36).slice(2, 10).toUpperCase();
    const { data, error } = await supabase
      .from('organizations')
      .update({ join_code: newCode })
      .eq('id', currentUser.organizationId)
      .select()
      .maybeSingle();
    if (error) {
      addToast(`Failed to regenerate join code: ${error.message}`, 'error');
      return false;
    }
    if (data) {
      setCurrentOrganization(mapOrganization(data));
    }
    logAction('Join Code Regenerated', `${currentUser.name} regenerated the organization's join code`, 'info');
    addToast('New join code generated.', 'success');
    return true;
  };

  // Super Admin only: change the organization's name and logo (logo is a data URL, or null to remove it).
  const updateOrganization = async (name, logoUrl) => {
    const { error } = await supabase.rpc('update_organization_profile', { p_name: name, p_logo: logoUrl || null });
    if (error) {
      return /update_organization_profile|schema cache/i.test(error.message || '')
        ? 'Run supabase/migration_v94_org_profile_and_delete_member.sql in the Supabase SQL Editor, then reload.'
        : error.message;
    }
    setCurrentOrganization(prev => (prev ? { ...prev, name: name.trim(), logoUrl: logoUrl || null } : prev));
    logAction('Organization Updated', `${currentUser?.name} updated the organization name/logo`, 'info');
    return null;
  };

  useEffect(() => {
    if (currentUser?.role === 'Admin') {
      fetchAllUsers();
    } else {
      setAllProfiles([]);
    }
  }, [currentUser, fetchAllUsers]);


  useEffect(() => {
    try {
      localStorage.setItem('wt_settings', JSON.stringify(settings));
    } catch (e) { }
  }, [settings]);

  // --------------------------------------------------------------------------
  // INITIAL DATA LOAD + REALTIME SYNC
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUser || !currentUser.approved) {
      setDataLoading(!!currentUser && !currentUser.approved ? false : true);
      return;
    }

    let isMounted = true;

    const loadAll = async () => {
      setDataLoading(true);
      try {
        const [w, d, a, m, h, dh, dl, inv] = await Promise.all([
          supabase.from('walkies').select('*').order('created_at', { ascending: true }),
          supabase.from('departments').select('*').order('created_at', { ascending: true }),
          (eventId ? supabase.from('allocations').select('*').eq('event_id', eventId) : supabase.from('allocations').select('*').is('event_id', null)).order('created_at', { ascending: false }),
          supabase.from('maintenance').select('*').order('created_at', { ascending: false }),
          supabase.from('history').select('*').order('created_at', { ascending: false }).limit(300),
          supabase.from('department_heads').select('*').order('created_at', { ascending: true }),
          (eventId ? supabase.from('deliveries').select('*').eq('event_id', eventId) : supabase.from('deliveries').select('*').is('event_id', null)).order('created_at', { ascending: false }),
          supabase.from('inventory_settings').select('*').eq('organization_id', currentUser.organizationId).maybeSingle()
        ]);

        if (!isMounted) return;

        // Each table loads independently, so one failing query can't blank
        // out (or fake) the others. Errors are shown, never swallowed.
        const failed = [];
        const apply = (name, res, setter, mapper) => {
          if (res.error) { failed.push(`${name}: ${res.error.message}`); return; }
          if (Array.isArray(res.data)) setter(res.data.map(mapper));
        };
        apply('walkies', w, setWalkies, mapWalkie);
        apply('departments', d, setDepartments, mapDepartment);
        apply('allocations', a, setAllocations, mapAllocation);
        apply('maintenance', m, setMaintenance, mapMaintenance);
        apply('history', h, setHistory, mapHistory);
        if (failed.length) {
          // eslint-disable-next-line no-console
          console.error('Failed to load some data:', failed);
          addToast(`Could not load some data (${failed[0]}). Check your connection and the Supabase setup.`, 'error');
        }

        // New tables (department heads / deliveries / accessory inventory) are
        // handled independently so a missing migration doesn't block the rest
        // of the app's data from loading.
        if (!dh.error && Array.isArray(dh.data)) setDepartmentHeads(dh.data.map(mapDepartmentHead));
        if (!dl.error && Array.isArray(dl.data)) setDeliveries(dl.data.map(mapDelivery));
        if (!inv.error && inv.data) setInventorySettings(mapInventorySettings(inv.data));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Supabase fetch failed:', err);
        addToast('Could not reach the database. Please check your connection and reload.', 'error');
      } finally {
        if (isMounted) setDataLoading(false);
      }
    };

    loadAll();

    // Generic realtime handler factory: applies INSERT/UPDATE/DELETE payloads
    // to a piece of local state using the matching row-mapper.
    const makeHandler = (setState, mapRow, prepend = false, eventScoped = false) => (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (eventScoped && row?.event_id !== undefined && (row?.event_id || null) !== eventId) return;
      setState(prev => {
        if (payload.eventType === 'INSERT') {
          if (prev.some(r => r.id === payload.new.id)) return prev;
          return prepend ? [mapRow(payload.new), ...prev] : [...prev, mapRow(payload.new)];
        }
        if (payload.eventType === 'UPDATE') {
          return prev.map(r => (r.id === payload.new.id ? mapRow(payload.new) : r));
        }
        if (payload.eventType === 'DELETE') {
          return prev.filter(r => r.id !== payload.old.id);
        }
        return prev;
      });
    };

    const channel = supabase
      .channel('radiogate-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walkies' }, makeHandler(setWalkies, mapWalkie))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, makeHandler(setDepartments, mapDepartment))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'allocations' }, makeHandler(setAllocations, mapAllocation, true, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' }, makeHandler(setMaintenance, mapMaintenance, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'history' }, makeHandler(setHistory, mapHistory, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'department_heads' }, makeHandler(setDepartmentHeads, mapDepartmentHead))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, makeHandler(setDeliveries, mapDelivery, true, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_settings' }, (payload) => {
        if (payload.eventType === 'DELETE') return;
        setInventorySettings(mapInventorySettings(payload.new));
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [currentUser, addToast, eventId]);

  // --------------------------------------------------------------------------
  // WALKIE TALKIE ACTIONS
  // --------------------------------------------------------------------------
  const addWalkie = async (walkie) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to add assets', 'error');
      return false;
    }
    const newWalkieRow = {
      id: walkie.id || `WT-${Math.floor(100 + Math.random() * 900)}`,
      label: walkie.label,
      serial: null,
      model: walkie.model,
      status: walkie.status || 'Available',
      department_id: null,
      channel: '',
      assigned_person_name: null,
      assigned_person_contact: null,
      notes: walkie.notes || '',
      organization_id: currentUser.organizationId
    };

    // Optimistically add to local state
    setWalkies(prev => [...prev, mapWalkie(newWalkieRow)]);

    const { error } = await supabase.from('walkies').insert(newWalkieRow);
    if (error) {
      setWalkies(prev => prev.filter(w => w.id !== newWalkieRow.id));
      const dup = /duplicate|unique/i.test(error.message);
      addToast(dup ? `A walkie with ID ${newWalkieRow.id} already exists.` : `Failed to save walkie: ${describeDbError(error)}`, 'error');
      return false;
    }
    addToast(`Walkie ${newWalkieRow.id} added successfully!`);
    logAction('Walkie Added', `Added ${newWalkieRow.label} (${newWalkieRow.id}) by ${currentUser.name}`, 'success');
    return true;
  };

  const editWalkie = async (id, updatedFields) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to edit assets', 'error');
      return false;
    }
    const payload = {};
    if (updatedFields.label !== undefined) payload.label = updatedFields.label;
    if (updatedFields.model !== undefined) payload.model = updatedFields.model;
    if (updatedFields.notes !== undefined) payload.notes = updatedFields.notes;
    payload.updated_at = new Date().toISOString();

    const before = walkies.find(w => w.id === id);
    // Optimistically update local state, roll back if the database says no
    setWalkies(prev => prev.map(w => w.id === id ? { ...w, ...updatedFields } : w));

    const { error } = await supabase.from('walkies').update(payload).eq('id', id);
    if (error) {
      if (before) setWalkies(prev => prev.map(w => w.id === id ? before : w));
      addToast(`Failed to update walkie: ${describeDbError(error)}`, 'error');
      return false;
    }
    logAction('Walkie Updated', `Updated fields for Walkie ID ${id} by ${currentUser.name}`, 'info');
    addToast(`Walkie ${id} updated.`);
    return true;
  };

  const deleteWalkie = async (id) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can delete assets.', 'error');
      return false;
    }
    const walkie = walkies.find(w => w.id === id);
    if (walkie && walkie.status === 'Allocated') {
      addToast(`Cannot delete Walkie ${id} while it is Allocated. Return it first!`, 'error');
      return false;
    }

    const { error } = await supabase.from('walkies').delete().eq('id', id);
    if (error) {
      addToast(`Failed to delete walkie: ${describeDbError(error)}`, 'error');
      return false;
    }
    setWalkies(prev => prev.filter(w => w.id !== id));
    setMaintenance(prev => prev.filter(m => m.walkieId !== id));
    logAction('Walkie Deleted', `Deleted Walkie ID ${id} by ${currentUser.name}`, 'warning');
    addToast(`Walkie ${id} deleted.`);
    return true;
  };

  const bulkDeleteWalkies = async (ids) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can delete assets.', 'error');
      return false;
    }
    const deletableWalkies = walkies.filter(w => ids.includes(w.id) && w.status !== 'Allocated');
    const blockedWalkies = walkies.filter(w => ids.includes(w.id) && w.status === 'Allocated');

    if (deletableWalkies.length === 0) {
      addToast('Selected walkies are allocated and cannot be deleted.', 'error');
      return false;
    }

    const deletableIds = deletableWalkies.map(w => w.id);
    const { error: delError } = await supabase.from('walkies').delete().in('id', deletableIds);
    if (delError) {
      addToast(`Bulk delete failed: ${describeDbError(delError)}`, 'error');
      return false;
    }
    setWalkies(prev => prev.filter(w => !deletableIds.includes(w.id)));
    logAction('Bulk Walkies Deleted', `Deleted ${deletableWalkies.length} walkies by ${currentUser.name}`, 'warning');

    if (blockedWalkies.length > 0) {
      addToast(`${deletableWalkies.length} deleted. ${blockedWalkies.length} allocated walkies skipped.`, 'warning');
    } else {
      addToast(`${deletableWalkies.length} walkies deleted successfully.`);
    }
    return true;
  };

  const bulkAddWalkies = async (prefix, startNum, count, model, notes) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can bulk generate devices.', 'error');
      return false;
    }
    const newItems = [];
    for (let i = 0; i < count; i++) {
      const currentIdNum = parseInt(startNum, 10) + i;
      const generatedId = `${prefix}-${currentIdNum}`;
      if (!walkies.some(w => w.id === generatedId)) {
        newItems.push({
          id: generatedId,
          label: `${prefix} ${currentIdNum}`,
          serial: null,
          model: model || 'Standard UHF',
          status: 'Available',
          department_id: null,
          channel: '',
          assigned_person_name: null,
          assigned_person_contact: null,
          notes: notes || 'Bulk imported',
          organization_id: currentUser.organizationId
        });
      }
    }

    if (newItems.length === 0) {
      addToast('No new walkies were added. The Walkie IDs might already exist.', 'error');
      return false;
    }

    const { error } = await supabase.from('walkies').insert(newItems);
    if (error) {
      addToast(`Bulk add failed: ${describeDbError(error)}`, 'error');
      return false;
    }
    setWalkies(prev => [...prev, ...newItems.filter(n => !prev.some(w => w.id === n.id)).map(mapWalkie)]);
    logAction('Bulk Walkies Added', `Added ${newItems.length} walkies using prefix ${prefix} by ${currentUser.name}`, 'success');
    addToast(`Successfully bulk added ${newItems.length} walkie talkies!`);
    return true;
  };

  // --------------------------------------------------------------------------
  // DEPARTMENT ACTIONS
  // --------------------------------------------------------------------------
  const addDepartment = async (dept) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage departments.', 'error');
      return false;
    }
    if (!dept.name.trim()) {
      addToast('Department name cannot be empty!', 'error');
      return false;
    }
    if (!dept.channelNumber || !dept.channelNumber.trim()) {
      addToast('Please assign a channel number to this department!', 'error');
      return false;
    }
    const channelNumber = dept.channelNumber.trim();
    if (departments.some(d => d.channelNumber && d.channelNumber.toLowerCase() === channelNumber.toLowerCase())) {
      addToast(`Channel ${channelNumber} is already assigned to another department!`, 'error');
      return false;
    }
    const newDept = {
      id: `dept-${Date.now()}`,
      name: dept.name,
      description: dept.description || '',
      code: dept.code || '',
      channel_number: channelNumber,
      organization_id: currentUser.organizationId
    };

    // Optimistically update local state immediately
    setDepartments(prev => [...prev, mapDepartment(newDept)]);

    const { error } = await supabase.from('departments').insert(newDept);
    if (error) {
      setDepartments(prev => prev.filter(d => d.id !== newDept.id));
      addToast(`Failed to save department: ${describeDbError(error)}`, 'error');
      return false;
    }
    addToast(`Department "${newDept.name}" created on channel ${newDept.channel_number}.`);
    logAction('Department Added', `Created department: ${newDept.name} on channel ${newDept.channel_number} by ${currentUser.name}`, 'success');
    return true;
  };

  const editDepartment = async (id, updatedFields) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage departments.', 'error');
      return false;
    }
    if (updatedFields.name !== undefined && !updatedFields.name.trim()) {
      addToast('Department name cannot be empty!', 'error');
      return false;
    }

    if (!['Admin', 'Operator'].includes(currentUser?.role)) {
      const { error } = await supabase.rpc('department_set_channel', { p_department_id: id, p_channel: updatedFields.channelNumber || '' });
      if (error) { addToast(`Failed to update channel: ${error.message}`, 'error'); return false; }
      setDepartments(prev => prev.map(d => d.id === id ? { ...d, channelNumber: updatedFields.channelNumber.trim() } : d));
      setWalkies(prev => prev.map(w => w.departmentId === id && w.status === 'Allocated' ? { ...w, channel: updatedFields.channelNumber.trim() } : w));
      addToast('Department channel updated and synced to allocated radios.');
      return true;
    }

    const payload = {};
    if (updatedFields.name !== undefined) payload.name = updatedFields.name;
    if (updatedFields.description !== undefined) payload.description = updatedFields.description;
    if (updatedFields.code !== undefined) payload.code = (updatedFields.code || '').trim().toUpperCase();

    let channelChanged = false;
    let newChannelNumber = null;

    if (updatedFields.channelNumber !== undefined) {
      const trimmedChannel = updatedFields.channelNumber.trim();
      if (!trimmedChannel) {
        addToast('Channel number cannot be empty!', 'error');
        return false;
      }
      const duplicate = departments.find(d => d.id !== id && d.channelNumber && d.channelNumber.toLowerCase() === trimmedChannel.toLowerCase());
      if (duplicate) {
        addToast(`Channel ${trimmedChannel} is already assigned to another department!`, 'error');
        return false;
      }
      const currentDept = departments.find(d => d.id === id);
      if (currentDept && currentDept.channelNumber !== trimmedChannel) {
        channelChanged = true;
        newChannelNumber = trimmedChannel;
      }
      payload.channel_number = trimmedChannel;
    }

    const { error } = await supabase.from('departments').update(payload).eq('id', id);
    if (error) {
      addToast(`Failed to update department: ${error.message}`, 'error');
      return false;
    }

    // Keep every walkie currently allocated to this department in sync with its channel number
    if (channelChanged) {
      await supabase.from('walkies').update({ channel: newChannelNumber }).eq('department_id', id).eq('status', 'Allocated');
      logAction('Department Channel Updated', `Channel for department ID ${id} changed to ${newChannelNumber}; propagated to all radios allocated there, by ${currentUser.name}`, 'info');
    }

    logAction('Department Updated', `Updated department ID ${id} by ${currentUser.name}`, 'info');
    addToast('Department details updated.');
    return true;
  };

  const deleteDepartment = async (id, force = false) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can delete departments.', 'error');
      return { error: true };
    }
    const allocatedWalkiesCount = walkies.filter(w => w.departmentId === id && w.status === 'Allocated').length;

    if (allocatedWalkiesCount > 0 && !force) {
      addToast(`Cannot delete. Department has ${allocatedWalkiesCount} active walkie allocations.`, 'error');
      return { error: true, count: allocatedWalkiesCount };
    }

    // Free the radios first (and close their active allocations so the
    // accessories they held go back to stock), then delete the department.
    if (force) {
      const { error: freeErr } = await supabase.from('walkies')
        .update({ status: 'Available', department_id: null, channel: '', assigned_person_name: null, assigned_person_contact: null })
        .eq('department_id', id).eq('status', 'Allocated');
      if (freeErr) {
        addToast(`Could not release radios: ${describeDbError(freeErr)}`, 'error');
        return { error: true };
      }
      await supabase.from('allocations')
        .update({ status: 'Returned', returned_date: new Date().toISOString().split('T')[0] })
        .eq('department_id', id).eq('status', 'Active');
    }

    const { error: delErr } = await supabase.from('departments').delete().eq('id', id);
    if (delErr) {
      addToast(`Failed to delete department: ${describeDbError(delErr)}`, 'error');
      return { error: true };
    }

    setDepartments(prev => prev.filter(d => d.id !== id));
    setWalkies(prev => prev.map(w => w.departmentId === id ? { ...w, departmentId: '', channel: '', assignedPerson: w.status === 'Allocated' ? null : w.assignedPerson, status: w.status === 'Allocated' ? 'Available' : w.status } : w));
    setAllocations(prev => prev.map(a => (a.departmentId === id && a.status === 'Active') ? { ...a, status: 'Returned', returnedDate: new Date().toISOString().split('T')[0] } : a));
    // Department heads cascade-delete in the DB; mirror that locally right away.
    setDepartmentHeads(prev => prev.filter(h => h.departmentId !== id));
    setDeliveries(prev => prev.map(d => d.departmentId === id ? { ...d, departmentId: '' } : d));

    logAction(force ? 'Department Force Deleted' : 'Department Deleted', force
      ? `Deleted department ID ${id} and forced return of active walkies by ${currentUser.name}`
      : `Deleted department ID ${id} by ${currentUser.name}`, 'warning');
    addToast('Department deleted successfully.');
    return { error: false };
  };

  // --------------------------------------------------------------------------
  // ALLOCATION ACTIONS
  // --------------------------------------------------------------------------
  const allocateWalkies = async (departmentId, selectedWalkieIds, allocatedBy, remarks, holderName = '', holderContact = '', chargers = 0, earphones = 0) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to allocate radios.', 'error');
      return false;
    }
    if (!departmentId || selectedWalkieIds.length === 0) {
      addToast('Please select a department and at least one walkie.', 'error');
      return false;
    }

    const unavailable = selectedWalkieIds.filter(id => {
      const walkie = walkies.find(w => w.id === id);
      return !walkie || walkie.status !== 'Available';
    });
    if (unavailable.length > 0) {
      addToast(`Some selected walkies are no longer available: ${unavailable.join(', ')}`, 'error');
      return false;
    }

    const cN = Math.max(0, parseInt(chargers, 10) || 0);
    const eN = Math.max(0, parseInt(earphones, 10) || 0);
    if (cN > availableChargers) { addToast(`Only ${availableChargers} chargers are available.`, 'error'); return false; }
    if (eN > availableEarphones) { addToast(`Only ${availableEarphones} earphones are available.`, 'error'); return false; }

    const dept = departments.find(d => d.id === departmentId);
    const deptName = dept ? dept.name : 'Unknown Department';
    const trimmedHolder = holderName.trim();

    const newAllocRow = {
      id: `alloc-${Date.now()}`,
      department_id: departmentId,
      walkie_ids: selectedWalkieIds,
      date: new Date().toISOString().split('T')[0],
      allocated_by: allocatedBy || currentUser.name,
      remarks: remarks || '',
      status: 'Active',
      charger_count: cN,
      earphone_count: eN,
      event_id: eventId,
      organization_id: currentUser.organizationId
    };

    const { error: allocError } = await supabase.from('allocations').insert(newAllocRow);
    if (allocError) {
      addToast(`Failed to create allocation: ${describeDbError(allocError)}`, 'error');
      return false;
    }

    const walkiePayload = {
      status: 'Allocated',
      department_id: departmentId,
      channel: dept ? dept.channelNumber : null
    };
    if (trimmedHolder) {
      walkiePayload.assigned_person_name = trimmedHolder;
      walkiePayload.assigned_person_contact = holderContact.trim();
    }

    const { error: walkieError } = await supabase.from('walkies').update(walkiePayload).in('id', selectedWalkieIds);
    if (walkieError) {
      // Undo the allocation row so we never leave an "Active" allocation whose
      // radios were not actually marked as allocated (it would hold accessories forever).
      await supabase.from('allocations').delete().eq('id', newAllocRow.id);
      addToast(`Allocation cancelled — updating radios failed: ${describeDbError(walkieError)}`, 'error');
      return false;
    }

    // Reflect immediately (realtime will dedupe/confirm these)
    setAllocations(prev => (prev.some(a => a.id === newAllocRow.id) ? prev : [mapAllocation(newAllocRow), ...prev]));
    setWalkies(prev => prev.map(w => selectedWalkieIds.includes(w.id) ? {
      ...w,
      status: 'Allocated',
      departmentId,
      channel: dept ? dept.channelNumber : '',
      assignedPerson: trimmedHolder ? { name: trimmedHolder, contact: holderContact.trim() } : w.assignedPerson
    } : w));

    logAction('Walkies Allocated', `Allocated ${selectedWalkieIds.length} walkies to ${deptName} on channel ${dept ? dept.channelNumber : 'N/A'} by ${currentUser.name}${trimmedHolder ? `. Held by ${trimmedHolder}` : ''}`, 'success');
    addToast(`Allocated ${selectedWalkieIds.length} walkies to ${deptName} (Channel ${dept ? dept.channelNumber : 'N/A'})!`);
    return mapAllocation(newAllocRow);
  };

  // Bulk Allocation by Number — auto-picks N available walkies (optionally filtered by model)
  const allocateByCount = async (departmentId, count, allocatedBy, remarks, holderName = '', holderContact = '', modelFilter = '', chargers = 0, earphones = 0) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to allocate radios.', 'error');
      return false;
    }
    if (!departmentId || !count || count <= 0) {
      addToast('Please select a department and enter a valid quantity.', 'error');
      return false;
    }

    const pool = walkies.filter(w => w.status === 'Available' && (!modelFilter || w.model === modelFilter));
    if (pool.length === 0) {
      addToast('No available walkies match that criteria.', 'error');
      return false;
    }
    if (pool.length < count) {
      addToast(`Only ${pool.length} matching walkies are available (requested ${count}).`, 'error');
      return false;
    }

    const pickedIds = pool.slice(0, count).map(w => w.id);
    return allocateWalkies(departmentId, pickedIds, allocatedBy, remarks, holderName, holderContact, chargers, earphones);
  };

  // Return Walkies
  const returnWalkies = async (walkieIds, returnRemarks = '') => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to check-in radios.', 'error');
      return false;
    }
    if (walkieIds.length === 0) return false;

    const { error: walkieError } = await supabase
      .from('walkies')
      .update({ status: 'Available', department_id: null, channel: '', assigned_person_name: null, assigned_person_contact: null })
      .in('id', walkieIds);
    if (walkieError) {
      addToast(`Failed to return walkies: ${walkieError.message}`, 'error');
      return false;
    }

    setWalkies(prev => prev.map(w => walkieIds.includes(w.id)
      ? { ...w, status: 'Available', departmentId: '', channel: '', assignedPerson: null }
      : w
    ));

    setAllocations(prev => prev.map((alloc) => {
      if (alloc.status !== 'Active') return alloc;
      const remainingWalkies = alloc.walkieIds.filter(id => !walkieIds.includes(id));
      if (remainingWalkies.length === alloc.walkieIds.length) return alloc;
      if (remainingWalkies.length === 0) {
        return { ...alloc, status: 'Returned', returnedDate: new Date().toISOString().split('T')[0] };
      }
      return { ...alloc, walkieIds: remainingWalkies };
    }));

    // Update or close out any active allocation rows that reference these walkies
    const activeAllocs = allocations.filter(a => a.status === 'Active');
    for (const alloc of activeAllocs) {
      const remainingWalkies = alloc.walkieIds.filter(id => !walkieIds.includes(id));
      if (remainingWalkies.length === alloc.walkieIds.length) continue; // this allocation is unaffected

      const { error: bookErr } = remainingWalkies.length === 0
        ? await supabase.from('allocations').update({
          status: 'Returned',
          returned_date: new Date().toISOString().split('T')[0]
        }).eq('id', alloc.id)
        : await supabase.from('allocations').update({ walkie_ids: remainingWalkies }).eq('id', alloc.id);
      if (bookErr) {
        addToast(`Radios returned, but allocation record ${alloc.id} could not be updated: ${describeDbError(bookErr)}`, 'warning');
      }
    }

    logAction('Walkies Returned', `Returned ${walkieIds.length} walkies back to inventory by ${currentUser.name}. Remarks: ${returnRemarks || 'None'}`, 'success');
    addToast(`Successfully returned ${walkieIds.length} walkies.`);
    return true;
  };

  // Transfer Walkie (optionally moving chargers / earphones along with it).
  // Accessories are taken from the allocation batch the radio currently
  // belongs to and handed to the destination department in a new allocation.
  const transferWalkie = async (walkieId, targetDepartmentId, remarks, chargers = 0, earphones = 0) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to transfer radios.', 'error');
      return false;
    }
    const walkie = walkies.find(w => w.id === walkieId);
    if (!walkie) return false;
    if (walkie.status !== 'Allocated') {
      addToast('Only allocated radios can be transferred.', 'error');
      return false;
    }

    const sourceDept = departments.find(d => d.id === walkie.departmentId);
    const targetDept = departments.find(d => d.id === targetDepartmentId);
    if (!targetDept) {
      addToast('Target department not found', 'error');
      return false;
    }
    if (walkie.departmentId === targetDepartmentId) {
      addToast('This radio is already in that department.', 'error');
      return false;
    }

    const priorAlloc = allocations.find(a => a.status === 'Active' && a.walkieIds.includes(walkieId));
    const cN = Math.max(0, parseInt(chargers, 10) || 0);
    const eN = Math.max(0, parseInt(earphones, 10) || 0);
    const heldChargers = priorAlloc ? priorAlloc.chargerCount : 0;
    const heldEarphones = priorAlloc ? priorAlloc.earphoneCount : 0;
    if (cN > heldChargers) { addToast(`Only ${heldChargers} chargers are held by this radio's current batch.`, 'error'); return false; }
    if (eN > heldEarphones) { addToast(`Only ${heldEarphones} earphones are held by this radio's current batch.`, 'error'); return false; }

    const today = new Date().toISOString().split('T')[0];

    // 1) Create the destination allocation first (carries the accessories)
    const newAllocRow = {
      id: `alloc-${Date.now()}`,
      department_id: targetDepartmentId,
      walkie_ids: [walkieId],
      date: today,
      allocated_by: currentUser.name,
      remarks: `Transferred from ${sourceDept ? sourceDept.name : 'Unknown'}. ${remarks || ''}`.trim(),
      status: 'Active',
      charger_count: cN,
      earphone_count: eN,
      organization_id: currentUser.organizationId
    };
    const { error: allocError } = await supabase.from('allocations').insert(newAllocRow);
    if (allocError) {
      addToast(`Transfer failed: ${describeDbError(allocError)}`, 'error');
      return false;
    }

    // 2) Move the radio itself
    const { error: walkieError } = await supabase
      .from('walkies')
      .update({ department_id: targetDepartmentId, status: 'Allocated', channel: targetDept.channelNumber })
      .eq('id', walkieId);
    if (walkieError) {
      await supabase.from('allocations').delete().eq('id', newAllocRow.id);
      addToast(`Transfer failed: ${describeDbError(walkieError)}`, 'error');
      return false;
    }

    // 3) Take the radio (and the moved accessories) out of the source batch.
    //    If that was the batch's last radio, the batch closes and anything
    //    not moved returns to stock — same rule as a normal return.
    let sourceUpdate = null;
    if (priorAlloc) {
      const remaining = priorAlloc.walkieIds.filter(id => id !== walkieId);
      sourceUpdate = remaining.length === 0
        ? { status: 'Returned', returned_date: today }
        : { walkie_ids: remaining, charger_count: heldChargers - cN, earphone_count: heldEarphones - eN };
      const { error: srcError } = await supabase.from('allocations').update(sourceUpdate).eq('id', priorAlloc.id);
      if (srcError) {
        addToast(`Radio moved, but the source allocation could not be updated: ${describeDbError(srcError)}`, 'warning');
      }
    }

    // Local state (realtime will confirm)
    setWalkies(prev => prev.map(w => w.id === walkieId ? { ...w, departmentId: targetDepartmentId, status: 'Allocated', channel: targetDept.channelNumber } : w));
    setAllocations(prev => {
      const updated = prev.map(a => {
        if (!priorAlloc || a.id !== priorAlloc.id) return a;
        const remaining = a.walkieIds.filter(id => id !== walkieId);
        return remaining.length === 0
          ? { ...a, walkieIds: remaining, status: 'Returned', returnedDate: today }
          : { ...a, walkieIds: remaining, chargerCount: heldChargers - cN, earphoneCount: heldEarphones - eN };
      });
      return updated.some(a => a.id === newAllocRow.id) ? updated : [mapAllocation(newAllocRow), ...updated];
    });

    const accText = (cN || eN) ? ` with ${cN} charger(s) and ${eN} earphone(s)` : '';
    logAction('Walkie Transferred', `Transferred ${walkie.label} (${walkieId}) from ${sourceDept ? sourceDept.name : 'None'} to ${targetDept.name} (Channel ${targetDept.channelNumber})${accText} by ${currentUser.name}`, 'info');
    addToast(`Transferred ${walkie.label} to ${targetDept.name}${accText}`);
    return true;
  };

  // --------------------------------------------------------------------------
  // PERSON TRACKING
  // --------------------------------------------------------------------------
  const assignPersonToWalkie = async (walkieId, personName, personContact = '') => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to assign personnel.', 'error');
      return false;
    }
    const walkie = walkies.find(w => w.id === walkieId);
    if (!walkie) return false;

    const trimmedName = personName.trim();
    const { error } = await supabase.from('walkies').update({
      assigned_person_name: trimmedName || null,
      assigned_person_contact: trimmedName ? personContact.trim() : null
    }).eq('id', walkieId);

    if (error) {
      addToast(`Failed to update holder: ${error.message}`, 'error');
      return false;
    }

    if (trimmedName) {
      logAction('Person Assigned', `Walkie ${walkieId} (${walkie.label}) is now held by ${trimmedName} — set by ${currentUser.name}`, 'success');
      addToast(`Walkie ${walkieId} assigned to ${trimmedName}.`);
    } else {
      logAction('Person Unassigned', `Walkie ${walkieId} (${walkie.label}) no longer has an assigned holder — cleared by ${currentUser.name}`, 'info');
      addToast(`Cleared assigned holder for ${walkieId}.`);
    }
    return true;
  };

  // --------------------------------------------------------------------------
  // MAINTENANCE ACTIONS
  // --------------------------------------------------------------------------
  const sendToMaintenance = async (walkieId, issue, technician) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage maintenance pipelines.', 'error');
      return false;
    }
    const walkie = walkies.find(w => w.id === walkieId);
    if (!walkie) return false;

    if (walkie.status === 'Allocated') {
      await returnWalkies([walkieId], 'Sent directly to maintenance');
    }

    const priorHolder = walkie.assignedPerson?.name;

    const { error: walkieError } = await supabase.from('walkies').update({
      status: 'Under Maintenance',
      channel: '',
      assigned_person_name: null,
      assigned_person_contact: null
    }).eq('id', walkieId);
    if (walkieError) {
      addToast(`Failed to send to maintenance: ${walkieError.message}`, 'error');
      return false;
    }

    const { error: maintError } = await supabase.from('maintenance').insert({
      id: `maint-${Date.now()}`,
      walkie_id: walkieId,
      issue,
      date: new Date().toISOString().split('T')[0],
      technician: technician || 'On-site Tech',
      status: 'In Progress',
      organization_id: currentUser.organizationId
    });
    if (maintError) {
      addToast(`Failed to log maintenance record: ${maintError.message}`, 'error');
      return false;
    }

    logAction('Sent to Maintenance', `Walkie ${walkieId} marked for maintenance. Issue: ${issue} (by ${currentUser.name})${priorHolder ? `. Previously held by ${priorHolder}` : ''}`, 'warning');
    addToast(`Walkie ${walkieId} is now under maintenance.`);
    return true;
  };

  const completeMaintenance = async (maintId, statusUpdate, notes = '') => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage maintenance pipelines.', 'error');
      return false;
    }
    const record = maintenance.find(m => m.id === maintId);
    if (!record) return false;

    const { error: maintError } = await supabase.from('maintenance').update({ status: 'Completed' }).eq('id', maintId);
    if (maintError) {
      addToast(`Failed to update maintenance record: ${maintError.message}`, 'error');
      return false;
    }

    const { error: walkieError } = await supabase.from('walkies').update({ status: 'Available' }).eq('id', record.walkieId);
    if (walkieError) {
      addToast(`Failed to update walkie status: ${walkieError.message}`, 'error');
      return false;
    }

    logAction('Maintenance Completed', `Walkie ${record.walkieId} service finished by ${currentUser.name}. Status: ${statusUpdate}. Notes: ${notes}`, 'success');
    addToast(`Walkie ${record.walkieId} is now Available.`);
    return true;
  };

  // --------------------------------------------------------------------------
  // ADMIN: RESET TO DEMO DATA
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // DEPARTMENT HEAD ACTIONS  (a department can have more than one head; an
  // Admin/Operator can add, edit, or remove them at any time)
  // --------------------------------------------------------------------------
  const addDepartmentHead = async (departmentId, name, mobileNumber) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage department heads.', 'error');
      return false;
    }
    const trimmedName = (name || '').trim();
    const trimmedMobile = (mobileNumber || '').trim();
    if (!departmentId || !trimmedName || !trimmedMobile) {
      addToast('Please provide a department, head name, and mobile number.', 'error');
      return false;
    }

    const newHeadRow = {
      id: `head-${Date.now()}`,
      department_id: departmentId,
      name: trimmedName,
      mobile_number: trimmedMobile,
      organization_id: currentUser.organizationId
    };

    setDepartmentHeads(prev => [...prev, mapDepartmentHead(newHeadRow)]);

    const { error } = await supabase.from('department_heads').insert(newHeadRow);
    if (error) {
      addToast(`Failed to save department head: ${error.message}`, 'error');
      setDepartmentHeads(prev => prev.filter(h => h.id !== newHeadRow.id));
      return false;
    }

    logAction('Department Head Added', `Added ${trimmedName} (${trimmedMobile}) as a head by ${currentUser.name}`, 'success');
    addToast(`${trimmedName} added as a department head.`);
    return true;
  };

  const editDepartmentHead = async (id, updatedFields) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage department heads.', 'error');
      return false;
    }
    const payload = {};
    if (updatedFields.name !== undefined) payload.name = updatedFields.name.trim();
    if (updatedFields.mobileNumber !== undefined) payload.mobile_number = updatedFields.mobileNumber.trim();

    setDepartmentHeads(prev => prev.map(h => (h.id === id ? { ...h, ...updatedFields } : h)));

    const { error } = await supabase.from('department_heads').update(payload).eq('id', id);
    if (error) {
      addToast(`Failed to update department head: ${error.message}`, 'error');
      return false;
    }

    logAction('Department Head Updated', `Updated department head ID ${id} by ${currentUser.name}`, 'info');
    addToast('Department head updated.');
    return true;
  };

  const deleteDepartmentHead = async (id) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to manage department heads.', 'error');
      return false;
    }
    const head = departmentHeads.find(h => h.id === id);
    setDepartmentHeads(prev => prev.filter(h => h.id !== id));

    const { error } = await supabase.from('department_heads').delete().eq('id', id);
    if (error) {
      addToast(`Failed to remove department head: ${error.message}`, 'error');
      return false;
    }

    logAction('Department Head Removed', `Removed ${head ? head.name : id} as a department head by ${currentUser.name}`, 'warning');
    addToast('Department head removed.');
    return true;
  };

  // Returns the wa.me links for every head of a department, given a message.
  const getWhatsAppLinksForDepartment = (departmentId, message) => {
    return departmentHeads
      .filter(h => h.departmentId === departmentId)
      .map(h => ({ id: h.id, name: h.name, mobileNumber: h.mobileNumber, link: buildWhatsAppLink(h.mobileNumber, message) }));
  };

  // --------------------------------------------------------------------------
  // INVENTORY SETTINGS  (total earphone stock — chargers always equal the
  // walkie count 1:1, so they are never tracked as a separate limited pool)
  // --------------------------------------------------------------------------
  const activeAllocs = allocations.filter(a => a.status === 'Active');
  const sumOf = (k) => activeAllocs.reduce((t, a) => t + (a[k] || 0), 0);
  const allocatedChargers = sumOf('chargerCount');
  const allocatedEarphones = sumOf('earphoneCount');
  const availableChargers = (inventorySettings.totalChargers || 0) - allocatedChargers - (inventorySettings.chargersMaintenance || 0);
  const availableEarphones = (inventorySettings.totalEarphones || 0) - allocatedEarphones - (inventorySettings.earphonesMaintenance || 0);

  // Admin: set total + under-maintenance counts for chargers / earphones.
  const updateStock = async (patch) => {
    if (currentUser?.role !== 'Admin') { addToast('Only Administrators can update stock.', 'error'); return false; }
    const clean = (v) => Math.max(0, parseInt(v, 10) || 0);
    const next = {
      totalChargers: clean(patch.totalChargers ?? inventorySettings.totalChargers),
      totalEarphones: clean(patch.totalEarphones ?? inventorySettings.totalEarphones),
      chargersMaintenance: clean(patch.chargersMaintenance ?? inventorySettings.chargersMaintenance),
      earphonesMaintenance: clean(patch.earphonesMaintenance ?? inventorySettings.earphonesMaintenance)
    };
    if (next.chargersMaintenance > next.totalChargers || next.earphonesMaintenance > next.totalEarphones) {
      addToast('Items under maintenance cannot exceed the total stock.', 'error');
      return false;
    }
    if (next.totalChargers - next.chargersMaintenance < allocatedChargers || next.totalEarphones - next.earphonesMaintenance < allocatedEarphones) {
      addToast(`Stock can't go below what is currently allocated (${allocatedChargers} chargers, ${allocatedEarphones} earphones).`, 'error');
      return false;
    }
    const previous = inventorySettings;
    setInventorySettings(next);
    const { error } = await supabase.from('inventory_settings').upsert(
      { id: currentUser.organizationId, organization_id: currentUser.organizationId, total_earphones: next.totalEarphones, total_chargers: next.totalChargers,
        chargers_maintenance: next.chargersMaintenance, earphones_maintenance: next.earphonesMaintenance, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' });
    if (error) {
      setInventorySettings(previous);
      addToast(`Failed to update stock: ${describeDbError(error)}`, 'error');
      return false;
    }
    logAction('Accessory Stock Updated', `Chargers ${next.totalChargers} (${next.chargersMaintenance} in maintenance), earphones ${next.totalEarphones} (${next.earphonesMaintenance} in maintenance) set by ${currentUser.name}`, 'info');
    addToast('Stock updated.');
    return true;
  };

  // --------------------------------------------------------------------------
  // DELIVERY ACTIONS  (separate from Allocations: tracks whether a handover
  // of walkie talkies + chargers + earphones to a department has actually
  // been delivered/signed for, and notifies the department head via
  // WhatsApp when it is)
  // --------------------------------------------------------------------------
  const createDelivery = async (departmentId, walkieCount, chargerCount, earphoneCount, remarks = '', deliveredBy = '') => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to create deliveries.', 'error');
      return false;
    }
    const wCount = parseInt(walkieCount, 10) || 0;
    const cCount = Math.max(0, parseInt(chargerCount ?? wCount, 10) || 0);
    const eCount = Math.max(0, parseInt(earphoneCount, 10) || 0);

    if (!departmentId || wCount <= 0) {
      addToast('Please select a department and enter a valid walkie talkie count.', 'error');
      return false;
    }
    if (eCount > availableEarphones) {
      addToast(`Only ${availableEarphones} earphones are currently available in stock.`, 'error');
      return false;
    }

    if (cCount > wCount) {
      addToast('Chargers cannot exceed the walkie count.', 'error');
      return false;
    }

    const newDeliveryRow = {
      id: `del-${Date.now()}`,
      department_id: departmentId,
      walkie_count: wCount,
      charger_count: cCount,
      earphone_count: eCount,
      status: 'Pending',
      delivered_by: deliveredBy || currentUser.name,
      remarks: remarks || '',
      organization_id: currentUser.organizationId,
      event_id: eventId
    };

    setDeliveries(prev => [mapDelivery(newDeliveryRow), ...prev]);

    const { error } = await supabase.from('deliveries').insert(newDeliveryRow);
    if (error) {
      addToast(`Failed to create delivery: ${error.message}`, 'error');
      setDeliveries(prev => prev.filter(d => d.id !== newDeliveryRow.id));
      return false;
    }

    const dept = departments.find(d => d.id === departmentId);
    logAction('Delivery Created', `Prepared delivery of ${wCount} walkies, ${cCount} chargers, ${eCount} earphones for ${dept ? dept.name : 'Unknown Department'} by ${currentUser.name}`, 'info');
    addToast('Delivery record created — mark it delivered once it is signed for.');
    return mapDelivery(newDeliveryRow);
  };

  // Marks a delivery as Delivered/signed-for. Returns the WhatsApp links for
  // the department's heads so the UI can let the user tap-to-send.
  const markDeliveryDelivered = async (deliveryId, signedByName) => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to confirm deliveries.', 'error');
      return false;
    }
    const delivery = deliveries.find(d => d.id === deliveryId);
    if (!delivery) return false;

    const trimmedSigner = (signedByName || '').trim();
    const deliveredAt = new Date().toISOString();

    setDeliveries(prev => prev.map(d => (d.id === deliveryId
      ? { ...d, status: 'Delivered', signedBy: trimmedSigner, deliveredAt }
      : d)));

    const { error } = await supabase.from('deliveries').update({
      status: 'Delivered',
      signed_by: trimmedSigner,
      delivered_at: deliveredAt
    }).eq('id', deliveryId);
    if (error) {
      addToast(`Failed to confirm delivery: ${error.message}`, 'error');
      return false;
    }

    const dept = departments.find(d => d.id === delivery.departmentId);
    const deptName = dept ? dept.name : 'Unknown Department';
    logAction('Delivery Confirmed', `${delivery.walkieCount} walkies, ${delivery.chargerCount} chargers, ${delivery.earphoneCount} earphones handed over to ${deptName}${trimmedSigner ? `, signed by ${trimmedSigner}` : ''}`, 'success');
    addToast(`Delivery to ${deptName} confirmed.`);

    const message = `Delivery confirmation: ${delivery.walkieCount} walkie talkie(s), ${delivery.chargerCount} charger(s), and ${delivery.earphoneCount} earphone(s) have been handed over to ${deptName}${trimmedSigner ? ` and signed for by ${trimmedSigner}` : ''}.`;
    return { delivery: { ...delivery, status: 'Delivered', signedBy: trimmedSigner, deliveredAt }, whatsappLinks: getWhatsAppLinksForDepartment(delivery.departmentId, message) };
  };

  // Marks a delivered set as returned, freeing up earphone stock, and
  // returns WhatsApp links so the UI can notify the department head.
  const markDeliveryReturned = async (deliveryId, returnRemarks = '') => {
    if (currentUser?.role === 'Client') {
      addToast('Clients are not authorized to process returns.', 'error');
      return false;
    }
    const delivery = deliveries.find(d => d.id === deliveryId);
    if (!delivery) return false;

    const returnedAt = new Date().toISOString();
    const combinedRemarks = returnRemarks ? `${delivery.remarks ? delivery.remarks + ' | ' : ''}Return: ${returnRemarks}` : delivery.remarks;

    setDeliveries(prev => prev.map(d => (d.id === deliveryId
      ? { ...d, status: 'Returned', returnedAt, remarks: combinedRemarks }
      : d)));

    const { error } = await supabase.from('deliveries').update({
      status: 'Returned',
      returned_at: returnedAt,
      remarks: combinedRemarks
    }).eq('id', deliveryId);
    if (error) {
      addToast(`Failed to process return: ${error.message}`, 'error');
      return false;
    }

    const dept = departments.find(d => d.id === delivery.departmentId);
    const deptName = dept ? dept.name : 'Unknown Department';
    logAction('Delivery Returned', `${delivery.walkieCount} walkies, ${delivery.chargerCount} chargers, ${delivery.earphoneCount} earphones returned by ${deptName} by ${currentUser.name}`, 'success');
    addToast(`Return from ${deptName} recorded.`);

    const message = `Return confirmation: ${delivery.walkieCount} walkie talkie(s), ${delivery.chargerCount} charger(s), and ${delivery.earphoneCount} earphone(s) have been received back from ${deptName}.`;
    return { whatsappLinks: getWhatsAppLinksForDepartment(delivery.departmentId, message) };
  };

  const deleteDelivery = async (deliveryId) => {
    if (currentUser?.role !== 'Admin') {
      addToast('Only Administrators can delete delivery records.', 'error');
      return false;
    }
    setDeliveries(prev => prev.filter(d => d.id !== deliveryId));
    const { error } = await supabase.from('deliveries').delete().eq('id', deliveryId);
    if (error) {
      addToast(`Failed to delete delivery: ${error.message}`, 'error');
      return false;
    }
    addToast('Delivery record deleted.');
    return true;
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      authChecked,
      dataLoading,
      login,
      logout,
      signUp,
      sendPasswordReset,
      updatePassword,
      resendVerificationEmail,
      authView,
      setAuthView,
      authNotice,
      setAuthNotice,
      authLoading,
      allProfiles,
      fetchAllUsers,
      updateUserRole,
      updateUserHierarchy,
      setUserActive,
      approveUser,
      denyUser,
      currentOrganization,
      regenerateJoinCode,
      updateOrganization,
      walkies,
      departments,
      allocations,
      maintenance,
      history,
      settings,
      setSettings,
      currentTab,
      setCurrentTab,
      globalSearch,
      setGlobalSearch,
      toasts,
      dismissToast,
      addToast,
      logAction,
      addWalkie,
      editWalkie,
      deleteWalkie,
      bulkAddWalkies,
      bulkDeleteWalkies,
      addDepartment,
      editDepartment,
      deleteDepartment,
      allocateWalkies,
      allocateByCount,
      returnWalkies,
      transferWalkie,
      assignPersonToWalkie,
      sendToMaintenance,
      completeMaintenance,
      departmentHeads,
      addDepartmentHead,
      editDepartmentHead,
      deleteDepartmentHead,
      getWhatsAppLinksForDepartment,
      deliveries,
      createDelivery,
      markDeliveryDelivered,
      markDeliveryReturned,
      deleteDelivery,
      inventorySettings,
      availableEarphones,
      availableChargers,
      allocatedChargers,
      allocatedEarphones,
      updateStock
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
