"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClient } from "@/lib/client-report";

// A crash inside one part of a screen must not take the whole screen (and the music) down with it:
// the broken part shows a small "try again" card, everything around it keeps working.
type Props = { name: string; children: ReactNode; resetKey?: string | number; compact?: boolean; onClose?: () => void };
type State = { error: Error | null };

export default class SafeBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { reportClient(`boundary:${this.props.name}`, error, info.componentStack?.split("\n").slice(1, 3).join(" ").trim()); }
  componentDidUpdate(prev: Props) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); } // navigating elsewhere clears it
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed/i.test(`${error.name} ${error.message}`);
    return (
      <div role="alert" className="my-6 rounded-2xl border border-[var(--bd,rgba(255,255,255,.12))] bg-[var(--s1,rgba(255,255,255,.06))] px-4 py-5 text-center">
        <div className="text-[15px] font-semibold">{stale ? "A new version is available" : "This part hit a problem"}</div>
        <div className="mt-1 text-[13px] opacity-70">{stale ? "Reload when you are ready — your music keeps playing until then." : "The rest of the player still works. It has been reported."}</div>
        <div className="mt-3 flex justify-center gap-2">
          {!stale && <button onClick={() => this.setState({ error: null })} className="rounded-full px-4 py-2 text-[14px] font-semibold bg-[var(--fg,#ececf1)] text-[var(--bg,#0b0b0f)]">Try again</button>}
          {stale && <button onClick={() => window.location.reload()} className="rounded-full px-4 py-2 text-[14px] font-semibold bg-[var(--fg,#ececf1)] text-[var(--bg,#0b0b0f)]">Reload</button>}
          {this.props.onClose && <button onClick={this.props.onClose} className="rounded-full px-4 py-2 text-[14px] font-semibold border border-[var(--bd,rgba(255,255,255,.2))]">Close</button>}
        </div>
      </div>
    );
  }
}
