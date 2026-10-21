export const dishes = (items: string) =>
  items
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
