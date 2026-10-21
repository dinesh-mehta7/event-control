'use client';

export const RULES: Record<string, (v: string, all: Record<string, string>) => string> = {
  email: v => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Enter a valid email address'),
  password: v => (v.length >= 6 ? '' : 'Password must be at least 6 characters'),
  name: v => (v.trim().length >= 2 ? '' : 'Please enter your name'),
  newPassword: v => (v.length >= 8 ? '' : 'Use at least 8 characters'),
  confirm: (v, all) => (v && v === (all.newPassword || '') ? '' : 'Passwords do not match'),
  joinCode: v => (v.trim() ? '' : "Enter your organization's join code"),
};

export const RULE_OF: Record<string, string> = {
  'si-email': 'email',
  'si-pass': 'password',
  'su-name': 'name',
  'su-email': 'email',
  'su-pass': 'newPassword',
  'su-confirm': 'confirm',
  'su-code': 'joinCode',
  'fp-email': 'email',
  'rp-pass': 'newPassword',
  'rp-confirm': 'confirm',
};

export const STRENGTH: [string, string][] = [
  ['—', '#555'],
  ['Weak', '#ff5d6c'],
  ['Fair', '#ff9a2a'],
  ['Good', '#ffc23d'],
  ['Strong', '#33d17a'],
];

export const strengthOf = (v: string) => {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v) && v.length >= 10) s++;
  return Math.max(1, s);
};
