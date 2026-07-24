"use client";

import Script from "next/script";
import { use, useCallback, useEffect, useState } from "react";

declare global {
  interface Window {
    onBoardTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

type Task = {
  id: number; title: string; status: string;
  assignee: string | null; topic: string | null; note: string | null; source: string;
  commentCount?: number;
  priority?: string | null; labels?: string[]; dueDate?: string | null;
};
type Comment = { id: number; author: string | null; body: string; createdAt: string };
type Event = {
  id: number; action: string; actor: string | null; summary: string;
  reverted: boolean; createdAt: string;
};
type Column = { key: string; label: string; color: string };
type Label = { id: string; name: string; color: string };
type Priority = { key: string; label: string; color: string };
type Tab = { id: number; title: string; icon: string | null; body: string; position: number; source: string };
type Member = { tgId: number; name: string | null; username: string | null; status: string; createdAt: string };

const DEFAULT_PRIORITIES: Priority[] = [
  { key: "low", label: "کم", color: "#22c55e" },
  { key: "normal", label: "عادی", color: "#3b82f6" },
  { key: "high", label: "زیاد", color: "#f59e0b" },
  { key: "critical", label: "بحرانی", color: "#ef4444" },
];

const DEFAULT_COLUMNS: Column[] = [
  { key: "todo", label: "برای انجام", color: "#64748b" },
  { key: "doing", label: "در حال انجام", color: "#f59e0b" },
  { key: "blocked", label: "متوقف / بلاک", color: "#ef4444" },
  { key: "done", label: "انجام‌شده", color: "#22c55e" },
];

type Status = "loading" | "anonymous" | "pending" | "rejected" | "none" | "approved";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "smmrchatbot";

export default function BoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<string>("");
  const [name, setName] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [title, setTitle] = useState("");
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [prompt, setPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [draftCols, setDraftCols] = useState<Column[]>(DEFAULT_COLUMNS);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [openComments, setOpenComments] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>(DEFAULT_PRIORITIES);
  const [openLabels, setOpenLabels] = useState<number | null>(null);
  const [openDetails, setOpenDetails] = useState<number | null>(null);
  const [draftLabels, setDraftLabels] = useState<Label[]>([]);
  const [draftPris, setDraftPris] = useState<Priority[]>(DEFAULT_PRIORITIES);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<number>(0); // 0 = kanban

  const authed = status === "approved";
  const sessKey = `board_session_${token}`;

  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      "X-Board-Session": session,
    }),
    [session],
  );

  // Accept an explicit session so callers that JUST set it (login /
  // magic / mount) don't race the async `session` state update.
  const loadTasks = useCallback(async (sess?: string) => {
    const s = sess ?? session;
    const r = await fetch(`/api/board/${token}`, { headers: { "X-Board-Session": s } });
    if (!r.ok) return false;
    const j = (await r.json()) as {
      chatTitle: string | null; tasks: Task[]; columns?: Column[]; prompt?: string;
      labels?: Label[]; priorities?: Priority[];
    };
    setChatTitle(j.chatTitle);
    setTasks(j.tasks);
    if (Array.isArray(j.columns) && j.columns.length) setColumns(j.columns);
    if (Array.isArray(j.labels)) setLabels(j.labels);
    if (Array.isArray(j.priorities) && j.priorities.length) setPriorities(j.priorities);
    if (typeof j.prompt === "string") setPrompt(j.prompt);
    return true;
  }, [token, session]);

  const loadLog = useCallback(async () => {
    const r = await fetch(`/api/board/${token}/log`, { headers: headers() });
    if (r.ok) setEvents(((await r.json()) as { events: Event[] }).events);
  }, [token, headers]);

  const loadMembers = useCallback(async (sess?: string) => {
    const s = sess ?? session;
    if (!s) return;
    const r = await fetch(`/api/board/${token}/members`, { headers: { "X-Board-Session": s } });
    if (r.ok) setMembers(((await r.json()) as { members: Member[] }).members);
  }, [token, session]);

  const loadTabs = useCallback(async (sess?: string) => {
    const s = sess ?? session;
    if (!s) return;
    const r = await fetch(`/api/board/${token}/tabs`, { headers: { "X-Board-Session": s } });
    if (r.ok) setTabs(((await r.json()) as { tabs: Tab[] }).tabs);
  }, [token, session]);

  function setTabLocal(id: number, patch: Partial<Tab>) {
    setTabs((x) => x.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  async function saveTab(id: number, patch: Partial<Tab>) {
    setTabLocal(id, patch);
    await fetch(`/api/board/${token}/tabs`, {
      method: "PATCH", headers: headers(), body: JSON.stringify({ id, ...patch }),
    }).catch(() => {});
  }
  async function addTab() {
    const r = await fetch(`/api/board/${token}/tabs`, {
      method: "POST", headers: headers(), body: JSON.stringify({ title: "تب جدید", icon: "🗂" }),
    }).catch(() => null);
    if (r && r.ok) {
      const j = (await r.json()) as { tab: Tab };
      if (j.tab) { setTabs((x) => [...x, j.tab]); setActiveTab(j.tab.id); }
    }
  }
  async function deleteTab(id: number) {
    setTabs((x) => x.filter((t) => t.id !== id));
    setActiveTab(0);
    await fetch(`/api/board/${token}/tabs?id=${id}`, { method: "DELETE", headers: headers() }).catch(() => {});
  }
  async function moveTab(id: number, dir: -1 | 1) {
    const ordered = [...tabs].sort((a, b) => a.position - b.position);
    const idx = ordered.findIndex((t) => t.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    const a = ordered[idx], b = ordered[swap];
    if (!a || !b) return;
    setTabs((x) => x.map((t) => (t.id === a.id ? { ...t, position: b.position } : t.id === b.id ? { ...t, position: a.position } : t)));
    await Promise.all([
      fetch(`/api/board/${token}/tabs`, { method: "PATCH", headers: headers(), body: JSON.stringify({ id: a.id, position: b.position }) }).catch(() => {}),
      fetch(`/api/board/${token}/tabs`, { method: "PATCH", headers: headers(), body: JSON.stringify({ id: b.id, position: a.position }) }).catch(() => {}),
    ]);
  }

  async function decide(tgId: number, action: "approve" | "reject") {
    setMembers((x) => x.map((m) => (m.tgId === tgId ? { ...m, status: action === "approve" ? "approved" : "rejected" } : m)));
    await fetch(`/api/board/${token}/members`, {
      method: "POST", headers: headers(), body: JSON.stringify({ tgId, action }),
    }).catch(() => {});
    void loadMembers();
    if (showLog) void loadLog();
  }

  async function toggleComments(taskId: number) {
    if (openComments === taskId) { setOpenComments(null); setComments([]); return; }
    setOpenComments(taskId); setComments([]); setCommentText(""); setLoadingComments(true);
    const r = await fetch(`/api/board/${token}/comments?taskId=${taskId}`, { headers: headers() }).catch(() => null);
    setLoadingComments(false);
    if (r && r.ok) setComments(((await r.json()) as { comments: Comment[] }).comments);
  }
  async function addComment(taskId: number) {
    const text = commentText.trim(); if (!text) return;
    setCommentText("");
    const r = await fetch(`/api/board/${token}/comments`, {
      method: "POST", headers: headers(), body: JSON.stringify({ taskId, body: text }),
    }).catch(() => null);
    if (r && r.ok) {
      const j = (await r.json()) as { comment: Comment };
      setComments((x) => [...x, j.comment]);
      setTasks((x) => x.map((t) => (t.id === taskId ? { ...t, commentCount: (t.commentCount ?? 0) + 1 } : t)));
      if (showLog) void loadLog();
    }
  }

  // Check the saved session's current access status.
  const refreshStatus = useCallback(
    async (sess: string) => {
      const r = await fetch(`/api/board/${token}/me`, { headers: { "X-Board-Session": sess } });
      if (!r.ok) { setStatus("anonymous"); return; }
      const j = (await r.json()) as { status: Status; name?: string; isOwner?: boolean; chatTitle?: string | null };
      if (j.chatTitle) setChatTitle(j.chatTitle);
      if (j.name) setName(j.name);
      setIsOwner(!!j.isOwner);
      setStatus(j.status);
      if (j.status === "approved") await loadTasks(sess);
    },
    [token, loadTasks],
  );

  // On mount: if the URL carries a ?login=<magic> from the bot deep
  // link, exchange it for a session; otherwise hydrate a saved one.
  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get("login");
    if (magic) {
      url.searchParams.delete("login");
      window.history.replaceState({}, "", url.pathname + url.search);
      setStatus("loading");
      void (async () => {
        try {
          const r = await fetch(`/api/board/${token}/magic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: magic }),
          });
          const j = (await r.json().catch(() => ({}))) as {
            session?: string; status?: Status; name?: string; isOwner?: boolean; error?: string;
          };
          if (!r.ok || !j.session) { setLoginErr(j.error ?? "ورود ناموفق بود"); setStatus("anonymous"); return; }
          localStorage.setItem(sessKey, j.session);
          setSession(j.session);
          if (j.name) setName(j.name);
          setIsOwner(!!j.isOwner);
          setStatus(j.status ?? "pending");
          if (j.status === "approved") await loadTasks(j.session);
        } catch { setLoginErr("خطای شبکه"); setStatus("anonymous"); }
      })();
      return;
    }
    const s = localStorage.getItem(sessKey) ?? "";
    if (s) { setSession(s); void refreshStatus(s); }
    else setStatus("anonymous");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // While waiting for approval, poll status every 5s.
  useEffect(() => {
    if (status !== "pending" || !session) return;
    const id = setInterval(() => void refreshStatus(session), 5000);
    return () => clearInterval(id);
  }, [status, session, refreshStatus]);

  // Owner: keep the access-requests list fresh so approvals never
  // depend on the Telegram push arriving.
  useEffect(() => {
    if (!authed || !isOwner || !session) return;
    void loadMembers(session);
    const id = setInterval(() => void loadMembers(session), 15000);
    return () => clearInterval(id);
  }, [authed, isOwner, session, loadMembers]);

  // Load content tabs once approved.
  useEffect(() => {
    if (authed && session) void loadTabs(session);
  }, [authed, session, loadTabs]);

  // Telegram Login Widget callback.
  useEffect(() => {
    window.onBoardTelegramAuth = async (user: Record<string, unknown>) => {
      setLoginErr(null);
      setStatus("loading");
      try {
        const r = await fetch(`/api/board/${token}/tg-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        const j = (await r.json().catch(() => ({}))) as {
          session?: string; status?: Status; name?: string; isOwner?: boolean; error?: string;
        };
        if (!r.ok || !j.session) { setLoginErr(j.error ?? "ورود ناموفق بود"); setStatus("anonymous"); return; }
        localStorage.setItem(sessKey, j.session);
        setSession(j.session);
        if (j.name) setName(j.name);
        setIsOwner(!!j.isOwner);
        setStatus(j.status ?? "pending");
        if (j.status === "approved") await loadTasks(j.session);
      } catch {
        setLoginErr("خطای شبکه"); setStatus("anonymous");
      }
    };
    return () => { delete window.onBoardTelegramAuth; };
  }, [token, sessKey, loadTasks]);

  function logout() {
    localStorage.removeItem(sessKey);
    setSession(""); setStatus("anonymous"); setTasks([]);
  }

  // (Re)ask the owner to approve, then re-check our own status.
  const requestApproval = useCallback(async (sess?: string) => {
    const s = sess ?? session;
    if (!s) return;
    await fetch(`/api/board/${token}/notify`, {
      method: "POST", headers: { "X-Board-Session": s },
    }).catch(() => {});
    await refreshStatus(s);
  }, [token, session, refreshStatus]);

  // When we land on the waiting screen, ping the owner once automatically
  // (covers the case where the login-time push didn't arrive).
  useEffect(() => {
    if (status === "pending" && session) void requestApproval(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === "pending", session]);

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

  function openSettings() {
    setDraftCols(columns.map((c) => ({ ...c })));
    setDraftLabels(labels.map((l) => ({ ...l })));
    setDraftPris(priorities.map((p) => ({ ...p })));
    setDraftPrompt(prompt);
    setCfgMsg(null);
    setShowSettings(true);
  }
  async function saveSettings() {
    setSavingCfg(true); setCfgMsg(null);
    const r = await fetch(`/api/board/${token}/config`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ columns: draftCols, labels: draftLabels, priorities: draftPris, prompt: draftPrompt }),
    }).catch(() => null);
    setSavingCfg(false);
    if (r && r.ok) {
      const j = (await r.json()) as { columns?: Column[]; labels?: Label[]; priorities?: Priority[]; prompt?: string };
      if (Array.isArray(j.columns)) setColumns(j.columns);
      if (Array.isArray(j.labels)) setLabels(j.labels);
      if (Array.isArray(j.priorities)) setPriorities(j.priorities);
      if (typeof j.prompt === "string") setPrompt(j.prompt);
      setCfgMsg("ذخیره شد ✓");
      if (showLog) void loadLog();
      setTimeout(() => setShowSettings(false), 700);
    } else {
      setCfgMsg("خطا در ذخیره");
    }
  }

  // Per-task field helpers (optimistic + PATCH via the existing `patch`).
  function toggleTaskLabel(t: Task, labelId: string) {
    const cur = t.labels ?? [];
    const next = cur.includes(labelId) ? cur.filter((x) => x !== labelId) : [...cur, labelId];
    void patch(t.id, { labels: next });
  }
  const labelById = (id: string) => labels.find((l) => l.id === id);
  const priorityByKey = (k: string | null | undefined) => (k ? priorities.find((p) => p.key === k) : undefined);

  if (!authed) {
    return (
      <div dir="rtl" style={S.loginWrap}>
        <div style={S.loginBox}>
          <h1 style={S.h1}>📋 برد تسک</h1>

          {status === "loading" && <p style={S.sub}>در حال بررسی…</p>}

          {status === "anonymous" && (
            <>
              <p style={S.sub}>برای دسترسی، با تلگرام وارد شو. بعد از تایید مدیر، می‌تونی برد رو ببینی و ویرایش کنی.</p>
              <a href={`https://t.me/${BOT_USERNAME}?start=board_${token}`} target="_blank" rel="noreferrer"
                style={S.tgBtn}>
                ورود با تلگرام
              </a>
              <div style={S.orRow}>
                <span style={S.orLine} /><span style={S.orTxt}>یا</span><span style={S.orLine} />
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Script
                  src="https://telegram.org/js/telegram-widget.js?22"
                  strategy="afterInteractive"
                  data-telegram-login={BOT_USERNAME}
                  data-size="large"
                  data-onauth="onBoardTelegramAuth(user)"
                  data-request-access="write"
                  data-userpic="false"
                />
              </div>
              {loginErr && <div style={S.err}>{loginErr}</div>}
            </>
          )}

          {status === "pending" && (
            <>
              <p style={S.sub}>سلام {name} 👋</p>
              <div style={S.waitBox}>
                ⏳ درخواستت ثبت شد. منتظر تایید مدیر باش — این صفحه خودش به‌روز می‌شه.
              </div>
              <button style={S.logBtnWide} onClick={() => void requestApproval(session)}>بررسی مجدد</button>
              <button style={S.linkBtn} onClick={logout}>خروج</button>
            </>
          )}

          {(status === "rejected") && (
            <>
              <div style={{ ...S.waitBox, borderColor: "#ef4444", color: "#fca5a5" }}>
                ❌ دسترسیت رد شده. اگر فکر می‌کنی اشتباهه، به مدیر بگو.
              </div>
              <button style={S.linkBtn} onClick={logout}>ورود با اکانت دیگر</button>
            </>
          )}

          {status === "none" && (
            <>
              <div style={S.waitBox}>
                این اکانت هنوز برای این برد ثبت نشده. دوباره وارد شو تا درخواست بره برای مدیر.
              </div>
              <button style={S.linkBtn} onClick={logout}>ورود دوباره</button>
            </>
          )}
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isOwner && (() => {
            const pend = members.filter((m) => m.status === "pending").length;
            return (
              <button style={pend > 0 ? S.reqBtnHot : S.logBtn} onClick={() => setShowMembers((v) => !v)}>
                👥 درخواست‌ها{pend > 0 ? ` (${pend})` : ""}
              </button>
            );
          })()}
          {isOwner && (
            <button style={S.logBtn} onClick={() => (showSettings ? setShowSettings(false) : openSettings())}>
              {showSettings ? "بستن تنظیمات" : "⚙️ تنظیمات"}
            </button>
          )}
          <button style={S.logBtn} onClick={() => { const n = !showLog; setShowLog(n); if (n) void loadLog(); }}>
            {showLog ? "بستن لاگ" : "🕘 لاگ و بازگردانی"}
          </button>
          <button style={S.logBtn} onClick={logout}>خروج</button>
        </div>
      </div>

      {showMembers && isOwner && (
        <div style={S.logPanel}>
          <div style={S.logTitle}>👥 درخواست‌های دسترسی</div>
          {members.length === 0 && <div style={S.empty}>هنوز کسی درخواست نداده.</div>}
          {members.map((m) => (
            <div key={m.tgId} style={S.logRow}>
              <span>
                <b>{m.name || (m.username ? `@${m.username}` : m.tgId)}</b>
                {m.username && m.name && <span style={S.time}> @{m.username}</span>}
                {m.status === "approved" && <span style={S.revTag}> · تاییدشده</span>}
                {m.status === "rejected" && <span style={{ color: "#f87171" }}> · ردشده</span>}
                {m.status === "pending" && <span style={{ color: "#f59e0b" }}> · در انتظار</span>}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                {m.status !== "approved" && (
                  <button style={S.okBtn} onClick={() => decide(m.tgId, "approve")}>✅ تایید</button>
                )}
                {m.status !== "rejected" && (
                  <button style={S.noBtn} onClick={() => decide(m.tgId, "reject")}>❌ رد</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {showSettings && (
        <div style={S.logPanel}>
          <div style={S.logTitle}>⚙️ تنظیمات برد</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>نام و رنگ ستون‌ها</div>
          {draftCols.map((c, i) => (
            <div key={c.key} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="color" value={c.color} style={{ width: 34, height: 30, background: "transparent", border: "none", cursor: "pointer" }}
                onChange={(e) => setDraftCols((x) => x.map((y, j) => (j === i ? { ...y, color: e.target.value } : y)))} />
              <input style={{ ...S.input, marginTop: 0, flex: 1 }} value={c.label} maxLength={40}
                onChange={(e) => setDraftCols((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
            </div>
          ))}
          {/* Priorities */}
          <div style={{ fontSize: 12, color: "#94a3b8", margin: "14px 0 6px" }}>نام و رنگ اولویت‌ها</div>
          {draftPris.map((p, i) => (
            <div key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="color" value={p.color} style={{ width: 34, height: 30, background: "transparent", border: "none", cursor: "pointer" }}
                onChange={(e) => setDraftPris((x) => x.map((y, j) => (j === i ? { ...y, color: e.target.value } : y)))} />
              <input style={{ ...S.input, marginTop: 0, flex: 1 }} value={p.label} maxLength={30}
                onChange={(e) => setDraftPris((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
            </div>
          ))}

          {/* Labels */}
          <div style={{ fontSize: 12, color: "#94a3b8", margin: "14px 0 6px" }}>برچسب‌ها (اضافه/حذف/ویرایش)</div>
          {draftLabels.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="color" value={l.color} style={{ width: 34, height: 30, background: "transparent", border: "none", cursor: "pointer" }}
                onChange={(e) => setDraftLabels((x) => x.map((y, j) => (j === i ? { ...y, color: e.target.value } : y)))} />
              <input style={{ ...S.input, marginTop: 0, flex: 1 }} value={l.name} maxLength={40} placeholder="نام برچسب"
                onChange={(e) => setDraftLabels((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <button style={S.noBtn} onClick={() => setDraftLabels((x) => x.filter((_, j) => j !== i))}>حذف</button>
            </div>
          ))}
          <button style={{ ...S.logBtn, marginTop: 2 }}
            onClick={() => setDraftLabels((x) => [...x, { id: `l${Date.now().toString(36)}${x.length}`, name: "", color: "#64748b" }])}>
            + برچسب جدید
          </button>

          <div style={{ fontSize: 12, color: "#94a3b8", margin: "14px 0 6px" }}>
            پرامپت دسته‌بندی هوش مصنوعی (به تحلیل خودکار تسک‌ها اضافه می‌شود)
          </div>
          <textarea style={{ ...S.input, marginTop: 0, minHeight: 90, resize: "vertical", fontFamily: "inherit" }}
            placeholder="مثال: هر پیام از تاپیک «سفارش‌ها» یک تسک با اولویت بالا است…"
            value={draftPrompt} maxLength={2000} onChange={(e) => setDraftPrompt(e.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <button style={S.addBtn} onClick={saveSettings} disabled={savingCfg}>
              {savingCfg ? "…" : "ذخیره"}
            </button>
            <button style={S.logBtn} onClick={() => setShowSettings(false)}>بستن</button>
            {cfgMsg && <span style={{ fontSize: 12, color: cfgMsg.includes("✓") ? "#22c55e" : "#f87171" }}>{cfgMsg}</span>}
          </div>
        </div>
      )}

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

      {/* Tab bar */}
      <div style={S.tabBar}>
        <button style={activeTab === 0 ? S.tabOn : S.tab} onClick={() => setActiveTab(0)}>📋 برد تسک</button>
        {[...tabs].sort((a, b) => a.position - b.position).map((tb) => (
          <button key={tb.id} style={activeTab === tb.id ? S.tabOn : S.tab} onClick={() => setActiveTab(tb.id)}>
            {tb.icon ? `${tb.icon} ` : ""}{tb.title}
          </button>
        ))}
        {isOwner && <button style={S.tabAdd} onClick={addTab} title="تب جدید">＋</button>}
      </div>

      {activeTab !== 0 ? (
        (() => {
          const tb = tabs.find((t) => t.id === activeTab);
          if (!tb) return <div style={S.empty}>—</div>;
          return (
            <div style={S.tabPanel}>
              <div style={S.tabPanelHead}>
                {isOwner ? (
                  <>
                    <input style={S.tabIconInput} value={tb.icon ?? ""} maxLength={4}
                      onChange={(e) => setTabLocal(tb.id, { icon: e.target.value })}
                      onBlur={(e) => saveTab(tb.id, { icon: e.target.value })} />
                    <input style={S.tabTitleInput} value={tb.title}
                      onChange={(e) => setTabLocal(tb.id, { title: e.target.value })}
                      onBlur={(e) => saveTab(tb.id, { title: e.target.value })} />
                    <button style={S.miniBtn} onClick={() => moveTab(tb.id, -1)} title="جابه‌جایی">▶</button>
                    <button style={S.miniBtn} onClick={() => moveTab(tb.id, 1)} title="جابه‌جایی">◀</button>
                    <button style={S.noBtn} onClick={() => { if (confirm("این تب حذف شود؟")) void deleteTab(tb.id); }}>حذف تب</button>
                  </>
                ) : (
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{tb.icon} {tb.title}</span>
                )}
              </div>
              <textarea
                style={S.tabBody}
                placeholder="محتوای این تب را بنویس…"
                value={tb.body}
                onChange={(e) => setTabLocal(tb.id, { body: e.target.value })}
                onBlur={(e) => saveTab(tb.id, { body: e.target.value })}
              />
              <div style={S.tabHint}>تغییرات با خارج‌شدن از کادر ذخیره می‌شود.</div>
            </div>
          );
        })()
      ) : (
      <>
      <div style={S.addRow}>
        <input style={S.addInput} placeholder="تسک جدید بنویس و Enter بزن…" value={title}
          onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} />
        <button style={S.addBtn} onClick={addTask}>افزودن</button>
      </div>

      <div style={S.board}>
        {columns.map((col) => {
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

                  {/* Labels (chips) */}
                  {(t.labels ?? []).length > 0 && (
                    <div style={S.chipRow}>
                      {(t.labels ?? []).map((lid) => {
                        const l = labelById(lid);
                        if (!l) return null;
                        return <span key={lid} style={{ ...S.chip, background: l.color + "33", color: l.color, borderColor: l.color }}>{l.name}</span>;
                      })}
                    </div>
                  )}

                  {/* Priority + due date */}
                  <div style={S.metaRow}>
                    <select
                      style={{ ...S.miniSelect, color: priorityByKey(t.priority)?.color ?? "#94a3b8", borderColor: priorityByKey(t.priority)?.color ?? "#334155" }}
                      value={t.priority ?? ""}
                      onChange={(e) => patch(t.id, { priority: e.target.value || null })}
                    >
                      <option value="">اولویت…</option>
                      {priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    <input
                      type="date"
                      style={S.dateInput}
                      value={t.dueDate ?? ""}
                      onChange={(e) => patch(t.id, { dueDate: e.target.value || null })}
                    />
                    <button
                      style={openLabels === t.id ? S.miniBtnOn : S.miniBtn}
                      onClick={() => setOpenLabels(openLabels === t.id ? null : t.id)}
                      title="برچسب"
                    >🏷</button>
                  </div>

                  {/* Label picker */}
                  {openLabels === t.id && (
                    <div style={S.labelPicker}>
                      {labels.length === 0 && <span style={S.cmtEmpty}>برچسبی تعریف نشده — از ⚙️ تنظیمات اضافه کن.</span>}
                      {labels.map((l) => {
                        const on = (t.labels ?? []).includes(l.id);
                        return (
                          <button
                            key={l.id}
                            onClick={() => toggleTaskLabel(t, l.id)}
                            style={{ ...S.pickChip, borderColor: l.color, background: on ? l.color + "33" : "transparent", color: on ? l.color : "#94a3b8" }}
                          >
                            {on ? "✓ " : ""}{l.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div style={S.cardActions}>
                    <select style={S.select} value={t.status} onChange={(e) => patch(t.id, { status: e.target.value })}>
                      {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <button
                      style={openDetails === t.id ? S.miniBtnOn : S.miniBtn}
                      onClick={() => setOpenDetails(openDetails === t.id ? null : t.id)}
                      title="توضیحات"
                    >📝</button>
                    <button
                      style={openComments === t.id ? S.cmtBtnOn : S.cmtBtn}
                      onClick={() => toggleComments(t.id)}
                      title="کامنت‌ها"
                    >
                      💬{(t.commentCount ?? 0) > 0 ? ` ${t.commentCount}` : ""}
                    </button>
                    <button style={S.del} onClick={() => del(t.id)} title="حذف">🗑</button>
                  </div>

                  {/* Description */}
                  {openDetails === t.id && (
                    <textarea
                      style={S.noteArea}
                      placeholder="توضیحات تسک…"
                      defaultValue={t.note ?? ""}
                      onBlur={(e) => patch(t.id, { note: e.target.value || null })}
                    />
                  )}
                  {openComments === t.id && (
                    <div style={S.cmtPanel}>
                      {loadingComments && <div style={S.cmtEmpty}>در حال بارگذاری…</div>}
                      {!loadingComments && comments.length === 0 && <div style={S.cmtEmpty}>هنوز کامنتی نیست.</div>}
                      {comments.map((c) => (
                        <div key={c.id} style={S.cmtRow}>
                          <div style={S.cmtHead}>
                            <b>{c.author || "?"}</b>
                            <span style={S.time}>{new Date(c.createdAt).toLocaleString("fa-IR")}</span>
                          </div>
                          <div style={S.cmtBody}>{c.body}</div>
                        </div>
                      ))}
                      <div style={S.cmtInputRow}>
                        <input
                          style={S.cmtInput}
                          placeholder="کامنت بنویس و Enter بزن…"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addComment(t.id)}
                        />
                        <button style={S.cmtSend} onClick={() => addComment(t.id)}>ارسال</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {list.length === 0 && <div style={S.empty}>—</div>}
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  loginWrap: { display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "system-ui, Tahoma, sans-serif" },
  loginBox: { background: "#1e293b", padding: 28, borderRadius: 14, width: 320, color: "#e2e8f0", boxShadow: "0 10px 40px rgba(0,0,0,.4)" },
  input: { width: "100%", boxSizing: "border-box", background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginTop: 10 },
  loginBtn: { width: "100%", marginTop: 14, background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  tgBtn: { display: "block", marginTop: 18, background: "#229ED9", color: "#fff", textAlign: "center", textDecoration: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700 },
  orRow: { display: "flex", alignItems: "center", gap: 10, margin: "16px 0 8px" },
  orLine: { flex: 1, height: 1, background: "#334155" },
  orTxt: { fontSize: 12, color: "#64748b" },
  waitBox: { marginTop: 16, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "14px 16px", fontSize: 14, lineHeight: 1.8, color: "#cbd5e1" },
  logBtnWide: { width: "100%", marginTop: 14, background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, padding: "10px", fontSize: 14, cursor: "pointer" },
  linkBtn: { width: "100%", marginTop: 10, background: "transparent", color: "#94a3b8", border: "none", fontSize: 13, cursor: "pointer" },
  err: { color: "#f87171", fontSize: 13, marginTop: 10, textAlign: "center" },
  page: { fontFamily: "system-ui, Tahoma, sans-serif", background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", padding: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  h1: { fontSize: 20, fontWeight: 800, margin: 0 },
  sub: { fontSize: 12, color: "#94a3b8", margin: "4px 0 0" },
  logBtn: { background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  reqBtnHot: { background: "#b45309", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  okBtn: { background: "#166534", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  noBtn: { background: "transparent", color: "#f87171", border: "1px solid #7f1d1d", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
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
  cmtBtn: { background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" },
  cmtBtnOn: { background: "#3730a3", border: "1px solid #6366f1", color: "#e0e7ff", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" },
  cmtPanel: { marginTop: 8, borderTop: "1px solid #293548", paddingTop: 8 },
  cmtEmpty: { color: "#475569", fontSize: 11, padding: "2px 0 6px" },
  cmtRow: { marginBottom: 6, background: "#1e293b", borderRadius: 8, padding: "6px 8px" },
  cmtHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, fontSize: 11, color: "#cbd5e1", marginBottom: 2 },
  cmtBody: { fontSize: 12, color: "#e2e8f0", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  cmtInputRow: { display: "flex", gap: 6, marginTop: 6 },
  cmtInput: { flex: 1, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6, padding: "6px 8px", fontSize: 12 },
  cmtSend: { background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "0 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 },
  chip: { fontSize: 10, border: "1px solid", borderRadius: 999, padding: "1px 8px", fontWeight: 600 },
  metaRow: { display: "flex", gap: 6, marginTop: 6, alignItems: "center" },
  miniSelect: { flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "3px 6px", fontSize: 11, fontWeight: 700 },
  dateInput: { background: "#1e293b", border: "1px solid #334155", color: "#cbd5e1", borderRadius: 6, padding: "2px 6px", fontSize: 11, colorScheme: "dark" as React.CSSProperties["colorScheme"] },
  miniBtn: { background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" },
  miniBtnOn: { background: "#3730a3", border: "1px solid #6366f1", color: "#e0e7ff", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" },
  labelPicker: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, padding: 6, background: "#0b1220", borderRadius: 8, border: "1px solid #293548" },
  pickChip: { fontSize: 11, border: "1px solid", borderRadius: 999, padding: "2px 10px", cursor: "pointer", background: "transparent" },
  noteArea: { width: "100%", boxSizing: "border-box", marginTop: 8, minHeight: 60, resize: "vertical", background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "8px", fontSize: 12, fontFamily: "inherit" },
  tabBar: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" },
  tab: { background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer" },
  tabOn: { background: "#6366f1", color: "#fff", border: "1px solid #6366f1", borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  tabAdd: { background: "transparent", color: "#94a3b8", border: "1px dashed #475569", borderRadius: 999, padding: "6px 12px", fontSize: 15, cursor: "pointer", lineHeight: 1 },
  tabPanel: { background: "#1e293b", borderRadius: 12, padding: 14 },
  tabPanelHead: { display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" },
  tabIconInput: { width: 44, textAlign: "center", background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "6px", fontSize: 15 },
  tabTitleInput: { flex: 1, minWidth: 160, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 15, fontWeight: 700 },
  tabBody: { width: "100%", boxSizing: "border-box", minHeight: 320, resize: "vertical", background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.9, fontFamily: "inherit" },
  tabHint: { fontSize: 11, color: "#64748b", marginTop: 6 },
};
