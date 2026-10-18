'use client';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';
import { roleLabel } from '../../../lib/roles';
import ToastContainer from './ToastContainer';
import { AUTH_CSS, FLASH_OUT_CSS } from './authStyles';

// Sign in · Create account · Forgot password · Set new password, in the DJJS saffron theme.
// After a successful sign-in the emblem rises, a lotus blooms and light floods into the app.

const LOGO = '/djjs-emblem.png';
const DEMO_ACCOUNTS = [
  { label: 'Super Admin', email: process.env.NEXT_PUBLIC_DEMO_SUPER_ADMIN_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_SUPER_ADMIN_PASSWORD, color: '#ffc23d' },
  { label: 'IT Admin', email: process.env.NEXT_PUBLIC_DEMO_IT_ADMIN_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_IT_ADMIN_PASSWORD, color: '#ff8a1f' },
  { label: 'Department Admin 1', email: process.env.NEXT_PUBLIC_DEMO_DEPT_ADMIN_1_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_DEPT_ADMIN_1_PASSWORD, color: '#7c74ff' },
  { label: 'Department Admin 2', email: process.env.NEXT_PUBLIC_DEMO_DEPT_ADMIN_2_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_DEPT_ADMIN_2_PASSWORD, color: '#33d17a' },
].filter(a => a.email && a.password) as { label: string; email: string; password: string; color: string }[];

type View = 'signin' | 'signup' | 'forgot' | 'reset';
const ORDER: Record<View, number> = { forgot: -1, signin: 0, signup: 1, reset: 2 };
const toView = (v: string): View => (v === 'signup' ? 'signup' : v === 'forgot' ? 'forgot' : v === 'reset' ? 'reset' : 'signin');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const RULES: Record<string, (v: string, all: Record<string, string>) => string> = {
  email: v => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Enter a valid email address'),
  password: v => (v.length >= 6 ? '' : 'Password must be at least 6 characters'),
  name: v => (v.trim().length >= 2 ? '' : 'Please enter your name'),
  newPassword: v => (v.length >= 8 ? '' : 'Use at least 8 characters'),
  confirm: (v, all) => (v && v === (all.newPassword || '') ? '' : 'Passwords do not match'),
  joinCode: v => (v.trim() ? '' : "Enter your organization's join code"),
};
const RULE_OF: Record<string, string> = {
  'si-email': 'email', 'si-pass': 'password', 'su-name': 'name', 'su-email': 'email', 'su-pass': 'newPassword', 'su-confirm': 'confirm',
  'su-code': 'joinCode', 'fp-email': 'email', 'rp-pass': 'newPassword', 'rp-confirm': 'confirm',
};
const STRENGTH: [string, string][] = [['—', '#555'], ['Weak', '#ff5d6c'], ['Fair', '#ff9a2a'], ['Good', '#ffc23d'], ['Strong', '#33d17a']];
const strengthOf = (v: string) => {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v) && v.length >= 10) s++;
  return Math.max(1, s);
};

/* ---------- icons ---------- */
const I = {
  mail: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>,
  lock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.4" fill="currentColor" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  key: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M15 8l2 2" /></svg>,
  arrow: <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>,
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>,
  info: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" /></svg>,
};
// Shown until /public/djjs-emblem.png exists: a simple lamp flame.
const FallbackEmblem = () => (
  <svg viewBox="0 0 120 120" aria-hidden><defs><linearGradient id="ea-fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff3c4" /><stop offset=".45" stopColor="#ffc23d" /><stop offset="1" stopColor="#ff6a1f" /></linearGradient></defs>
    <path d="M60 10c10 18 26 30 26 52a26 26 0 0 1-52 0c0-14 8-22 14-30 2 8 6 12 10 14-2-14 0-26 2-36z" fill="url(#ea-fl)" />
    <path d="M24 92h72l-8 14H32z" fill="#ff9a2a" opacity=".85" /></svg>
);

/* ---------- field ---------- */
type FieldProps = { id: string; label: string; icon: React.ReactNode; type?: string; value: string; onChange: (v: string) => void; onBlur: () => void;
  error?: string; good?: boolean; shake?: boolean; onShaken?: () => void; autoComplete?: string; eye?: boolean; upper?: boolean; i: number; bare?: boolean };
