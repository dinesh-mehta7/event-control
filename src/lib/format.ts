// Small formatting helpers shared across modules (dates, CSV).

export const pad = (n: number) => String(n).padStart(2, '0');

export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const when = (s: string) =>
  new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
