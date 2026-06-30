/** Parse a relative ("1h","30m","7d") or ISO time to epoch ms. */
export function parseSince(s: string | undefined, fallbackMs = 3600_000): number {
  if (!s) return Date.now() - fallbackMs;
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (m) {
    const n = Number(m[1]);
    const mult = { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2] as "s" | "m" | "h" | "d"];
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() - fallbackMs : t;
}
