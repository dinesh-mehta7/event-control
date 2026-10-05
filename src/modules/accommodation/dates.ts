// All dates are handled in the viewer's LOCAL time as plain 'YYYY-MM-DD'
// strings. (Using toISOString() would give the previous day for the first
// 5.5 hours after midnight in India.)
const pad = (n: number) => String(n).padStart(2, '0');

export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toDateStr(new Date());

export const shiftDate = (s: string, days: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
};

export const prettyDate = (s: string, withYear = false) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  });
};

// '07:00' -> '7:00 AM'
export const fmtTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ap}`;
};

export const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

export const timeAgo = (iso: string | null) => {
  if (!iso) return '';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
