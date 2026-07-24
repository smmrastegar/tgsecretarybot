"use client";

import { use, useCallback, useEffect, useState } from "react";

type Task = {
  id: number; title: string; status: string;
  assignee: string | null; topic: string | null; note: string | null; source: string;
};
type Event = {
  id: number; action: string; actor: string | null; summary: string;
  reverted: boolean; createdAt: string;
};

const COLUMNS = [
  { key: "todo", label: "برای انجام", color: "#64748b" },
  { key: "doing", label: "در حال انجام", color: "#f59e0b" },
  { key: "blocked", label: "متوقف / بلاک", color: "#ef4444" },
  { key: "done", label: "انجام‌شده", color: "#22c55e" },
];

export default function BoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [authed, setAuthed] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [title, setTitle] = useState("");
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      "X-Board-Code": code,
      "X-Board-Actor": name,
    }),
    [code, name],
  );

  const loadTasks = useCallback(async () => {
    const r = await fetch(`/api/board/${token}`, { headers: headers() });
    if (!r.ok) return false;
    const j = (await r.json()) as { chatTitle: string | null; tasks: Task[] };
    setChatTitle(j.chatTitle);
    setTasks(j.tasks);
    return true;
  }, [token, headers]);

  const loadLog = useCallback(async () => {
    const r = await fetch(`/api/board/${token}/log`, { headers: headers() });
    if (r.ok) setEvents(((await r.json()) as { events: Event[] }).events);
  }, [token, headers]);

  // Auto-login from a saved session.
  useEffect(() => {
    const n = localStorage.getItem("board_name") ?? "";
    const c = localStorage.getItem(`board_code_${token}`) ?? "";
    if (n && c) { setName(n); setCode(c); }
  }, [token]);
  useEffect(() => {
    if (!authed && name && code && localStorage.getItem("board_tried") !== "1") {
      // try silent login once creds are hydrated
      void (async () => {
        const r = await fetch(`/api/board/${token}`, { headers: { "X-Board-Code": code, "X-Board-Actor": name } });
        if (r.ok) { setAuthed(true); await loadTasks(); }
      })();
    }
  }, [authed, name, code, token, loadTasks]);

  async function login() {
    setLoginErr(null);
    if (!name.trim() || !code.trim()) { setLoginErr("نام و رمز لازم است"); return; }
    const r = await fetch(`/api/board/${token}`, {
      headers: { "X-Board-Code": code.trim(), "X-Board-Actor": name.trim() },
    });
    if (r.status === 401) { setLoginErr("رمز اشتباه است"); return; }
    if (r.status === 403) { setLoginErr("رمز برد هنوز تنظیم نشده — به مدیر بگو"); return; }
    if (!r.ok) { setLoginErr("خطا"); return; }
    localStorage.setItem("board_name", name.trim());
    localStorage.setItem(`board_code_${token}`, code.trim());
    setAuthed(true);
    await loadTasks();
  }

  async function addTask() {
    const t = title.trim(); if (!t) return; setTitle("");
    const r = await fetch(`/api/board/${token}`, { method: "POST", headers: headers(), body: JSON.stringify({ title: t }) });
    if (r.ok) { const j = (await r.json()) as { task: Task }; if (j.task) setTasks((x) => [...x, j.task]); if (showLog) void loadLog(); }
  }
  async function patch(id: number, p: Partial<Task>) {
    setTasks((x) => x.map((t) => (t.id === id ? { ...t, ...p } : t)));
    await fetch(`/api/board/${token}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ id, ...p }) }).catch(() => {});
    if (showLog) void loadLog();
  }
  async function del(id: number) {
    setTasks((x) => x.filter((t) => t.id !== id));
    await fetch(`/api/board/${token}?id=${id}`, { method: "DELETE", headers: headers() }).catch(() => {});
    if (showLog) void loadLog();
  }
  async function revert(eventId: number) {
    await fetch(`/api/board/${token}/revert`, { method: "POST", headers: headers(), body: JSON.stringify({ eventId }) }).catch(() => {});
    await Promise.all([loadTasks(), loadLog()]);
  }

  if (!authed) {
    return (
      <div dir="rtl" style={S.loginWrap}>
        <div style={S.loginBox}>
          <h1 style={S.h1}>📋 ورود به برد تسک</h1>
          <p style={S.sub}>برای دیدن یا ویرایش، با نام و رمز وارد شو.</p>
          <input style={S.input} placeholder="نام شما" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={S.input} placeholder="رمز برد" type="password" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
          <button style={S.loginBtn} onClick={login}>ورود</button>
          {loginErr && <div style={S.err}>{loginErr}</div>}
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>📋 برد تسک — {chatTitle ?? "گروه"}</h1>
          <p style={S.sub}>{tasks.length} تسک · واردشده به‌عنوان «{name}»</p>
        </div>
        <button style={S.logBtn} onClick={() => { const n = !showLog; setShowLog(n); if (n) void loadLog(); }}>
          {showLog ? "بستن لاگ" : "🕘 لاگ و بازگردانی"}
        </button>
      </div>

      {showLog && (
        <div style={S.logPanel}>
          <div style={S.logTitle}>تاریخچه‌ی تغییرات (جدیدترین بالا)</div>
          {events.length === 0 && <div style={S.empty}>هنوز تغییری ثبت نشده.</div>}
          {events.map((e) => (
            <div key={e.id} style={S.logRow}>
              <span style={{ opacity: e.reverted ? 0.5 : 1 }}>
                <b>{e.actor || "?"}</b> — {e.summary}
                <span style={S.time}> · {new Date(e.createdAt).toLocaleString("fa-IR")}</span>
                {e.reverted && <span style={S.revTag}> (بازگردانده شد)</span>}
              </span>
              {!e.reverted && e.action !== "revert" && (
                <button style={S.revBtn} onClick={() => revert(e.id)}>↩️ بازگردانی</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={S.addRow}>
        <input style={S.addInput} placeholder="تسک جدید بنویس و Enter بزن…" value={title}
          onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} />
        <button style={S.addBtn} onClick={addTask}>افزودن</button>
      </div>

      <div style={S.board}>
        {COLUMNS.map((col) => {
          const list = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} style={S.col}>
              <div style={{ ...S.colHead, borderColor: col.color }}>
                <span style={{ color: col.color, fontWeight: 700 }}>{col.label}</span>
                <span style={S.count}>{list.length}</span>
              </div>
              {list.map((t) => (
                <div key={t.id} style={S.card}>
                  <input style={S.cardTitle} value={t.title}
                    onChange={(e) => setTasks((x) => x.map((y) => (y.id === t.id ? { ...y, title: e.target.value } : y)))}
                    onBlur={(e) => patch(t.id, { title: e.target.value })} />
                  <div style={S.cardRow}>
                    <input style={S.assignee} placeholder="مسئول…" value={t.assignee ?? ""}
                      onChange={(e) => setTasks((x) => x.map((y) => (y.id === t.id ? { ...y, assignee: e.target.value } : y)))}
                      onBlur={(e) => patch(t.id, { assignee: e.target.value || null })} />
                    {t.source === "ai" && <span style={S.aiTag}>AI</span>}
                  </div>
                  <div style={S.cardActions}>
                    <select style={S.select} value={t.status} onChange={(e) => patch(t.id, { status: e.target.value })}>
                      {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <button style={S.del} onClick={() => del(t.id)} title="حذف">🗑</button>
                  </div>
                </div>
              ))}
              {list.length === 0 && <div style={S.empty}>—</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  loginWrap: { display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "system-ui, Tahoma, sans-serif" },
  loginBox: { background: "#1e293b", padding: 28, borderRadius: 14, width: 320, color: "#e2e8f0", boxShadow: "0 10px 40px rgba(0,0,0,.4)" },
  input: { width: "100%", boxSizing: "border-box", background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginTop: 10 },
  loginBtn: { width: "100%", marginTop: 14, background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  err: { color: "#f87171", fontSize: 13, marginTop: 10, textAlign: "center" },
  page: { fontFamily: "system-ui, Tahoma, sans-serif", background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", padding: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  h1: { fontSize: 20, fontWeight: 800, margin: 0 },
  sub: { fontSize: 12, color: "#94a3b8", margin: "4px 0 0" },
  logBtn: { background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  logPanel: { background: "#1e293b", borderRadius: 12, padding: 12, marginBottom: 16, maxHeight: 300, overflowY: "auto" },
  logTitle: { fontSize: 13, fontWeight: 700, color: "#cbd5e1", marginBottom: 8 },
  logRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 4px", borderBottom: "1px solid #293548" },
  time: { color: "#64748b" },
  revTag: { color: "#22c55e" },
  revBtn: { background: "transparent", color: "#a78bfa", border: "1px solid #6d28d9", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" },
  addRow: { display: "flex", gap: 8, marginBottom: 16 },
  addInput: { flex: 1, background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "10px 12px", fontSize: 14 },
  addBtn: { background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "0 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  board: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, alignItems: "start" },
  col: { background: "#1e293b", borderRadius: 12, padding: 10, minHeight: 120 },
  colHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px 8px", borderBottom: "2px solid", marginBottom: 8 },
  count: { fontSize: 12, color: "#94a3b8", background: "#0f172a", borderRadius: 10, padding: "1px 8px" },
  card: { background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 8, marginBottom: 8 },
  cardTitle: { width: "100%", background: "transparent", border: "none", color: "#e2e8f0", fontSize: 13, fontWeight: 600, outline: "none", padding: 2 },
  cardRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
  assignee: { flex: 1, background: "#1e293b", border: "1px solid #334155", color: "#cbd5e1", borderRadius: 6, padding: "3px 6px", fontSize: 11 },
  aiTag: { fontSize: 9, color: "#a78bfa", border: "1px solid #6d28d9", borderRadius: 4, padding: "1px 4px" },
  cardActions: { display: "flex", gap: 6, marginTop: 6, alignItems: "center" },
  select: { flex: 1, background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6, padding: "3px 6px", fontSize: 11 },
  del: { background: "transparent", border: "none", cursor: "pointer", fontSize: 13, opacity: 0.7 },
  empty: { textAlign: "center", color: "#475569", fontSize: 12, padding: 8 },
};
