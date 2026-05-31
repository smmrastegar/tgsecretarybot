import type { SettingsView } from "./settings";

export type Secretary = { userId: number; name: string };

export function getSecretaries(settings: SettingsView): Secretary[] {
  const raw = settings.secretariesJson?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((s) => {
            if (!s || typeof s !== "object") return null;
            const o = s as { userId?: unknown; name?: unknown };
            const id = Number(o.userId);
            if (!Number.isFinite(id) || id <= 0) return null;
            const name = typeof o.name === "string" && o.name ? o.name : `user ${id}`;
            return { userId: id, name };
          })
          .filter((x): x is Secretary => x !== null);
      }
    } catch {
      // fall through to legacy
    }
  }
  // Legacy: single secretary configured via the old fields.
  const legacy = Number(settings.secretaryUserId);
  if (Number.isFinite(legacy) && legacy > 0) {
    return [
      {
        userId: legacy,
        name: settings.secretaryDisplayName || "Secretary",
      },
    ];
  }
  return [];
}

export function defaultSecretary(settings: SettingsView): Secretary | null {
  const list = getSecretaries(settings);
  return list[0] ?? null;
}

export function findSecretary(
  settings: SettingsView,
  userId: number,
): Secretary | null {
  return getSecretaries(settings).find((s) => s.userId === userId) ?? null;
}
