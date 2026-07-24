"use client";

import { use, useCallback, useEffect, useState } from "react";

type Task = {
  id: number;
  title: string;
  status: string;
  assignee: string | null;
  topic: string | null;
  note: string | null;
  source: string;
};

const COLUMNS: Array<{ key: string; label: string; color: string }> = [
  { key: "todo", label: "برای انجام", color: "#64748b" },
  { key: "doing", label: "در حال انجام", color: "#f59e0b" },
  { key: "blocked", label: "متوقف / بلاک", color: "#ef4444" },
  { key: "done", label: "انجام‌شده", color: "#22c55e" },
];

export default function BoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState("");

  useEffect(() => {
    setMe(localStorage.getItem("board_me") ?? "");
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/board/${token}`);
      if (!r.ok) {
        setErr(r.status === 404 ? "لینک نامعتبر است" : "خطا در بارگذاری");
        setLoading(false);
        return;
      }
      const j = (await r.json()) as { chatTitle: string | null; tasks: Task[] };
      setChatTitle(j.chatTitle);
      setTasks(j.tasks);
      setErr(null);
    } catch {
      setErr("خطای شبکه");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTask() {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    const r = await fetch(`/api/board/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, createdBy: me || undefined }),
    });
    if (r.ok) {
      const j = (await r.json()) as { task: Task };
      if (j.task) setTasks((x) => [...x, j.task]);
    }
  }

  async function patch(id: number, patch: Partial<Task>) {
    setTasks((x) => x.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    await fetch(`/api/board/${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    }).catch(() => {});
  }

  async function del(id: number) {
    setTasks((x) => x.filter((t) => t.id !== id));
    await fetch(`/api/board/${token}?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (loading) return <div style={S.center}>در حال بارگذاری…</div>;
  if (err) return <div style={{ ...S.center, color: "#ef4444" }}>{err}</div>;

  return (
    <div dir="rtl" style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>📋 برد تسک — {chatTitle ?? "گروه"}</h1>
          <p style={S.sub}>{tasks.length} تسک · تغییرات همین‌جا ذخیره می‌شن</p>
        </div>
        <input
          style={S.me}
          placeholder="اسم شما (اختیاری)"
          value={me}
          onChange={(e) => {
            setMe(e.target.value);
            localStorage.setItem("board_me", e.target.value);
          }}
        />
      </div>

      <div style={S.addRow}>
        <input
          style={S.addInput}
          placeholder="یک تسک جدید بنویس و Enter بزن…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
        />
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
                  <input
                    style={S.cardTitle}
                    value={t.title}
                    onChange={(e) => setTasks((x) => x.map((y) => (y.id === t.id ? { ...y, title: e.target.value } : y)))}
                    onBlur={(e) => patch(t.id, { title: e.target.value })}
                  />
                  <div style={S.cardRow}>
                    <input
                      style={S.assignee}
                      placeholder="مسئول…"
                      value={t.assignee ?? ""}
                      onChange={(e) => setTasks((x) => x.map((y) => (y.id === t.id ? { ...y, assignee: e.target.value } : y)))}
                      onBlur={(e) => patch(t.id, { assignee: e.target.value || null })}
                    />
                    {t.source === "ai" && <span style={S.aiTag}>AI</span>}
                  </div>
                  <div style={S.cardActions}>
                    <select
                      style={S.select}
                      value={t.status}
                      onChange={(e) => patch(t.id, { status: e.target.value })}
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
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
  center: { display: "flex", minHeight: "60vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: "#94a3b8" },
  page: { fontFamily: "system-ui, Tahoma, sans-serif", background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", padding: "16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  h1: { fontSize: 20, fontWeight: 800, margin: 0 },
  sub: { fontSize: 12, color: "#94a3b8", margin: "4px 0 0" },
  me: { background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 13 },
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
