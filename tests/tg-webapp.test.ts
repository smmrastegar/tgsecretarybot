import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInitData } from "@/lib/tg-webapp";

const TOKEN = "123456:TEST-token";
function sign(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const NOW = 1_800_000_000_000;
const fields = { auth_date: String(NOW / 1000 - 60), query_id: "AAH", user: JSON.stringify({ id: 42, first_name: "Mahdi" }) };

describe("verifyInitData", () => {
  it("accepts correctly signed, fresh data", () => {
    expect(verifyInitData(sign(fields), TOKEN, 86400, NOW)?.id).toBe(42);
  });
  it("rejects a wrong bot token, tampering and stale data", () => {
    expect(verifyInitData(sign(fields, "999:other"), TOKEN, 86400, NOW)).toBeNull();
    expect(verifyInitData(sign(fields).replace("Mahdi", "Evil"), TOKEN, 86400, NOW)).toBeNull();
    expect(verifyInitData(sign({ ...fields, auth_date: String(NOW / 1000 - 90000) }), TOKEN, 86400, NOW)).toBeNull();
    expect(verifyInitData("", TOKEN, 86400, NOW)).toBeNull();
    expect(verifyInitData("hash=abc", TOKEN, 86400, NOW)).toBeNull();
  });
});
