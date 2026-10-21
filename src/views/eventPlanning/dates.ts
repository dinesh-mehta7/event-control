import { Attendance } from './types';

export const localDay = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const shiftDay = (day: string, offset: number) => {
  const [year, month, date] = day.split('-').map(Number);
  const d = new Date(year, month - 1, date + offset, 12);
  return localDay(d);
};

const shortDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export const attendanceDayCount = (row: Attendance, today: string) => {
  if (!row.checked_in_at) return 0;
  const start = localDay(row.checked_in_at);
  const end = localDay(row.checked_out_at || today);
  const toUtc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(0, Math.floor((toUtc(end) - toUtc(start)) / 86400000) + 1);
};
