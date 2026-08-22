// One call that both prints to the server log AND records into
// system_errors, so the operator's System Log page reflects what
// actually went wrong. Previously ~245 catch sites only did
// console.error / console.warn, so the page showed a single subsystem
// and looked like "no errors in 60 days".
//
// Variadic like console.* on purpose: existing call sites pass a
// message and a caught value in either order, and this is a drop-in
// replacement for them. Fire-and-forget and self-swallowing —
// reporting a failure must never cause one.
import { captureError } from "./db";

function split(args: unknown[]): { error: unknown; scope: string | null } {
  const err = args.find((a) => a instanceof Error);
  const texts = args
    .filter((a) => a !== err && (typeof a === "string" || typeof a === "number"))
    .map(String);
  const scope = texts.join(" ").trim() || null;
  // With no Error present, the joined text IS the error; keep any
  // non-string leftovers (objects) as the payload instead.
  const fallback =
    args.find((a) => a !== err && typeof a === "object" && a !== null) ??
    scope ??
    "unknown error";
  return { error: err ?? fallback, scope: err ? scope : null };
}

function emit(
  level: "error" | "warn",
  source: string,
  args: unknown[],
): void {
  (level === "error" ? console.error : console.warn)(`[${source}]`, ...args);
  const { error, scope } = split(args);
  void captureError({ source, error, scope, level }).catch(() => {});
}

export function reportError(source: string, ...args: unknown[]): void {
  emit("error", source, args);
}

export function reportWarn(source: string, ...args: unknown[]): void {
  emit("warn", source, args);
}