const Field: React.FC<FieldProps> = ({ id, label, icon, type = 'text', value, onChange, onBlur, error, good, shake, onShaken, autoComplete, eye, upper, i, bare }) => {
  const [show, setShow] = useState(false);
  const [blink, setBlink] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={['ea-field', bare ? '' : 'ea-f', error ? 'bad' : '', good && !error ? 'good' : '', shake ? 'ea-shake' : ''].join(' ')} style={{ '--i': i } as any} onAnimationEnd={e => { if (e.animationName === 'ea-shake') onShaken?.(); }}>
      <div className="ea-box">
        <span className="ea-ico">{icon}</span>
        <input ref={ref} id={id} type={eye ? (show ? 'text' : 'password') : type} placeholder=" " autoComplete={autoComplete} value={value} className={upper ? 'upper' : undefined}
          aria-invalid={!!error} aria-describedby={`${id}-msg`} onChange={e => onChange(upper ? e.target.value.toUpperCase() : e.target.value)} onBlur={onBlur} />
        <label htmlFor={id}>{label}</label>
        {eye && <span className="ea-trail"><button type="button" className={'ea-eye' + (blink ? ' blink' : '')} key={blink} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => { setShow(s => !s); setBlink(b => b + 1); ref.current?.focus({ preventScroll: true }); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><g className="lid"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></g><path className="slash" d="M4 4l16 16" /></svg>
        </button></span>}
      </div>
      <div className="ea-msg" id={`${id}-msg`} role={error ? 'alert' : undefined}>{error}</div>
    </div>
  );
};

/* ---------- primary button with ripple ---------- */
const Primary: React.FC<{ label: string; loading: boolean; i: number; style?: React.CSSProperties }> = ({ label, loading, i, style }) => {
  const ripple = (e: React.PointerEvent<HTMLButtonElement>) => {
    const b = e.currentTarget, r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement('span');
    s.className = 'ea-ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(s); setTimeout(() => s.remove(), 700);
  };
  return (
    <button className={'ea-btn ea-f' + (loading ? ' loading' : '')} type="submit" style={{ '--i': i, ...style } as any} onPointerDown={ripple} aria-busy={loading}>
      <span className="lbl">{label}</span>{I.arrow}<span className="spin" />
    </button>
  );
};

// Royal (dark + saffron) keeps the saffron page; every other theme gets the indigo version.
const isRoyal = (settings: any) => settings?.theme === 'dark' && settings?.palette === 'saffron';

export const AuthFlashOut: React.FC = () => {
  const royal = isRoyal((useApp() as any).settings);
  return <><style>{FLASH_OUT_CSS}</style><div className={'ea-flashout' + (royal ? '' : ' indigo')} aria-hidden /></>;
};

