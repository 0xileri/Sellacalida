// Wall-clock labels for evidence. The project works in WAT (West Africa Time, UTC+1, no DST).

export function formatWAT(d: Date = new Date()): string {
  const wat = new Date(d.getTime() + 60 * 60 * 1000);
  const iso = wat.toISOString(); // e.g. 2026-11-17T13:04:05.000Z, shifted by +1h
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} WAT`;
}
