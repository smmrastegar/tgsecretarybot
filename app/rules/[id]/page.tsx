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
  sourceChatIds: number[] | null;
  matchAllFromSource: boolean;
  showRulePrefix: boolean;
  formatAsOtp: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const WINDOW_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "⚠️ بدون gate — ارسال فوری" },
  { value: 60, label: "۱ دقیقه" },
  { value: 120, label: "۲ دقیقه" },
  { value: 300, label: "۵ دقیقه" },
  { value: 3600, label: "۱ ساعت" },
];
type Recipient = {
  ruleId: number;
  recipientChatId: number;
  recipientLabel: string | null;
  paused: boolean;
  createdAt: string;
};
type Example = {
  id: number;
  text: string;
  label: string | null;
  purpose?: "rule_match" | "gate_match";
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
  const [gateExamples, setGateExamples] = useState<Example[]>([]);
  const [negExamples, setNegExamples] = useState<Example[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // edit form
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [format, setFormat] = useState("");
  const [requestTrigger, setRequestTrigger] = useState("");
  const [requestWindow, setRequestWindow] = useState<number | null>(null);
  const [sourceChats, setSourceChats] = useState("");
  const [matchAllFromSource, setMatchAllFromSource] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [variationStatus, setVariationStatus] = useState<string | null>(null);
  const [showRulePrefix, setShowRulePrefix] = useState(true);
  const [formatAsOtp, setFormatAsOtp] = useState(false);

  // recipient form
  const [newChat, setNewChat] = useState("");
  const [newLabel, setNewLabel] = useState("");

  // test
  const [testLimit, setTestLimit] = useState(30);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const MATCH_PAGE = 10;
  const [matchFilter, setMatchFilter] = useState<
    "active" | "partial" | "done" | "expired"
  >("active");
  const [hasMoreMatches, setHasMoreMatches] = useState(true);
  const [loadingMoreMatches, setLoadingMoreMatches] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    try {
      const [r1, r2, r3, r4, r5] = await Promise.all([
        fetch(`/api/rules/${id}`),
        fetch(`/api/rules/${id}/matches?limit=${MATCH_PAGE}&offset=0`),
        fetch(`/api/rules/${id}/examples?purpose=rule_match`),
        fetch(`/api/rules/${id}/examples?purpose=gate_match`),
        fetch(`/api/rules/${id}/examples?purpose=negative_match`),
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
        setSourceChats((j.rule.sourceChatIds ?? []).join(", "));
        setMatchAllFromSource(!!j.rule.matchAllFromSource);
        setShowRulePrefix(j.rule.showRulePrefix !== false);
        setFormatAsOtp(!!j.rule.formatAsOtp);
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
      if (r4.ok) {
        const j = (await r4.json()) as { examples: Example[] };
        setGateExamples(j.examples ?? []);
      }
      if (r5.ok) {
        const j = (await r5.json()) as { examples: Example[] };
        setNegExamples(j.examples ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMoreMatches = useCallback(async () => {
    if (loadingMoreMatches || !hasMoreMatches) return;
    setLoadingMoreMatches(true);
    setMatchesError(null);
    try {
      const r = await fetch(
        `/api/rules/${id}/matches?limit=${MATCH_PAGE}&offset=${matches.length}`,
      );
      if (!r.ok) {
        setMatchesError(`خطا ${r.status} — برای retry دکمه رو بزن`);
        return;
      }
      const j = (await r.json()) as { matches: Match[] };
      setMatches((prev) => [...prev, ...(j.matches ?? [])]);
      setHasMoreMatches((j.matches ?? []).length === MATCH_PAGE);
    } catch (e) {
      setMatchesError(e instanceof Error ? e.message : String(e));
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

  const [forceStatus, setForceStatus] = useState<{
    matchId: number;
    msg: string;
    ok: boolean;
  } | null>(null);

  const forceSend = useCallback(
    async (matchId: number) => {
      setForceStatus(null);
      try {
        const r = await fetch(
          `/api/rules/${id}/matches/${matchId}/force-send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        const j = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          delivered?: number;
          failed?: number;
          error?: string;
          note?: string;
        };
        if (r.ok && j.ok) {
          setForceStatus({
            matchId,
            ok: true,
            msg:
              j.note ??
              `✅ ${j.delivered ?? 0} ارسال شد${j.failed ? ` · ${j.failed} ناموفق` : ""}`,
          });
          load();
        } else {
          setForceStatus({
            matchId,
            ok: false,
            msg: `❌ ${j.error ?? `HTTP ${r.status}`}`,
          });
        }
      } catch (e) {
        setForceStatus({
          matchId,
          ok: false,
          msg: `❌ ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        setTimeout(() => setForceStatus(null), 9000);
      }
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
          sourceChatIds: sourceChats || null,
          matchAllFromSource,
          showRulePrefix,
          formatAsOtp,
        }),
      });
      load();
    } finally {
      setSaving(false);
    }
  }, [
    id,
    name,
    desc,
    format,
    requestTrigger,
    requestWindow,
    sourceChats,
    matchAllFromSource,
    showRulePrefix,
    formatAsOtp,
    load,
  ]);

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

  const setRecipientPaused = useCallback(
    async (chatId: number, paused: boolean) => {
      await fetch(`/api/rules/${id}/recipients`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientChatId: chatId, paused }),
      });
      load();
    },
    [id, load],
  );

  // Manual test/execute: run the real matcher on typed input; forward if
  // it matches.
  const [simText, setSimText] = useState("");
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState<string | null>(null);
  const runSimulate = useCallback(async () => {
    if (!simText.trim()) return;
    setSimBusy(true);
    setSimResult(null);
    try {
      const r = await fetch(`/api/rules/${id}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: simText }),
      });
      const j = (await r.json()) as {
        matched?: boolean;
        delivered?: Array<{ chatId: number; label: string | null }>;
        failures?: Array<{ chatId: number; error: string }>;
        note?: string;
        error?: string;
      };
      if (!r.ok) setSimResult(`❌ ${j.error ?? `HTTP ${r.status}`}`);
      else if (!j.matched) setSimResult("⚪️ match نشد — این rule این پیام رو نمی‌گیره.");
      else {
        const d = (j.delivered ?? [])
          .map((x) => x.label || x.chatId)
          .join("، ");
        const f = (j.failures ?? []).length;
        setSimResult(
          `✅ match شد و اجرا شد${d ? ` → ارسال به: ${d}` : ""}${
            f ? ` · ${f} ناموفق` : ""
          }${j.note ? ` · ${j.note}` : ""}`,
        );
        load();
      }
    } catch (e) {
      setSimResult(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSimBusy(false);
    }
  }, [id, simText, load]);

  const generateVariations = useCallback(async () => {
    if (!requestTrigger.trim()) return;
    setGenerating(true);
    setVariationStatus(null);
    try {
      const r = await fetch(`/api/rules/${id}/generate-variations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: requestTrigger, mode: "replace" }),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          variations: string[];
          inserted: number[];
          replaced: number[];
          cleanedMisplaced: number[];
        };
        const cleanup =
          j.cleanedMisplaced.length > 0
            ? ` · ${j.cleanedMisplaced.length} نمونه اشتباه قبلی از rule examples پاک شد`
            : "";
        const replaced =
          j.replaced.length > 0
            ? ` · ${j.replaced.length} نمونه قبلی Gate جایگزین شد`
            : "";
        setVariationStatus(
          `✅ ${j.inserted.length} نمونه Gate ساخته شد${replaced}${cleanup}`,
        );
        load();
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setVariationStatus(`❌ ${j.error ?? `HTTP ${r.status}`}`);
      }
    } catch (e) {
      setVariationStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
      setTimeout(() => setVariationStatus(null), 8000);
    }
  }, [id, requestTrigger, load]);

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

  const matchPastWindow = (m: Match): boolean => {
    const windowMs = (rule.requestWindowSeconds ?? 0) * 1000;
    const ageMs = Date.now() - new Date(m.matchedAt).getTime();
    return windowMs > 0 && ageMs > windowMs;
  };
  // Four mutually-exclusive states:
  //  done    → every recipient got it (historical; can't re-run)
  //  partial → SOME got it but not all (the delivered went; the rest
  //            won't once the window passes)
  //  active  → nobody got it yet, still inside the window (pending — the
  //            only ones that can still fire on their own)
  //  expired → nobody got it AND past the window (fully dead)
  const matchStatus = (m: Match): "active" | "done" | "partial" | "expired" => {
    const deliveredSet = new Set(m.forwardedTo);
    const got = recipients.filter((r) => deliveredSet.has(r.recipientChatId)).length;
    if (recipients.length > 0 && got === recipients.length) return "done";
    if (got > 0) return "partial";
    return matchPastWindow(m) ? "expired" : "active";
  };
  const activeMatches = matches.filter((m) => matchStatus(m) === "active");
  const partialMatches = matches.filter((m) => matchStatus(m) === "partial");
  const doneMatches = matches.filter((m) => matchStatus(m) === "done");
  const expiredMatches = matches.filter((m) => matchStatus(m) === "expired");
  const visibleMatches =
    matchFilter === "expired"
      ? expiredMatches
      : matchFilter === "done"
        ? doneMatches
        : matchFilter === "partial"
          ? partialMatches
          : activeMatches;

  return (
    <Shell>
      <PageTitle
        title={`📐 ${rule.name}`}
        subtitle={`ساخته شده ${relTime(rule.createdAt)} · آخرین ویرایش ${relTime(rule.updatedAt)}`}
        actions={
          <Link href="/rules" className="text-xs underline-offset-2 underline">
            ← rules
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="text-xs font-medium mb-3">🔗 این rule به کجا وصله؟</div>
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          <div className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
            <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
              📥 می‌شنوه از
            </div>
            {rule.sourceChatIds && rule.sourceChatIds.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {rule.sourceChatIds.map((cid) => (
                  <span
                    key={cid}
                    dir="ltr"
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[10px] tabular-nums"
                  >
                    {cid}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-amber-300">
                همه‌ی چت‌ها (بدون محدودیت مبدأ)
              </div>
            )}
          </div>
          <div className="hidden sm:flex items-center text-[var(--color-text-dim)]">
            ←
          </div>
          <div className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
            <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
              📤 می‌فرسته به ({recipients.length})
            </div>
            {recipients.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {recipients.map((r) => (
                  <span
                    key={r.recipientChatId}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                      r.paused
                        ? "bg-amber-500/10 text-amber-200 line-through"
                        : "bg-[var(--color-surface)]"
                    }`}
                  >
                    {r.paused && <span className="no-underline">⏸</span>}
                    <span>{r.recipientLabel || "بدون‌نام"}</span>
                    <span dir="ltr" className="text-[var(--color-text-dim)] tabular-nums">
                      {r.recipientChatId}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--color-text-dim)]">
                هیچ گیرنده‌ای — پیام‌های match‌شده فقط لاگ می‌شن، جایی فرستاده
                نمی‌شن.
              </div>
            )}
          </div>
        </div>
      </Card>

      {(() => {
        const gateActive =
          requestWindow != null &&
          requestWindow > 0 &&
          (requestTrigger.trim().length > 0 || gateExamples.length > 0);
        return (
          <div
            className={`mb-4 p-3 rounded-md border text-xs leading-relaxed ${
              gateActive
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
                : "bg-rose-500/10 border-rose-500/40 text-rose-200"
            }`}
          >
            {gateActive ? (
              <>
                🔒 <b>گیت فعاله.</b> پیام‌های match‌شده نگه داشته می‌شن و فقط
                وقتی گیرنده خودش درخواست بده (تو پنجره‌ی{" "}
                {requestWindow === 3600
                  ? "۱ ساعته"
                  : `${Math.round((requestWindow ?? 0) / 60)} دقیقه‌ای`}
                ) ارسال می‌شن. هر درخواست فقط <b>یک</b> پیام آزاد می‌کنه.
              </>
            ) : (
              <>
                🔓 <b>گیت غیرفعاله — هر پیامِ match‌شده فوراً به همه‌ی
                گیرنده‌ها فوروارد می‌شه.</b> برای فعال‌کردن گیت، هم پنجره‌ی
                زمانی رو ست کن هم توصیف درخواست (یا نمونه‌های Gate) رو.
              </>
            )}
            {!sourceChats.trim() && (
              <div className="mt-1.5 text-amber-200">
                ⚠️ محدودیت چت مبدأ ست نشده — پیام <b>هر</b> چتی می‌تونه match
                بشه. برای دقت، پایین chat_id مبدأ (مثلاً چت پیامک بانک) رو
                وارد کن.
              </div>
            )}
          </div>
        );
      })()}

      <Card className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs font-medium">✏️ اسم rule</div>
          <div className="flex gap-2">
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
              {saving ? "ذخیره…" : "💾 ذخیره"}
            </button>
          </div>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم rule"
          className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
        />
        <p className="text-[10px] text-[var(--color-text-dim)] mt-2 leading-relaxed">
          🧠 این rule <b>با نمونه</b> کار می‌کنه: پایین نمونه‌ی پیام‌هایی که باید
          بگیره رو بده (یا با «🤖 بساز» چندتا بساز). هرچی بیشتر بدی دقیق‌تر می‌شه؛
          هر پیامی که مثل نمونه‌هات باشه match می‌شه — حتی همون پیامی که ازش
          نمونه ساختی. اگه چیزی رو اشتباه گرفت، به «نمونه‌های منفی» اضافه‌اش کن.
          تنظیمات فوروارد، گیت و مبدأ پایین‌ترن.
        </p>
      </Card>

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">
          ✅ نمونه‌های مثبت ({examples.length}) — این‌ها و هر پیامِ شبیهشون match
          می‌شن
        </div>
        {examples.length === 0 && (
          <p className="text-xs text-amber-300/90 mb-2">
            ⚠️ هنوز نمونه‌ای نداری — این rule هیچی نمی‌گیره. یه پیام واقعی که
            باید بگیره اضافه کن (یا با «🤖 بساز» بساز) و ذخیره بزن.
          </p>
        )}
        <ExampleEditor
          ruleId={id}
          items={examples}
          purpose="rule_match"
          tone="pos"
          placeholder="متن یه نمونه پیام که باید match بشه…"
          aiGenerate
          onSaved={load}
        />
      </Card>

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">
          🚫 نمونه‌های منفی ({negExamples.length}) — این‌ها <i>نباید</i> match
          بشن
        </div>
        <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
          اگه rule داره چیزی رو اشتباه می‌گیره، متنِ همون پیامِ اشتباه رو
          اینجا اضافه کن و ذخیره بزن — دیگه پیام‌های شبیهش رو نمی‌گیره.
        </p>
        <ExampleEditor
          ruleId={id}
          items={negExamples}
          purpose="negative_match"
          tone="neg"
          placeholder="متن یه پیامی که اشتباه match شده (مثلاً رزرو/بلیط یا OTP)"
          onSaved={load}
        />
      </Card>

      <Card className="mb-4">
        <div className="text-xs font-medium mb-1">📝 توصیف (اختیاری)</div>
        <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
          فقط وقتی به کار می‌آد که <b>هیچ نمونه‌ی مثبتی نداری</b> — اون‌وقت rule
          از روی این توصیف با AI تصمیم می‌گیره. اگه نمونه داری، این نادیده
          گرفته می‌شه. (با دکمه‌ی «ذخیره تنظیمات» پایین ذخیره می‌شه.)
        </p>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="مثلاً «پیام‌هایی که خبر ارز دیجیتال دارن»"
          rows={2}
          className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
        />
      </Card>

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">
          ▶️ تست/اجرای دستی — یه پیام بده، اگه match شد واقعاً اجرا می‌شه
        </div>
        <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
          دقیقاً مثل یه پیام ورودی با این rule سنجیده می‌شه. اگه match بشه،
          <b> واقعاً به گیرنده‌های فعال فوروارد می‌شه</b> (گیت رد می‌شه چون
          دستیه؛ گیرنده‌های متوقف‌شده رد می‌شن).
        </p>
        <div className="flex gap-2">
          <textarea
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            placeholder="متن پیام تستی…"
            rows={2}
            className="flex-1 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
          />
          <button
            onClick={runSimulate}
            disabled={simBusy || !simText.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50 self-start"
          >
            {simBusy ? "…" : "▶️ اجرا"}
          </button>
        </div>
        {simResult && (
          <div className="text-[11px] mt-2 p-2 rounded-md bg-[var(--color-surface-2)] leading-relaxed">
            {simResult}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <div className="text-xs font-medium mb-3">⚙️ تنظیمات فوروارد و گیت</div>
        <div className="flex flex-col gap-3">
          {/* how the forwarded message looks */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={formatAsOtp}
                onChange={(e) => setFormatAsOtp(e.target.checked)}
              />
              <span>
                🔑 <b>حالت OTP</b> — کد رو از متن استخراج کن و به‌صورت
                <code className="mx-1 px-1 bg-[var(--color-surface-2)] rounded">tap-to-copy</code>
                بفرست.
              </span>
            </label>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={showRulePrefix}
                onChange={(e) => setShowRulePrefix(e.target.checked)}
              />
              <span>🏷 prefix اول پیام بیاد («[rule: …] · از …»).</span>
            </label>
            <textarea
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="(اختیاری) format فوروارد — مثلاً «فقط عدد کد رو با emoji 🔑 بفرست» — خالی = پیام اصلی"
              rows={2}
              disabled={formatAsOtp}
              className="text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 disabled:opacity-50"
            />
          </div>

          {/* source scope */}
          <div className="pt-2 border-t border-[var(--color-border)]">
            <div className="text-[11px] font-medium mb-1">🎯 محدودیت مبدأ</div>
            <input
              type="text"
              dir="ltr"
              value={sourceChats}
              onChange={(e) => setSourceChats(e.target.value)}
              placeholder="فقط از این چت‌ها (chat_id با کاما) — خالی = همه چت‌ها"
              className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
            />
            <label className="flex items-center gap-2 text-[11px] cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={matchAllFromSource}
                disabled={!sourceChats.trim()}
                onChange={(e) => setMatchAllFromSource(e.target.checked)}
              />
              <span className={!sourceChats.trim() ? "opacity-50" : ""}>
                📩 <b>هر پیامی از این چت‌ها رو بگیر</b> (بدون بررسی نمونه). برای
                فیدهای اختصاصی مثل پیامک بانک. تو حالت OTP، پیام‌های بدون کد رد
                می‌شن.
              </span>
            </label>
          </div>

          {/* request gate */}
          <div className="pt-2 border-t border-[var(--color-border)]">
            <div className="text-[11px] font-medium mb-1">⏸ گیت درخواست (اختیاری)</div>
            <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
              اگه ست شد، پیام‌های منطبق فقط وقتی فوروارد می‌شن که گیرنده تو
              پنجره‌ی زمانی یه پیامی بفرسته که با این توصیف یا نمونه‌های زیر بخوره.
            </p>
            <textarea
              value={requestTrigger}
              onChange={(e) => setRequestTrigger(e.target.value)}
              placeholder="توصیف درخواست — مثلاً «کد رو برام بفرست»"
              rows={2}
              className="w-full text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 mb-2"
            />
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <button
                onClick={generateVariations}
                disabled={generating || !requestTrigger.trim()}
                className="text-[11px] px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/40 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                title="با AI پاراف‌رازهای متن بالا رو به‌عنوان نمونه‌ی گیت ذخیره کن"
              >
                {generating ? "..." : "🤖 ساخت نمونه‌های گیت با AI"}
              </button>
              {variationStatus && (
                <span className="text-[10px] text-[var(--color-text-dim)]">{variationStatus}</span>
              )}
            </div>
            {gateExamples.length > 0 && (
              <div className="mb-2 flex flex-col gap-1">
                {gateExamples.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-start gap-2 p-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 text-xs"
                  >
                    <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="flex-1 min-w-0 break-words">
                      {g.text}
                    </div>
                    <button
                      onClick={async () => {
                        await fetch(`/api/rules/${id}/examples?exampleId=${g.id}`, { method: "DELETE" });
                        load();
                      }}
                      className="text-[10px] text-red-300 hover:text-red-200 shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[var(--color-text-dim)]">پنجره:</span>
              <select
                value={requestWindow ?? ""}
                onChange={(e) => setRequestWindow(e.target.value === "" ? null : Number(e.target.value))}
                className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                {WINDOW_OPTIONS.map((o) => (
                  <option key={o.value ?? "always"} value={o.value ?? ""}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              {saving ? "ذخیره…" : "💾 ذخیره تنظیمات"}
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
                className={`flex items-center gap-2 p-2 rounded-md text-xs ${
                  r.paused
                    ? "bg-amber-500/5 border border-amber-500/30"
                    : "bg-[var(--color-surface-2)]"
                }`}
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
                  {r.paused && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                      ⏸ متوقف
                    </span>
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
                  onClick={() => setRecipientPaused(r.recipientChatId, !r.paused)}
                  className={`text-[10px] px-2 py-0.5 rounded-md border ${
                    r.paused
                      ? "border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10"
                      : "border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                  }`}
                  title={r.paused ? "ادامه‌ی ارسال به این گیرنده" : "توقف موقت ارسال به این گیرنده (بدون حذف)"}
                >
                  {r.paused ? "▶️ ادامه" : "⏸ توقف"}
                </button>
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
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-xs font-medium">🕐 تاریخچه تطبیق‌ها</div>
          <div className="flex gap-1.5 flex-wrap">
            {([
              { key: "active", label: `🟢 فعال (${activeMatches.length})` },
              { key: "partial", label: `⚠️ ناقص (${partialMatches.length})` },
              { key: "done", label: `✓ انجام‌شده (${doneMatches.length})` },
              { key: "expired", label: `⌛ منقضی (${expiredMatches.length})` },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setMatchFilter(t.key)}
                className={`text-[11px] px-2.5 py-1 rounded-md border ${
                  matchFilter === t.key
                    ? "bg-[var(--color-accent)] text-white border-transparent"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {matches.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)]">
            هنوز هیچ پیامی به این rule نخورده.
          </p>
        ) : visibleMatches.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)]">
            {matchFilter === "expired"
              ? "هیچ تطبیق منقضی‌ای نیست."
              : matchFilter === "partial"
                ? "هیچ تطبیق ناقصی نیست."
                : matchFilter === "done"
                  ? "هنوز چیزی کامل تحویل نشده."
                  : "تطبیق فعالی نیست — چیزی در حال انتظارِ ارسال نیست. تب‌های دیگه رو ببین."}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              {visibleMatches.map((m) => {
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
                const total = rowsByRecipient.length;
                const gotCount = rowsByRecipient.filter((r) => r.got).length;
                const allDelivered = total > 0 && gotCount === total;
                const partial = gotCount > 0 && gotCount < total;
                // Past the window a match can NEVER be delivered again —
                // not auto-released, and force-send is refused server-
                // side. `expired` = not-fully-delivered AND past window;
                // it drives the "no more sending" note + hidden button.
                const windowMs = (rule.requestWindowSeconds ?? 0) * 1000;
                const ageMs = Date.now() - new Date(m.matchedAt).getTime();
                const pastWindow = windowMs > 0 && ageMs > windowMs;
                const expired = !allDelivered && pastWindow;
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
                          ✓ همه گرفتن ({gotCount}/{total})
                        </Badge>
                      ) : partial ? (
                        <Badge tone="danger">
                          ⚠️ ناقص ({gotCount}/{total})
                          {pastWindow ? " — بقیه دیگه نمی‌ره" : ""}
                        </Badge>
                      ) : pastWindow ? (
                        <Badge tone="neutral">
                          ⌛ منقضی — دیگه ارسال نمی‌شه
                        </Badge>
                      ) : (
                        <Badge tone="warn">⏸ نگه‌داشته (gate)</Badge>
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
                            {r.got ? "✓" : expired ? "⌛" : r.err ? "✗" : "⏸"}{" "}
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
                    {expired && (
                      <div className="mt-2 text-[10px] text-[var(--color-text-dim)]">
                        ⌛ منقضی — پنجره‌ی زمانی گذشته، دیگه قابل ارسال نیست.
                      </div>
                    )}
                    {!allDelivered && !expired && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <button
                          onClick={() => forceSend(m.id)}
                          className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)] self-start"
                        >
                          🚀 ارسال اجباری به نگرفته‌ها
                        </button>
                        {forceStatus && forceStatus.matchId === m.id && (
                          <div
                            className={`text-[10px] leading-relaxed p-2 rounded-md ${
                              forceStatus.ok
                                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
                                : "bg-rose-500/10 border border-rose-500/30 text-rose-200"
                            }`}
                          >
                            {forceStatus.msg}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {matchesError ? (
              <div className="mt-3 p-2 rounded-md bg-red-900/30 border border-red-800 text-[11px] text-red-200 flex items-center justify-between gap-2 flex-wrap">
                <span>⚠ {matchesError}</span>
                <button
                  onClick={loadMoreMatches}
                  className="text-[11px] px-2 py-1 rounded-md bg-red-700 hover:bg-red-600"
                >
                  🔄 دوباره امتحان کن
                </button>
              </div>
            ) : hasMoreMatches ? (
              <div
                ref={matchSentinelRef}
                className="text-center text-[11px] text-[var(--color-text-dim)] py-3"
              >
                {loadingMoreMatches
                  ? "⏳ در حال بارگذاری بیشتر…"
                  : "اسکرول کن تا بقیه بیاد"}
              </div>
            ) : (
              matches.length > MATCH_PAGE && (
                <div className="text-center text-[10px] text-[var(--color-text-dim)] py-3">
                  · پایان لیست ({matches.length} match) ·
                </div>
              )
            )}
          </>
        )}
      </Card>
    </Shell>
  );
}

// Staged example editor: adds/removals are collected LOCALLY and only
// committed on 💾 ذخیره — nothing auto-applies. AI generation previews
// into the pending list for review before saving.
function ExampleEditor({
  ruleId,
  items,
  purpose,
  tone,
  placeholder,
  aiGenerate,
  onSaved,
}: {
  ruleId: number;
  items: Example[];
  purpose: "rule_match" | "negative_match";
  tone: "pos" | "neg";
  placeholder: string;
  aiGenerate?: boolean;
  onSaved: () => void;
}) {
  const [adds, setAdds] = useState<string[]>([]);
  const [dels, setDels] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState("");
  const [seed, setSeed] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = adds.length > 0 || dels.size > 0;
  const accent = tone === "neg" ? "bg-rose-600" : "bg-[var(--color-accent)]";
  const chipBg =
    tone === "neg"
      ? "bg-rose-500/5 border-rose-500/20"
      : "bg-[var(--color-surface-2)] border-transparent";

  const addDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setAdds((a) => [...a, t]);
    setDraft("");
  };
  const toggleDel = (exId: number) =>
    setDels((d) => {
      const n = new Set(d);
      n.has(exId) ? n.delete(exId) : n.add(exId);
      return n;
    });
  const aiGen = async () => {
    if (!seed.trim()) return;
    setAiBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/rules/${ruleId}/generate-examples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample: seed, save: false }),
      });
      const j = (await r.json()) as { variations?: string[]; error?: string };
      if (r.ok && j.variations?.length) {
        setAdds((a) => [...a, ...j.variations!]);
        setSeed("");
        setMsg(`✅ ${j.variations.length} نمونه ساخته شد — بازبینی کن، بعد ذخیره بزن`);
      } else setMsg(`❌ ${j.error ?? "خطا"}`);
    } finally {
      setAiBusy(false);
      setTimeout(() => setMsg(null), 8000);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      for (const text of adds)
        await fetch(`/api/rules/${ruleId}/examples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, purpose }),
        });
      for (const exId of dels)
        await fetch(`/api/rules/${ruleId}/examples?exampleId=${exId}`, {
          method: "DELETE",
        });
      setAdds([]);
      setDels(new Set());
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setAdds([]);
    setDels(new Set());
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      {(items.length > 0 || adds.length > 0) && (
        <div className="flex flex-col gap-1">
          {items.map((e) => {
            const marked = dels.has(e.id);
            return (
              <div
                key={e.id}
                className={`flex items-start gap-2 p-2 rounded-md border text-xs ${chipBg} ${marked ? "opacity-50" : ""}`}
              >
                <div
                  dir="auto"
                  style={{ unicodeBidi: "plaintext" }}
                  className={`flex-1 min-w-0 whitespace-pre-wrap break-words ${marked ? "line-through" : ""}`}
                >
                  {truncate(e.text, 400)}
                </div>
                <button
                  onClick={() => toggleDel(e.id)}
                  title={marked ? "برگردون" : "برای حذف علامت بزن"}
                  className="text-[10px] text-red-300 hover:text-red-200 shrink-0"
                >
                  {marked ? "↩︎" : "✕"}
                </button>
              </div>
            );
          })}
          {adds.map((t, i) => (
            <div
              key={`add-${i}`}
              className="flex items-start gap-2 p-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-xs"
            >
              <span className="text-[9px] text-emerald-300 shrink-0 mt-0.5">جدید</span>
              <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="flex-1 min-w-0 whitespace-pre-wrap break-words">
                {truncate(t, 400)}
              </div>
              <button
                onClick={() => setAdds((a) => a.filter((_, j) => j !== i))}
                className="text-[10px] text-red-300 hover:text-red-200 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="flex-1 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
        />
        <button
          onClick={addDraft}
          disabled={!draft.trim()}
          className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-40 self-start"
        >
          + به لیست
        </button>
      </div>

      {aiGenerate && (
        <div className="flex gap-2">
          <input
            dir="auto"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="🤖 یه نمونه بده تا چندتای مشابه بسازه…"
            className="flex-1 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2"
          />
          <button
            onClick={aiGen}
            disabled={aiBusy || !seed.trim()}
            className="text-[11px] px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/40 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 self-start"
          >
            {aiBusy ? "..." : "🤖 بساز"}
          </button>
        </div>
      )}
      {msg && <div className="text-[10px] text-[var(--color-text-dim)]">{msg}</div>}

      <div className="flex items-center gap-2 justify-end">
        {dirty && (
          <>
            <span className="text-[10px] text-amber-300 me-auto">
              {adds.length ? `${adds.length} افزودن` : ""}
              {adds.length && dels.size ? " · " : ""}
              {dels.size ? `${dels.size} حذف` : ""} — ذخیره نشده
            </span>
            <button
              onClick={discard}
              className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--color-border)]"
            >
              انصراف
            </button>
          </>
        )}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={`text-xs px-3 py-1.5 rounded-md text-white disabled:opacity-40 ${accent}`}
        >
          {saving ? "ذخیره…" : "💾 ذخیره"}
        </button>
      </div>
    </div>
  );
}
