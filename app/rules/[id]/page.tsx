"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime, truncate } from "@/lib/format";

type Rule = {
  id: number;
  name: string;
  description: string;
  forwardFormat: string | null;
  requestTrigger: string | null;
  requestWindowSeconds: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const WINDOW_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "همیشه (بدون gate)" },
  { value: 60, label: "۱ دقیقه" },
  { value: 120, label: "۲ دقیقه" },
  { value: 300, label: "۵ دقیقه" },
  { value: 3600, label: "۱ ساعت" },
];
type Recipient = {
  ruleId: number;
  recipientChatId: number;
  recipientLabel: string | null;
  createdAt: string;
};
type Example = {
  id: number;
  text: string;
  label: string | null;
  createdAt: string;
};
type Match = {
  id: number;
  ruleId: number;
  messageLogId: number;
  formattedText: string | null;
  forwardedTo: number[];
  forwardErrors: Record<string, string> | null;
  matchedAt: string;
  messageText: string;
  senderName: string;
  chatId: number;
};
type TestResult = {
  messageLogId: number;
  chatId: number;
  chatTitle: string | null;
  senderName: string;
  originalText: string;
  matched: boolean;
  formattedText: string | null;
  createdAt: string;
};

export default function RuleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [rule, setRule] = useState<Rule | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // edit form
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [format, setFormat] = useState("");
  const [requestTrigger, setRequestTrigger] = useState("");
  const [requestWindow, setRequestWindow] = useState<number | null>(null);

  // recipient form
  const [newChat, setNewChat] = useState("");
  const [newLabel, setNewLabel] = useState("");

  // example form
  const [newExampleText, setNewExampleText] = useState("");
  const [newExampleLabel, setNewExampleLabel] = useState("");

  // test
  const [testLimit, setTestLimit] = useState(30);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const MATCH_PAGE = 10;
  const [hasMoreMatches, setHasMoreMatches] = useState(true);
  const [loadingMoreMatches, setLoadingMoreMatches] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`/api/rules/${id}`),
        fetch(`/api/rules/${id}/matches?limit=${MATCH_PAGE}&offset=0`),
        fetch(`/api/rules/${id}/examples`),
      ]);
      if (r1.ok) {
        const j = (await r1.json()) as { rule: Rule; recipients: Recipient[] };
        setRule(j.rule);
        setRecipients(j.recipients ?? []);
        setName(j.rule.name);
        setDesc(j.rule.description);
        setFormat(j.rule.forwardFormat ?? "");
        setRequestTrigger(j.rule.requestTrigger ?? "");
        setRequestWindow(j.rule.requestWindowSeconds);
      }
      if (r2.ok) {
        const j = (await r2.json()) as { matches: Match[] };
        setMatches(j.matches ?? []);
        setHasMoreMatches((j.matches ?? []).length === MATCH_PAGE);
      }
      if (r3.ok) {
        const j = (await r3.json()) as { examples: Example[] };
        setExamples(j.examples ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMoreMatches = useCallback(async () => {
    if (loadingMoreMatches || !hasMoreMatches) return;
    setLoadingMoreMatches(true);
    try {
      const r = await fetch(
        `/api/rules/${id}/matches?limit=${MATCH_PAGE}&offset=${matches.length}`,
      );
      if (r.ok) {
        const j = (await r.json()) as { matches: Match[] };
        setMatches((prev) => [...prev, ...(j.matches ?? [])]);
        setHasMoreMatches((j.matches ?? []).length === MATCH_PAGE);
      }
    } finally {
      setLoadingMoreMatches(false);
    }
  }, [id, matches.length, hasMoreMatches, loadingMoreMatches]);

  const matchSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = matchSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreMatches();
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMoreMatches]);

  const forceSend = useCallback(
    async (matchId: number) => {
      const r = await fetch(
        `/api/rules/${id}/matches/${matchId}/force-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (r.ok) load();
    },
    [id, load],
  );

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: desc,
          forwardFormat: format || null,
          requestTrigger: requestTrigger || null,
          requestWindowSeconds: requestWindow,
        }),
      });
      load();
    } finally {
      setSaving(false);
    }
  }, [id, name, desc, format, requestTrigger, requestWindow, load]);

  const remove = useCallback(async () => {
    if (!confirm("این rule پاک بشه؟")) return;
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    window.location.href = "/rules";
  }, [id]);

  const addRecipient = useCallback(async () => {
    const chatId = Number(newChat);
    if (!Number.isFinite(chatId) || chatId === 0) return;
    await fetch(`/api/rules/${id}/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientChatId: chatId,
        recipientLabel: newLabel || undefined,
      }),
    });
    setNewChat("");
    setNewLabel("");
    load();
  }, [id, newChat, newLabel, load]);

  const [testStatus, setTestStatus] = useState<Record<number, string>>({});
  const testRecipient = useCallback(
    async (chatId: number) => {
      setTestStatus((s) => ({ ...s, [chatId]: "⏳ در حال تست…" }));
      try {
        const r = await fetch(`/api/rules/${id}/recipients/test-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          sentMessageId?: number;
          botUsername?: string;
          botId?: number;
          destChatId?: number;
          destChatType?: string;
          destChatTitle?: string | null;
          destFirstName?: string | null;
          destLastName?: string | null;
          destUsername?: string | null;
          isSelfSend?: boolean;
          warning?: string | null;
          error?: string;
        };
        if (j.ok) {
          // The label MUST show "to chat_id" not "to @bot" — the bot is
          // the SENDER. Earlier UI confusingly read "ارسال شد به @bot".
          // Surface the destination person/group identity so the
          // operator can spot wrong-id mistakes (e.g. accidentally
          // forwarding to themselves).
          const fullName = [j.destFirstName, j.destLastName]
            .filter(Boolean)
            .join(" ")
            .trim();
          const destName =
            j.destChatTitle ||
            fullName ||
            j.destUsername ||
            `chat ${j.destChatId ?? chatId}`;
          const handle = j.destUsername ? ` (@${j.destUsername})` : "";
          const meta = `${j.destChatType ?? "?"} · msg=${j.sentMessageId}`;
          const warn = j.warning ? `\n⚠ ${j.warning}` : "";
          setTestStatus((s) => ({
            ...s,
            [chatId]: `✓ از @${j.botUsername} → ${destName}${handle} (${meta})${warn}`,
          }));
        } else {
          setTestStatus((s) => ({
            ...s,
            [chatId]: `✗ ${j.error ?? "خطای نامشخص"}`,
          }));
        }
      } catch (e) {
        setTestStatus((s) => ({
          ...s,
          [chatId]: `✗ ${e instanceof Error ? e.message : String(e)}`,
        }));
      }
    },
    [id],
  );

  const removeRecipient = useCallback(
    async (chatId: number) => {
      await fetch(
        `/api/rules/${id}/recipients?recipientChatId=${chatId}`,
        { method: "DELETE" },
      );
      load();
    },
    [id, load],
  );

  const addExample = useCallback(async () => {
    if (!newExampleText.trim()) return;
    await fetch(`/api/rules/${id}/examples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: newExampleText,
        label: newExampleLabel || undefined,
      }),
    });
    setNewExampleText("");
    setNewExampleLabel("");
    load();
  }, [id, newExampleText, newExampleLabel, load]);

  const removeExample = useCallback(
    async (exampleId: number) => {
      await fetch(`/api/rules/${id}/examples?exampleId=${exampleId}`, {
        method: "DELETE",
      });
      load();
    },
    [id, load],
  );

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResults(null);
    try {
      const r = await fetch(`/api/rules/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: testLimit }),
      });
      if (r.ok) {
        const j = (await r.json()) as { results: TestResult[] };
        setTestResults(j.results ?? []);
      }
    } finally {
      setTesting(false);
    }
  }, [id, testLimit]);

  if (loading) {
    return (
      <Shell>
        <Card>Loading…</Card>
      </Shell>
    );
  }
  if (!rule) {
    return (
      <Shell>
        <Card>
          <p>Rule پیدا نشد.</p>
          <Link href="/rules" className="text-xs underline">
            برگشت
          </Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageTitle
        title={`📐 ${rule.name}`}
        subtitle={`ساخته شده ${relTime(rule.createdAt)} · last update ${relTime(rule.updatedAt)}`}
        actions={
          <Link href="/rules" className="text-xs underline-offset-2 underline">
            ← rules
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">تعریف rule</div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسم rule"
            className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="توصیف اصلی: چه پیام‌هایی باید match بشن؟"
            rows={3}
            className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
          />
          <textarea
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder="(اختیاری) format فوروارد — مثلاً «فقط عدد کد رو با emoji 🔑 بفرست» — خالی = پیام اصلی"
            rows={2}
            className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
          />
          <div className="pt-2 border-t border-[var(--color-border)] mt-1">
            <div className="text-[11px] font-medium mb-1">
              ⏸ Gate درخواست (اختیاری)
            </div>
            <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
              اگه ست شد، پیام‌های منطبق <i>فقط</i> وقتی فوروارد می‌شن که
              گیرنده تو پنجره‌ی زمانی پایین یه پیامی بفرسته که با این توصیف
              جور دربیاد (مثلاً «میشه کد رو بخونی؟»). پیام‌های match‌شده تو
              همون پنجره قبل از درخواست هم بعد از درخواست ارسال می‌شن
              (با تلرانس زمانی).
            </p>
            <textarea
              value={requestTrigger}
              onChange={(e) => setRequestTrigger(e.target.value)}
              placeholder="توصیف درخواست — مثلاً «پیامی که می‌پرسه کد رو برام بفرست یا میخواد کد تایید رو بدونه»"
              rows={2}
              className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 mb-2"
            />
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[var(--color-text-dim)]">پنجره:</span>
              <select
                value={requestWindow ?? ""}
                onChange={(e) =>
                  setRequestWindow(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                {WINDOW_OPTIONS.map((o) => (
                  <option
                    key={o.value ?? "always"}
                    value={o.value ?? ""}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={remove}
              className="text-xs px-3 py-1.5 rounded-md border border-red-700 text-red-300 hover:bg-red-900/30"
            >
              🗑 پاک کن
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              {saving ? "ذخیره…" : "ذخیره"}
            </button>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium">
            📋 نمونه‌های اضافی ({examples.length}) — match وقتی اتفاق می‌افته
            که پیام به <i>هر کدوم</i> از این‌ها (یا توصیف اصلی بالا) بخوره
          </div>
        </div>
        {examples.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)] mb-2">
            هنوز نمونه‌ای اضافه نشده. می‌تونی متن یه پیام واقعی رو پیست کنی
            تا rule بفهمه «این مدل پیام‌ها رو هم بگیر».
          </p>
        ) : (
          <div className="flex flex-col gap-1 mb-3">
            {examples.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-2 p-2 rounded-md bg-[var(--color-surface-2)] text-xs"
              >
                <div className="flex-1 min-w-0">
                  {e.label && (
                    <div className="text-[10px] text-[var(--color-text-dim)] mb-0.5">
                      {e.label}
                    </div>
                  )}
                  <div
                    dir="auto"
                    style={{ unicodeBidi: "plaintext" }}
                    className="whitespace-pre-wrap break-words"
                  >
                    {truncate(e.text, 400)}
                  </div>
                </div>
                <button
                  onClick={() => removeExample(e.id)}
                  className="text-[10px] text-red-300 hover:text-red-200 shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <textarea
            value={newExampleText}
            onChange={(e) => setNewExampleText(e.target.value)}
            placeholder="متن یه نمونه پیام (مثلاً پیام OTP واقعی رو پیست کن)"
            rows={2}
            className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newExampleLabel}
              onChange={(e) => setNewExampleLabel(e.target.value)}
              placeholder="label (اختیاری)"
              className="flex-1 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
            />
            <button
              onClick={addExample}
              disabled={!newExampleText.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              + اضافه کن
            </button>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">
          📬 گیرنده‌های فوروارد ({recipients.length})
        </div>
        <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
          chat_id کاربر (مثبت) یا گروه/کانال (منفی). گیرنده باید قبلاً به بات
          /start زده باشه یا بات تو گروه/کانال عضو باشه.
        </p>
        {recipients.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)] mb-3">
            هیچ گیرنده‌ای ست نشده — پیام‌های match‌شده فقط لاگ می‌شن.
          </p>
        ) : (
          <div className="flex flex-col gap-1 mb-3">
            {recipients.map((r) => (
              <div
                key={r.recipientChatId}
                className="flex items-center gap-2 p-2 rounded-md bg-[var(--color-surface-2)] text-xs"
              >
                <span className="flex-1 tabular-nums">
                  {r.recipientLabel ? (
                    <>
                      <strong>{r.recipientLabel}</strong>{" "}
                      <span className="text-[var(--color-text-dim)]">
                        ({r.recipientChatId})
                      </span>
                    </>
                  ) : (
                    r.recipientChatId
                  )}
                  {testStatus[r.recipientChatId] && (
                    <span
                      className={`ml-2 text-[10px] ${
                        testStatus[r.recipientChatId]?.startsWith("✓")
                          ? "text-emerald-300"
                          : "text-red-300"
                      }`}
                    >
                      {testStatus[r.recipientChatId]}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => testRecipient(r.recipientChatId)}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                  title="یه پیام تست از bot بفرست — اگه واقعاً برسه، در دسترس بودن chat تایید می‌شه"
                >
                  🧪 تست
                </button>
                <button
                  onClick={() => removeRecipient(r.recipientChatId)}
                  className="text-[10px] text-red-300 hover:text-red-200"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <input
            type="number"
            value={newChat}
            onChange={(e) => setNewChat(e.target.value)}
            placeholder="chat_id"
            className="flex-1 min-w-[140px] text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
          />
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="label (اختیاری)"
            className="flex-1 min-w-[140px] text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-1.5"
          />
          <button
            onClick={addRecipient}
            disabled={!newChat}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            + اضافه
          </button>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-xs font-medium">🧪 تست روی پیام‌های قبلی</div>
          <div className="flex items-center gap-2">
            <select
              value={testLimit}
              onChange={(e) => setTestLimit(Number(e.target.value))}
              className="text-xs px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]"
            >
              <option value={10}>۱۰ پیام</option>
              <option value={30}>۳۰ پیام</option>
              <option value={50}>۵۰ پیام</option>
              <option value={100}>۱۰۰ پیام</option>
            </select>
            <button
              onClick={runTest}
              disabled={testing}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {testing ? "تست…" : "▶ run"}
            </button>
          </div>
        </div>
        {testResults && (
          <>
            <div className="text-[11px] text-[var(--color-text-dim)] mb-2">
              {testResults.filter((r) => r.matched).length} از{" "}
              {testResults.length} پیام match شد.
              {testResults.filter((r) => r.matched).length === 0 &&
                " — هیچی match نشد، rule رو ویرایش کن یا نمونه‌ی بیشتر اضافه کن."}
            </div>
            <div className="flex flex-col gap-1">
              {testResults
                .filter((r) => r.matched)
                .map((r) => (
                <div
                  key={r.messageLogId}
                  className="p-2 rounded-md text-xs border border-emerald-700 bg-emerald-900/20"
                >
                  <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-dim)] mb-1">
                    <Badge tone="success">match</Badge>
                    <span>
                      {r.senderName} ·{" "}
                      {r.chatTitle ?? `chat ${r.chatId}`} ·{" "}
                      {relTime(r.createdAt)}
                    </span>
                  </div>
                  <div
                    dir="auto"
                    style={{ unicodeBidi: "plaintext" }}
                    className="whitespace-pre-wrap break-words"
                  >
                    {truncate(r.originalText, 300)}
                  </div>
                  {r.formattedText && (
                    <div className="mt-2 pt-2 border-t border-emerald-700/40">
                      <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                        خروجی format شده:
                      </div>
                      <div
                        dir="auto"
                        style={{ unicodeBidi: "plaintext" }}
                        className="whitespace-pre-wrap break-words"
                      >
                        {r.formattedText}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card>
        <div className="text-xs font-medium mb-2">
          🕐 تاریخچه match ({matches.length})
        </div>
        {matches.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)]">
            هنوز هیچ پیامی به این rule نخورده.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              {matches.map((m) => {
                const deliveredSet = new Set(m.forwardedTo);
                const rowsByRecipient = recipients.map((r) => {
                  const got = deliveredSet.has(r.recipientChatId);
                  const err =
                    m.forwardErrors?.[String(r.recipientChatId)] ?? null;
                  return {
                    recipientChatId: r.recipientChatId,
                    label: r.recipientLabel,
                    got,
                    err,
                  };
                });
                const allDelivered = rowsByRecipient.every((r) => r.got);
                const noneDelivered = rowsByRecipient.every((r) => !r.got);
                const someFailed = rowsByRecipient.some(
                  (r) => !r.got && r.err,
                );
                return (
                  <div
                    key={m.id}
                    className="p-2 rounded-md bg-[var(--color-surface-2)] text-xs"
                  >
                    <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--color-text-dim)] mb-1">
                      <span>{m.senderName}</span>
                      <span>·</span>
                      <span>{relTime(m.matchedAt)}</span>
                      <span>·</span>
                      {allDelivered ? (
                        <Badge tone="success">
                          ✓ همه گرفتن ({m.forwardedTo.length}/
                          {recipients.length})
                        </Badge>
                      ) : noneDelivered && !someFailed ? (
                        <Badge tone="warn">⏸ نگه‌داشته (gate)</Badge>
                      ) : someFailed ? (
                        <Badge tone="danger">
                          ✗ ناقص ({m.forwardedTo.length}/{recipients.length})
                        </Badge>
                      ) : (
                        <Badge tone="info">
                          ↗ {m.forwardedTo.length}/{recipients.length}
                        </Badge>
                      )}
                    </div>
                    {rowsByRecipient.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {rowsByRecipient.map((r) => (
                          <span
                            key={r.recipientChatId}
                            title={r.err ?? undefined}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                              r.got
                                ? "bg-emerald-900/40 text-emerald-200"
                                : r.err
                                  ? "bg-red-900/40 text-red-200"
                                  : "bg-[var(--color-surface)] text-[var(--color-text-dim)]"
                            }`}
                          >
                            {r.got ? "✓" : r.err ? "✗" : "⏸"}{" "}
                            {r.label
                              ? `${r.label}`
                              : String(r.recipientChatId)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      dir="auto"
                      style={{ unicodeBidi: "plaintext" }}
                      className="whitespace-pre-wrap break-words"
                    >
                      {truncate(m.messageText, 200)}
                    </div>
                    {m.formattedText && (
                      <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                        <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                          خروجی format شده:
                        </div>
                        <div
                          dir="auto"
                          style={{ unicodeBidi: "plaintext" }}
                          className="whitespace-pre-wrap break-words"
                        >
                          {m.formattedText}
                        </div>
                      </div>
                    )}
                    {!allDelivered && (
                      <div className="mt-2">
                        <button
                          onClick={() => forceSend(m.id)}
                          className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                        >
                          🚀 ارسال اجباری به نگرفته‌ها
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {hasMoreMatches && (
              <div
                ref={matchSentinelRef}
                className="text-center text-[11px] text-[var(--color-text-dim)] py-3"
              >
                {loadingMoreMatches
                  ? "در حال بارگذاری بیشتر…"
                  : "اسکرول کن تا بقیه بیاد"}
              </div>
            )}
            {!hasMoreMatches && matches.length > MATCH_PAGE && (
              <div className="text-center text-[10px] text-[var(--color-text-dim)] py-3">
                · پایان لیست ({matches.length} match) ·
              </div>
            )}
          </>
        )}
      </Card>
    </Shell>
  );
}
