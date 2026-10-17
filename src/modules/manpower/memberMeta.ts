// One way to identify a member everywhere: "Badge 1234 · Branch name".
// Badge no. is the member's Batch no. field.
export const badgeNo = (m: { batchNo?: string | null }) => (m.batchNo || '').trim();
export const memberMeta = (m: { batchNo?: string | null; branch?: string | null }) =>
  [badgeNo(m) && `Badge ${badgeNo(m)}`, (m.branch || '').trim()].filter(Boolean).join(' · ');