export default function AuthScreen({ onCeremony, onFinished }: { onCeremony: (on: boolean) => void; onFinished: () => void }) {
  const w: any = useApp();
  const { login, signUp, sendPasswordReset, updatePassword, authView, setAuthView, authNotice, setAuthNotice, resendVerificationEmail } = w;
  const latest = useRef(w); latest.current = w;
  const royal = isRoyal(w.settings);
  const hueBase = royal ? 18 : 228; // ember colour: saffron for Royal, indigo otherwise
  const hueRef = useRef(hueBase); hueRef.current = hueBase;

  /* ---------- form state ---------- */
  const [v, setV] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [good, setGood] = useState<Record<string, boolean>>({});
  const [shake, setShake] = useState<Record<string, boolean>>({});
  const [formErr, setFormErr] = useState<Partial<Record<View, string>>>({});
  const [busy, setBusy] = useState<View | null>(null);
  const [typing, setTyping] = useState('');
  const typingRun = useRef(0);

  const valueOf = (id: string) => v[id] || '';
  const ruleCheck = (id: string, all = v) => RULES[RULE_OF[id]](all[id] || '', { newPassword: all[id.startsWith('rp') ? 'rp-pass' : 'su-pass'] || '' });
  const check = (id: string, all = v) => {
    const msg = ruleCheck(id, all);
    setErrors(e => ({ ...e, [id]: msg }));
    setGood(g => ({ ...g, [id]: !msg }));
    return !msg;
  };
  const set = (id: string) => (val: string) => {
    setV(prev => {
      const next = { ...prev, [id]: val };
      if (errors[id]) { const msg = ruleCheck(id, next); setErrors(e => ({ ...e, [id]: msg })); setGood(g => ({ ...g, [id]: !msg })); }
      return next;
    });
    setFormErr({});
    if (authNotice) setAuthNotice(null);
  };
  const blur = (id: string) => () => { if (valueOf(id)) check(id); };
  const shakeField = (id: string) => { setShake(s => ({ ...s, [id]: false })); requestAnimationFrame(() => setShake(s => ({ ...s, [id]: true }))); };
  const fieldProps = (id: string, i: number) => ({ id, i, value: valueOf(id), onChange: set(id), onBlur: blur(id), error: errors[id], good: good[id], shake: shake[id], onShaken: () => setShake(s => ({ ...s, [id]: false })) });
  const validate = (ids: string[]) => {
    const bad = ids.filter(id => !check(id));
    if (bad.length) { shakeField(bad[0]); document.getElementById(bad[0])?.focus(); }
    return !bad.length;
  };

  /* ---------- view switching ---------- */
  const target = toView(authView);
  const [cur, setCur] = useState<View | null>(target);
  const [leaving, setLeaving] = useState<View | null>(null);
  const [dx, setDx] = useState(1);
  const [boot, setBoot] = useState(true);
  const curRef = useRef<View | null>(target);
  useEffect(() => { const t = setTimeout(() => setBoot(false), 2600); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const from = curRef.current;
    if (!from || from === target) return;
    const reduce = prefersReduced();
    setBoot(false);
    setDx(ORDER[target] >= ORDER[from] ? 1 : -1);
    setLeaving(from); setCur(null); curRef.current = null;
    const t = setTimeout(() => {
      setLeaving(null); setCur(target); curRef.current = target;
      setErrors({}); setGood({});
      if (window.matchMedia('(pointer:fine)').matches) setTimeout(() => (document.querySelector(`.ea-view[data-view="${target}"] input`) as HTMLInputElement | null)?.focus({ preventScroll: true }), 350);
    }, reduce ? 0 : 400);
    return () => clearTimeout(t);
  }, [target]);
  const go = (to: string) => { setFormErr({}); setAuthNotice(null); setAuthView(to); };

  /* ---------- stage height follows the active view ---------- */
  const stage = useRef<HTMLDivElement>(null);
  const views = useRef<Partial<Record<View, HTMLElement | null>>>({});
  useLayoutEffect(() => {
    const el = views.current[(cur || leaving || target) as View];
    if (!el || !stage.current) return;
    const fit = () => { if (stage.current) stage.current.style.height = el.offsetHeight + 'px'; };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [cur, leaving, target]);

  /* ---------- toast ---------- */
  const [toast, setToast] = useState('');
  const toastT = useRef<any>();
  const showToast = (m: string) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 3200); };

  /* ---------- logo ---------- */
  const [logoOk, setLogoOk] = useState(true);
  const title = 'Event Command';

  /* ---------- fonts ---------- */
  useEffect(() => {
    if (document.getElementById('ea-fonts')) return;
    const l = document.createElement('link');
    l.id = 'ea-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap';
    document.head.appendChild(l);
  }, []);

  /* ---------- embers + parallax ---------- */
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const emblem = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const ember = useRef({ mode: 'drift', cx: 0, cy: 0, last: 'drift' });
  const ascending = useRef(false);
  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext('2d')!;
    const reduce = prefersReduced();
    const mouse = { x: -999, y: -999 };
    let W = 0, H = 0, DPR = 1, raf = 0, parts: any[] = [], boost = 1, alive = true;
    const spawn = (anywhere: boolean) => ({
      x: Math.random() * W, y: anywhere ? Math.random() * H : H + Math.random() * 40 * DPR, vx: 0, vy: 0,
      r: (Math.random() * 1.8 + .5) * DPR, up: (Math.random() * .45 + .15) * DPR, sway: Math.random() * Math.PI * 2, sw: Math.random() * .015 + .004,
      hue: hueRef.current + Math.random() * 30, life: Math.random() * .6 + .4, tw: Math.random() * .05 + .01, t: Math.random() * 100,
    });
    const size = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR;
      const n = Math.round(Math.min(130, (innerWidth * innerHeight) / 12000));
      parts = Array.from({ length: n }, () => spawn(true));
    };
    const edgeSpawn = (p: any) => {
      const e = ember.current, a = Math.random() * Math.PI * 2, R = Math.hypot(W, H) * .55;
      p.x = e.cx * DPR + Math.cos(a) * R; p.y = e.cy * DPR + Math.sin(a) * R; p.vx = p.vy = 0;
    };
    size();
    const start = performance.now();
    const frame = (now: number) => {
      if (!alive) return;
      const e = ember.current, intro = Math.min(1, (now - start) / 2500);
      if (e.mode !== e.last) {
        if (e.mode === 'burst') for (const p of parts) {
          const a = Math.atan2(p.y - e.cy * DPR, p.x - e.cx * DPR) + (Math.random() - .5) * .4, sp = (Math.random() * 10 + 5) * DPR;
          p.x = e.cx * DPR + Math.cos(a) * 40 * DPR; p.y = e.cy * DPR + Math.sin(a) * 40 * DPR; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
        }
        e.last = e.mode;
      }
      boost += ((e.mode === 'drift' ? 1 : e.mode === 'burst' ? 2.6 : 1.8) - boost) * .05;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const cx = e.cx * DPR, cy = e.cy * DPR;
      for (const p of parts) {
        p.t += p.tw; p.sway += p.sw;
        let fade = 1;
        if (e.mode === 'converge') {
          const ddx = cx - p.x, ddy = cy - p.y, d = Math.hypot(ddx, ddy) || 1;
          p.vx = (p.vx + ddx / d * .55 * DPR - ddy / d * .45 * DPR) * .95;
          p.vy = (p.vy + ddy / d * .55 * DPR + ddx / d * .45 * DPR) * .95;
          p.x += p.vx; p.y += p.vy;
          fade = Math.min(1, d / (90 * DPR));
          if (d < 40 * DPR) edgeSpawn(p);
        } else {
          p.vx *= .955; p.vy *= .955;
          p.x += p.vx + Math.sin(p.sway) * .35 * DPR; p.y += p.vy - p.up;
          const mx = p.x - mouse.x * DPR, my = p.y - mouse.y * DPR, d2 = mx * mx + my * my, R = 120 * DPR;
          if (d2 < R * R) { const f = (1 - Math.sqrt(d2) / R) * 1.6; p.x += mx / R * f * DPR * 2; p.y += my / R * f * DPR * 2; }
          if (p.y < -30 * DPR || p.x < -60 * DPR || p.x > W + 60 * DPR || p.y > H + 80 * DPR) Object.assign(p, spawn(false));
          if (e.mode === 'drift') fade = Math.min(1, Math.max(0, p.y / (H * .35)));
        }
        const a = Math.min(1, (0.35 + Math.sin(p.t) * 0.25) * p.life * fade * intro * boost);
        if (a <= 0.01) continue;
        const rr = p.r * 4 * (e.mode === 'burst' ? 1.3 : 1);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        g.addColorStop(0, `hsla(${p.hue},100%,72%,${a})`); g.addColorStop(.35, `hsla(${p.hue},100%,55%,${a * .45})`); g.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
        if (e.mode !== 'drift' && Math.hypot(p.vx, p.vy) > 2 * DPR) {
          ctx.strokeStyle = `hsla(${p.hue},100%,65%,${a * .5})`; ctx.lineWidth = p.r * .9;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke();
        }
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    let praf = 0;
    const onMove = (ev: PointerEvent) => {
      cancelAnimationFrame(praf);
      praf = requestAnimationFrame(() => {
        mouse.x = ev.clientX; mouse.y = ev.clientY;
        if (reduce || ascending.current || !window.matchMedia('(pointer:fine)').matches) return;
        const x = ev.clientX / innerWidth - .5, y = ev.clientY / innerHeight - .5;
        if (emblem.current) emblem.current.style.transform = `perspective(800px) rotateY(${x * 14}deg) rotateX(${-y * 10}deg) translate3d(${x * 10}px,${y * 8}px,0)`;
        const c = card.current;
        if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', ev.clientX - r.left + 'px'); c.style.setProperty('--my', ev.clientY - r.top + 'px'); }
      });
    };
    window.addEventListener('resize', size);
    window.addEventListener('pointermove', onMove);
    return () => { alive = false; cancelAnimationFrame(raf); cancelAnimationFrame(praf); window.removeEventListener('resize', size); window.removeEventListener('pointermove', onMove); };
  }, []);

  /* ---------- ascend ceremony ---------- */
  const [asc, setAsc] = useState(false);
  const [quake, setQuake] = useState(false);
  const [flash, setFlash] = useState(false);
  const [welcome, setWelcome] = useState({ text: 'Welcome back', status: [] as string[] });
  const [step, setStep] = useState(-1);
  const fx = useRef<HTMLDivElement>(null);
  const flashEl = useRef<HTMLDivElement>(null);
  const skip = useRef(false);
  const wait = async (ms: number) => { const end = performance.now() + ms; while (!skip.current && performance.now() < end) await sleep(Math.min(50, end - performance.now())); };

  const ascend = useCallback(async (kind: 'signin' | 'signup') => {
    await sleep(40); // let the signed-in profile reach this component
    const u = latest.current.currentUser || {};
    const dept = (latest.current.departments || []).find((d: any) => d.id === u.departmentId)?.name;
    const role = roleLabel(u.level, u.subDepartment, dept);
    const first = String(u.name || '').trim().split(/\s+/)[0];
    setWelcome({
      text: (kind === 'signup' ? 'Welcome' : 'Welcome back') + (first ? ', ' + first : ''),
      status: kind === 'signup'
        ? ['Creating your profile', 'Preparing your workspace', u.approved ? `Signed in as ${role}` : 'Waiting for approval']
        : ['Verifying credentials', 'Loading events, teams & stock', u.approved ? `Signed in as ${role}` : 'Waiting for approval'],
    });
    if (prefersReduced()) { onFinished(); return; }

    // Where the emblem lands and how big the lotus is.
    ascending.current = true; skip.current = false;
    const em = emblem.current!;
    em.style.transform = '';
    const r = em.getBoundingClientRect();
    const D = Math.max(260, Math.min(innerHeight * .95 - 120, innerWidth * 1.25, 600));
    const top = Math.max(0, (innerHeight - (D + 120)) / 2);
    const cx = innerWidth / 2, cy = top + D / 2, s = (D / 2.05) / r.width;
    const f = fx.current!, fl = flashEl.current!;
    f.style.setProperty('--cx', cx + 'px'); f.style.setProperty('--cy', cy + 'px'); f.style.setProperty('--D', D + 'px'); f.style.setProperty('--ty', top + D + 2 + 'px');
    fl.style.setProperty('--cx', cx + 'px'); fl.style.setProperty('--cy', cy + r.height * s * .1 + 'px');
    document.documentElement.style.setProperty('--cx', cx + 'px'); document.documentElement.style.setProperty('--cy', cy + 'px');

    setAsc(true);
    Object.assign(ember.current, { cx, cy, mode: 'converge' });
    await wait(250);
    em.style.transform = `translate(${cx - (r.left + r.width / 2)}px, ${cy - (r.top + r.height / 2)}px) scale(${s})`;
    await wait(1150);
    ember.current.mode = 'burst';
    setQuake(true);
    await wait(700);
    for (let i = 0; i < 3; i++) {
      setStep(i);
      if (i === 1) ember.current.mode = 'drift';
      await wait(i === 2 ? 800 : 620);
    }
    setFlash(true);
    await sleep(1050);
    onFinished();
  }, [onFinished]);

  /* ---------- submit handlers ---------- */
  const failed = (view: View, msg: string, field?: string) => {
    setFormErr({ [view]: msg });
    if (field) { setErrors(e => ({ ...e, [field]: e[field] || '' })); setGood(g => ({ ...g, [field]: false })); shakeField(field); }
  };
  const readNotice = async () => { await sleep(40); return latest.current.authNotice as string | null; };

  const submitSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate(['si-email', 'si-pass'])) return;
    setBusy('signin'); onCeremony(true);
    const ok = await login(valueOf('si-email'), valueOf('si-pass'));
    if (!ok) {
      onCeremony(false); setBusy(null);
      if (!(await readNotice())) failed('signin', 'Incorrect email or password. Please try again.', 'si-pass');
      return;
    }
    await ascend('signin');
  };

  const submitSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    // Everyone joins the existing organization with a join code; new organizations cannot be created here.
    if (busy || !validate(['su-code', 'su-name', 'su-email', 'su-pass', 'su-confirm'])) return;
    setBusy('signup');
    try {
      const { data, error } = await supabase.rpc('check_department_code', { p_code: valueOf('su-code').trim() });
      if (!error && data && data.valid === false) { setBusy(null); failed('signup', 'That code is not valid. Ask your department head for the current code.', 'su-code'); return; }
    } catch { /* let sign-up decide */ }
    onCeremony(true);
    const ok = await signUp(valueOf('su-name'), valueOf('su-email'), valueOf('su-pass'), 'join', valueOf('su-code'));
    const { data } = await supabase.auth.getSession();
    if (!ok || !data.session) {
      onCeremony(false); setBusy(null);
      if (ok) showToast('Account created');
      else failed('signup', 'Could not create the account. Check the details and try again.');
      return;
    }
    await ascend('signup');
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate(['fp-email'])) return;
    setBusy('forgot');
    const ok = await sendPasswordReset(valueOf('fp-email'));
    setBusy(null);
    if (ok) showToast('Reset link sent');
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate(['rp-pass', 'rp-confirm'])) return;
    setBusy('reset');
    const ok = await updatePassword(valueOf('rp-pass'));
    setBusy(null);
    if (ok) showToast('Password updated — sign in with it now');
  };

  /* ---------- demo chips type the credentials ---------- */
  const typeDemo = async (a: typeof DEMO_ACCOUNTS[number]) => {
    const run = ++typingRun.current;
    setTyping(a.label); setErrors({}); setGood({}); setFormErr({}); setAuthNotice(null);
    setV(p => ({ ...p, 'si-email': '', 'si-pass': '' }));
    const reduce = prefersReduced();
    for (const [id, val] of [['si-email', a.email], ['si-pass', a.password]] as const) {
      document.getElementById(id)?.focus({ preventScroll: true });
      for (let k = 1; k <= val.length; k++) {
        if (run !== typingRun.current) return;
        setV(p => ({ ...p, [id]: val.slice(0, k) }));
        await sleep(reduce ? 0 : 22 + Math.random() * 26);
      }
      setGood(g => ({ ...g, [id]: true }));
      await sleep(110);
    }
    setTyping('');
    (document.querySelector('.ea-view[data-view="signin"] .ea-btn') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  };

  /* ---------- render helpers ---------- */
  const viewCls = (name: View) => 'ea-view' + (cur === name ? ' active' : '') + (leaving === name ? ' leaving' : '');
  const setViewRef = (name: View) => (el: HTMLElement | null) => { views.current[name] = el; };
  const strength = strengthOf(valueOf('su-pass'));
  const isUnverified = !!authNotice && /verify your email/i.test(authNotice);
  const Notice = ({ i }: { i: number }) => (
    <div className={'ea-notice' + (authNotice ? ' show' : '')} role="status" style={{ '--i': i } as any}>
      {I.info}<span>{authNotice}{isUnverified && <button type="button" onClick={() => resendVerificationEmail(valueOf('si-email'))}>Resend verification email</button>}</span>
    </div>
  );
  const FormErr = ({ view }: { view: View }) => (
    <div className={'ea-formerr' + (formErr[view] ? ' show' : '')} role="alert">{I.alert}<span>{formErr[view]}</span></div>
  );
  const petals = useMemo(() => Array.from({ length: 16 }, (_, i) => i), []);
  const beads = useMemo(() => Array.from({ length: 32 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return { i, x: 200 + Math.cos(a) * 189, y: 200 + Math.sin(a) * 189, r: i % 2 ? 1.6 : 2.6 }; }), []);

  return (
    <div ref={root} className={'ea' + (royal ? '' : ' indigo') + (asc ? ' ascend' : '')} onClick={() => { if (asc) skip.current = true; }}>
      <style>{AUTH_CSS}</style>
      <div className="ea-bg" aria-hidden><div className="ea-grid" /><canvas ref={canvas} className="ea-embers" /><div className="ea-vignette" /></div>

      <div className="ea-fx" ref={fx} aria-hidden>
        <div className="ea-core">
          <div className="ea-rays" /><div className="ea-rays r2" />
          <div className="ea-wave" /><div className="ea-wave" /><div className="ea-wave" />
          <svg className="ea-mandala" viewBox="0 0 400 400">
            <defs><radialGradient id="ea-petalFill" cx="50%" cy="100%" r="100%"><stop offset="0" stopColor={royal ? '#ffb347' : '#a3aafb'} stopOpacity=".55" /><stop offset=".7" stopColor={royal ? '#ff7a1a' : '#6366f1'} stopOpacity=".12" /><stop offset="1" stopColor={royal ? '#ff7a1a' : '#6366f1'} stopOpacity="0" /></radialGradient></defs>
            <g className="spinB">{petals.map(i => <g key={i} transform={`rotate(${i * 22.5 + 11.25} 200 200)`}><path className="petal" style={{ '--i': i + 4 } as any} d="M200 76 C191 68 192 52 200 40 C208 52 209 68 200 76Z" /></g>)}</g>
            <g className="spinA">
              {petals.map(i => <g key={i} transform={`rotate(${i * 22.5} 200 200)`}><path className="petal" style={{ '--i': i } as any} d="M200 74 C186 62 187 40 200 20 C213 40 214 62 200 74Z" /></g>)}
              <circle className="draw" cx="200" cy="200" r="182" stroke={royal ? 'rgba(255,200,110,.55)' : 'rgba(163,170,251,.55)'} strokeWidth="1.2" style={{ '--len': 1144, '--d': '1.1s' } as any} />
              <circle className="ring2" cx="200" cy="200" r="196" fill="none" stroke={royal ? 'rgba(255,150,50,.4)' : 'rgba(110,118,245,.4)'} strokeWidth="1.2" strokeDasharray="3 9" />
              {beads.map(b => <circle key={b.i} className="bead" cx={b.x} cy={b.y} r={b.r} style={{ '--i': b.i } as any} />)}
            </g>
            <circle className="draw spinB" cx="200" cy="200" r="122" stroke={royal ? 'rgba(255,220,150,.4)' : 'rgba(199,205,254,.4)'} strokeWidth="1" style={{ '--len': 767, '--d': '1.2s' } as any} />
          </svg>
        </div>
        <div className="ea-welcome">
          <h2 aria-label={welcome.text}>{[...welcome.text].map((ch, i) => <span key={i} className={ch === ' ' ? 'sp' : undefined} style={{ '--i': i } as any}>{ch === ' ' ? ' ' : ch}</span>)}</h2>
          <div className="ea-status" role="status">{welcome.status.map((s, i) => <span key={i} className={(i === step ? 'on' : i < step ? 'off' : '') + (i === welcome.status.length - 1 ? ' ok' : '')}>{s}</span>)}</div>
          <div className="ea-track"><i /></div>
        </div>
      </div>
      <div className={'ea-flash' + (flash ? ' go' : '')} ref={flashEl} aria-hidden />
      <button type="button" className="ea-skip" onClick={() => { skip.current = true; }}>Skip</button>

      <main className={'ea-main' + (quake ? ' quake' : '')} onAnimationEnd={e => { if (e.animationName === 'ea-quake') setQuake(false); }}>
        <div className="ea-emblem" ref={emblem} aria-hidden style={{ '--logo': logoOk ? `url("${LOGO}")` : 'none' } as any}>
          <div className="ea-halo" /><div className="ea-halo b" /><div className="ea-glow" />
          <div className="ea-logo">{logoOk ? <img src={LOGO} alt="" onError={() => setLogoOk(false)} draggable={false} /> : <FallbackEmblem />}</div>
          <div className="ea-flame" />
          {logoOk && <div className="ea-shine" />}
        </div>

        <div className="ea-brand">
          <h1 aria-label={title}>{[...title].map((ch, i) => <span key={i} aria-hidden className={ch === ' ' ? 'sp' : undefined} style={{ '--i': i } as any}>{ch === ' ' ? ' ' : ch}</span>)}</h1>
          <p>Event Operations · <b>Divya Jyoti Jagrati Sansthan</b></p>
        </div>

        <section ref={card} className={'ea-card' + (boot ? ' boot' : '')} aria-live="polite">
          <div className={'ea-tabs' + (target === 'forgot' || target === 'reset' ? ' hide' : '')} role="tablist" data-at={target === 'signup' ? 'signup' : 'signin'}>
            <div className="ea-pill" />
            <button type="button" role="tab" aria-selected={target === 'signin'} onClick={() => go('login')}>Sign In</button>
            <button type="button" role="tab" aria-selected={target === 'signup'} onClick={() => go('signup')}>Create Account</button>
          </div>

          <div className="ea-stage" ref={stage} style={{ '--dx': dx } as any}>
            {/* SIGN IN */}
            <form className={viewCls('signin')} data-view="signin" ref={setViewRef('signin')} onSubmit={submitSignIn} noValidate>
              <div className="ea-head ea-f" style={{ '--i': 0 } as any}><h2>Welcome back</h2><p>Sign in to manage events, teams, stock and radios.</p></div>
              <Notice i={1} />
              <Field {...fieldProps('si-email', 1)} label="Business email" icon={I.mail} type="email" autoComplete="email" />
              <Field {...fieldProps('si-pass', 2)} label="Password" icon={I.lock} eye autoComplete="current-password" />
              <div className="ea-util ea-f" style={{ '--i': 3, justifyContent: 'flex-end' } as any}>
                <button type="button" className="ea-link" onClick={() => go('forgot')}>Forgot password?</button>
              </div>
              <FormErr view="signin" />
              <Primary label="Sign In" loading={busy === 'signin'} i={4} />
              <div className="ea-foot ea-f" style={{ '--i': 5 } as any}>New here? <button type="button" className="ea-link" onClick={() => go('signup')}>Create an account</button>
                <small>New accounts join with read-only access — an administrator upgrades it from User Management.</small>
                {DEMO_ACCOUNTS.length > 0 && <div className="ea-demo">
                  <span className="ea-demo-k">Demo accounts</span>
                  <div className="ea-chips">{DEMO_ACCOUNTS.map(a => <button key={a.label} type="button" className={'ea-chip' + (typing === a.label ? ' typing' : '')} style={{ '--c': a.color } as any} onClick={() => typeDemo(a)}><i />{a.label}</button>)}</div>
                </div>}
              </div>
            </form>

            {/* CREATE ACCOUNT */}
            <form className={viewCls('signup')} data-view="signup" ref={setViewRef('signup')} onSubmit={submitSignUp} noValidate>
              <div className="ea-head ea-f" style={{ '--i': 0 } as any}><h2>Create your account</h2><p>Join your organization's operations team in under a minute.</p></div>
              <Field {...fieldProps('su-code', 2)} label="Join code" icon={I.key} upper autoComplete="off" />
              <p className="ea-hint ea-f" style={{ '--i': 3 } as any}>Ask your department head for the code. They approve you before you can sign in.</p>
              <div className="ea-row2 ea-f" style={{ '--i': 4 } as any}>
                <Field {...fieldProps('su-name', 0)} bare label="Full name" icon={I.user} autoComplete="name" />
                <Field {...fieldProps('su-email', 0)} bare label="Business email" icon={I.mail} type="email" autoComplete="email" />
              </div>
              <Field {...fieldProps('su-pass', 5)} label="Create password" icon={I.lock} eye autoComplete="new-password" />
              <div className="ea-strength ea-f" style={{ '--i': 6 } as any} aria-label={`Password strength: ${STRENGTH[strength][0]}`}>
                {[0, 1, 2, 3].map(k => <i key={k} className={k < strength ? 'on' : ''} style={{ '--c': STRENGTH[strength][1] } as any} />)}
                <span style={{ color: STRENGTH[strength][1] }}>{STRENGTH[strength][0]}</span>
              </div>
              <Field {...fieldProps('su-confirm', 7)} label="Confirm password" icon={I.lock} eye autoComplete="new-password" />
              <FormErr view="signup" />
              <Primary label="Create Account" loading={busy === 'signup'} i={8} />
              <div className="ea-foot ea-f" style={{ '--i': 9 } as any}>Already registered? <button type="button" className="ea-link" onClick={() => go('login')}>Sign in instead</button></div>
            </form>

            {/* FORGOT PASSWORD */}
            <form className={viewCls('forgot')} data-view="forgot" ref={setViewRef('forgot')} onSubmit={submitForgot} noValidate>
              <button type="button" className="ea-back ea-f" style={{ '--i': 0 } as any} onClick={() => go('login')}>{I.back}Back to sign in</button>
              <div className="ea-head ea-f" style={{ '--i': 1 } as any}><h2>Reset your password</h2><p>Enter the email on your account and we'll send you a secure reset link.</p></div>
              <Field {...fieldProps('fp-email', 2)} label="Business email" icon={I.mail} type="email" autoComplete="email" />
              <Primary label="Send Reset Link" loading={busy === 'forgot'} i={3} style={{ marginTop: 6 }} />
            </form>

            {/* SET NEW PASSWORD (from the emailed link) */}
            <form className={viewCls('reset')} data-view="reset" ref={setViewRef('reset')} onSubmit={submitReset} noValidate>
              <div className="ea-head ea-f" style={{ '--i': 0 } as any}><h2>Set a new password</h2><p>You're verified through your email link — choose a new password.</p></div>
              <Field {...fieldProps('rp-pass', 1)} label="New password" icon={I.lock} eye autoComplete="new-password" />
              <Field {...fieldProps('rp-confirm', 2)} label="Confirm password" icon={I.lock} eye autoComplete="new-password" />
              <Primary label="Update Password" loading={busy === 'reset'} i={3} style={{ marginTop: 6 }} />
            </form>
          </div>
        </section>

        <div className="ea-copy">© DJJS · IT Department</div>
      </main>

      <div className={'ea-toast' + (toast ? ' show' : '')} role="status"><span className="dot" /><span>{toast}</span></div>
      <ToastContainer />
    </div>
  );
}
