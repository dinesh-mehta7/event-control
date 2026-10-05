export type MoveType = 'receive' | 'issue' | 'return' | 'return_damaged' | 'damage' | 'repair' | 'write_off' | 'adjust';

export interface Item {
  id: string; name: string; code: string; category: string; unit: string; location: string;
  minLevel: number; inStock: number; issued: number; damaged: number;
}
export interface Holding { itemId: string; location: string; qty: number }
// location = id of an inventory location (Gate 3, Main Stage ...). givenBy / receivedBy / returnedBy are the people involved.
export interface Movement { id: string; itemId: string; type: MoveType; qty: number; location: string; givenBy: string; receivedBy: string; returnedBy: string; ref: string; note: string; doneBy: string; doneAt: string }

export const CATEGORIES = ['Cables & Fiber', 'Network Hardware', 'Radios & Comms', 'CCTV & Optics', 'Power & UPS', 'Tools & Misc'];
export const UNITS = ['pcs', 'box', 'roll', 'drum', 'meter', 'set', 'pair', 'kg'];

export const MOVES: { key: MoveType; label: string; hint: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'mute'; needsLocation: boolean }[] = [
  { key: 'issue', label: 'Issue', hint: 'Send stock out to a location', tone: 'warn', needsLocation: true },
  { key: 'receive', label: 'Receive', hint: 'New stock arrived in store', tone: 'ok', needsLocation: false },
  { key: 'return', label: 'Return', hint: 'Good stock comes back from a location', tone: 'info', needsLocation: true },
  { key: 'return_damaged', label: 'Return · damaged', hint: 'Comes back from a location, but broken', tone: 'bad', needsLocation: true },
  { key: 'damage', label: 'Mark damaged', hint: 'Found damaged in store', tone: 'bad', needsLocation: false },
  { key: 'repair', label: 'Repaired', hint: 'Damaged units fixed, back in store', tone: 'ok', needsLocation: false },
  { key: 'write_off', label: 'Write off', hint: 'Remove damaged units for good', tone: 'mute', needsLocation: false },
  { key: 'adjust', label: 'Correct count', hint: 'Fix a counting mistake (+ or −)', tone: 'mute', needsLocation: false },
];
export const MOVE = Object.fromEntries(MOVES.map(m => [m.key, m])) as Record<MoveType, (typeof MOVES)[number]>;
