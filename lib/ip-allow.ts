// Client IP + allowlist check shared by token-gated endpoints (code
// feeds, the OTP board API). Moved out of the feeds route so the OTP
// route applies the same rules.
export function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

export function ipAllowed(ip: string | null, allow: string[]): boolean {
  if (allow.length === 0) return true;
  if (!ip) return false;
  const toInt = (s: string): number | null => {
    const p = s.split(".");
    if (p.length !== 4) return null;
    let n = 0;
    for (const part of p) {
      const v = Number(part);
      if (!Number.isInteger(v) || v < 0 || v > 255) return null;
      n = (n << 8) | v;
    }
    return n >>> 0;
  };
  const ipInt = toInt(ip);
  for (const entry of allow) {
    if (entry === ip) return true;
    const [net, bitsRaw] = entry.split("/");
    if (!bitsRaw || ipInt == null) continue;
    const netInt = toInt(net ?? "");
    const bits = Number(bitsRaw);
    if (netInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((ipInt & mask) === (netInt & mask)) return true;
  }
  return false;
}
