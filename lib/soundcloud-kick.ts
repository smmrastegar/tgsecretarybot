import { reportWarn } from "./report";

/** Start downloading right after an import instead of waiting for the next minute (best effort, in the background). */
export function kickScDownloads(): void {
  void import("./soundcloud").then((m) => m.soundcloudStep(2)).catch((e) => reportWarn("music", "soundcloud kick failed:", e));
}
