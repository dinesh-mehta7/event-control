// Client-side id generation and natural-order sorting, shared by the data providers.

export const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
