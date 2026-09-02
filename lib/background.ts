// Fire-and-forget with a paper trail.
//
// `void somePromise()` drops the rejection on the floor: the work fails,
// nothing is logged, and nothing tells you it never happened. There
// were 63 of these. On a serverless runtime the promise could also be
// frozen when the request handler returned, which is how rule forwards
// were silently lost before they were awaited.
//
// background() keeps the fire-and-forget shape — the caller does not
// wait — but a rejection is reported to the System Log under the name
// you gave it, so a failing background job is at least visible.
import { reportError } from "./report";

export function background(name: string, work: Promise<unknown> | (() => Promise<unknown>)): void {
  const p = typeof work === "function" ? Promise.resolve().then(work) : work;
  p.catch((err) => reportError(`background:${name}`, err));
}
