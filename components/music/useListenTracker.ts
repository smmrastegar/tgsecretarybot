"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

// Measures how long a track is actually heard (forward playback only,
// seeks and pauses don't count) and reports one session per track to
// /api/music/<id>/event. `tq` is "" for the dashboard or "t=<token>"
// for the private player.
export function useListenTracker(tq: string) {
  const st = useRef({ id: null as number | null, listened: 0, last: 0, dur: 0 });
  const post = useCallback((id: number, seconds: number, dur: number, completed: boolean) => {
    void fetch(`/api/music/${id}/event${tq ? `?${tq}` : ""}`, {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: Math.round(seconds), duration: Math.round(dur), completed }),
    }).catch(() => {});
  }, [tq]);
  const flush = useCallback((completed = false) => {
    const s = st.current;
    if (s.id != null && (s.listened >= 1 || completed)) post(s.id, completed && s.dur ? Math.max(s.listened, s.dur * 0.9) : s.listened, s.dur, completed);
    s.listened = 0; s.last = 0;
  }, [post]);
  const begin = useCallback((id: number) => {
    flush(false);
    st.current = { id, listened: 0, last: 0, dur: 0 };
  }, [flush]);
  const tick = useCallback((t: number, dur: number) => {
    const s = st.current;
    if (Number.isFinite(dur) && dur > 0) s.dur = dur;
    const d = t - s.last;
    if (d > 0 && d < 2.5) s.listened += d;
    s.last = t;
  }, []);
  useEffect(() => {
    const h = () => flush(false);
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, [flush]);
  // Stable identity: consumers list the tracker in effect dependencies,
  // and a fresh object each render re-ran those effects (restarting the
  // audio every timeupdate).
  return useMemo(() => ({ begin, tick, flush }), [begin, tick, flush]);
}
