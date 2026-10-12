"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import { confirmDialog } from "@/components/ui/Dialogs";
import EditorSection from "@/components/rule-editor/EditorSection";
import ExampleEditor from "@/components/rule-editor/ExampleEditor";
import MatchHistory, { matchStatus, type MatchFilter } from "@/components/rule-editor/MatchHistory";
import RecipientsSection from "@/components/rule-editor/RecipientsSection";
import RuleSummary from "@/components/rule-editor/RuleSummary";
import { FormatFields, GateFields, SourceFields } from "@/components/rule-editor/SettingsFields";
import { btnGhost, btnPrimary, Chip, fa, Field, inputCls, Note, windowLabel, type Example, type Match, type Recipient, type Rule, type TestResult } from "@/components/rule-editor/shared";
import TestSection from "@/components/rule-editor/TestSection";
import { relTime } from "@/lib/format";

// The rule editor. State and every API call live here; the sections (components/rule-editor/*) only lay the
// fields out. The page opens with a plain-language "what does this rule do" card, then collapsible sections
// by purpose, and a sticky save bar so the one save action is always in reach.
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // edit form
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [format, setFormat] = useState("");
  const [requestTrigger, setRequestTrigger] = useState("");
  const [requestWindow, setRequestWindow] = useState<number | null>(null);
  const [sourceChats, setSourceChats] = useState("");
  const [excludeChats, setExcludeChats] = useState("");
  const [sourceThreads, setSourceThreads] = useState("");
  const [matchPattern, setMatchPattern] = useState("");
  const [matchAllFromSource, setMatchAllFromSource] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [variationStatus, setVariationStatus] = useState<string | null>(null);
  const [showRulePrefix, setShowRulePrefix] = useState(true);
  const [formatAsOtp, setFormatAsOtp] = useState(false);
  const [header, setHeader] = useState("");
  // Mirrors renderHeader() in lib/rule-delivery.ts so the operator sees
  // exactly what the recipient will get.
  const previewHeader = useMemo(() => {
    const now = new Date();
    const map: Record<string, string> = {
      "{sender}": "Asainternet",
      "{bot}": "Asainternet",
      "{chat}": "Asainternet",
      "{rule}": name || "قانون",
      "{date}": now.toLocaleDateString("fa-IR"),
      "{time}": now.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }),
      "{dest}": "SingBox(Support)",
    };
    return header.replace(/\{(sender|bot|chat|rule|date|time|dest)\}/g, (m) => map[m] ?? m);
  }, [header, name]);

  // recipient form
  const [newChat, setNewChat] = useState("");
  const [newLabel, setNewLabel] = useState("");

  // test
  const [testLimit, setTestLimit] = useState(30);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const MATCH_PAGE = 10;
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("active");
  const [hasMoreMatches, setHasMoreMatches] = useState(true);
  const [loadingMoreMatches, setLoadingMoreMatches] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  // Only the very first load replaces the page with a spinner; later reloads (after save, simulate, …) refresh
  // in place so open sections and the scroll position survive.
  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    if (!loadedOnce.current) setLoading(true);
    setLoadError(null);
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
        loadedOnce.current = true;
        setRule(j.rule);
        setRecipients(j.recipients ?? []);
        setName(j.rule.name);
        setDesc(j.rule.description);
        setFormat(j.rule.forwardFormat ?? "");
        setHeader(j.rule.forwardHeader ?? "");
        setRequestTrigger(j.rule.requestTrigger ?? "");
        setRequestWindow(j.rule.requestWindowSeconds);
        setSourceChats((j.rule.sourceChatIds ?? []).join(", "));
        setExcludeChats((j.rule.excludeSourceChatIds ?? []).join(", "));
        setSourceThreads((j.rule.sourceThreadIds ?? []).join(", "));
        setMatchPattern(j.rule.matchPattern ?? "");
        setMatchAllFromSource(!!j.rule.matchAllFromSource);
        setShowRulePrefix(j.rule.showRulePrefix !== false);
        setFormatAsOtp(!!j.rule.formatAsOtp);
      } else {
        setLoadError(r1.status === 404 ? "Rule پیدا نشد." : `خطا ${r1.status} — بارگذاری rule شکست خورد.`);
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
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
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
          forwardHeader: header || null,
          requestTrigger: requestTrigger || null,
          requestWindowSeconds: requestWindow,
          sourceChatIds: sourceChats || null,
          excludeSourceChatIds: excludeChats || null,
          sourceThreadIds: sourceThreads || null,
          matchPattern: matchPattern || null,
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
    excludeChats,
    sourceThreads,
    matchPattern,
    matchAllFromSource,
    showRulePrefix,
    header,
    formatAsOtp,
    load,
  ]);

  const remove = useCallback(async () => {
    if (!(await confirmDialog("این rule پاک بشه؟", { danger: true, confirmLabel: "حذف" }))) return;
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    window.location.href = "/rules";
  }, [id]);

  // Per-recipient in-flight flag → button spinners without a full reload.
  const [recipientBusy, setRecipientBusy] = useState<Record<number, boolean>>({});
  const [addingRecipient, setAddingRecipient] = useState(false);
  const busyRecip = (chatId: number, v: boolean) =>
    setRecipientBusy((s) => ({ ...s, [chatId]: v }));

  const addRecipient = useCallback(async () => {
    const chatId = Number(newChat);
    if (!Number.isFinite(chatId) || chatId === 0) return;
    setAddingRecipient(true);
    try {
      const r = await fetch(`/api/rules/${id}/recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientChatId: chatId,
          recipientLabel: newLabel || undefined,
        }),
      });
      if (r.ok) {
        setRecipients((rs) => {
          const exists = rs.some((x) => x.recipientChatId === chatId);
          if (exists)
            return rs.map((x) =>
              x.recipientChatId === chatId
                ? { ...x, recipientLabel: newLabel || x.recipientLabel }
                : x,
            );
          return [
            ...rs,
            {
              ruleId: Number(id),
              recipientChatId: chatId,
              recipientLabel: newLabel || null,
              paused: false,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        setNewChat("");
        setNewLabel("");
      }
    } finally {
      setAddingRecipient(false);
    }
  }, [id, newChat, newLabel]);

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
      busyRecip(chatId, true);
      try {
        const r = await fetch(
          `/api/rules/${id}/recipients?recipientChatId=${chatId}`,
          { method: "DELETE" },
        );
        if (r.ok)
          setRecipients((rs) => rs.filter((x) => x.recipientChatId !== chatId));
      } finally {
        busyRecip(chatId, false);
      }
    },
    [id],
  );

  const setRecipientPaused = useCallback(
    async (chatId: number, paused: boolean) => {
      busyRecip(chatId, true);
      // Optimistic: flip locally right away so the button reacts.
      setRecipients((rs) =>
        rs.map((x) => (x.recipientChatId === chatId ? { ...x, paused } : x)),
      );
      try {
        const r = await fetch(`/api/rules/${id}/recipients`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientChatId: chatId, paused }),
        });
        if (!r.ok)
          // revert on failure
          setRecipients((rs) =>
            rs.map((x) =>
              x.recipientChatId === chatId ? { ...x, paused: !paused } : x,
            ),
          );
      } finally {
        busyRecip(chatId, false);
      }
    },
    [id],
  );

  const renameRecipient = useCallback(
    async (chatId: number, label: string) => {
      busyRecip(chatId, true);
      try {
        const r = await fetch(`/api/rules/${id}/recipients`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientChatId: chatId, recipientLabel: label }),
        });
        if (r.ok)
          setRecipients((rs) =>
            rs.map((x) =>
              x.recipientChatId === chatId
                ? { ...x, recipientLabel: label.trim() || null }
                : x,
            ),
          );
      } finally {
        busyRecip(chatId, false);
      }
    },
    [id],
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
        gated?: boolean;
        delivered?: Array<{ chatId: number; label: string | null }>;
        held?: Array<{ chatId: number; label: string | null }>;
        failures?: Array<{ chatId: number; error: string }>;
        note?: string;
        error?: string;
      };
      if (!r.ok) setSimResult(`❌ ${j.error ?? `HTTP ${r.status}`}`);
      else if (!j.matched) setSimResult("⚪️ match نشد — این rule این پیام رو نمی‌گیره.");
      else {
        const names = (a?: Array<{ chatId: number; label: string | null }>) =>
          (a ?? []).map((x) => x.label || x.chatId).join("، ");
        const d = names(j.delivered);
        const h = names(j.held);
        const f = (j.failures ?? []).length;
        const parts = [`✅ match شد`];
        if (d) parts.push(`→ ارسال شد به: ${d}`);
        if (h) parts.push(`⏸ نگه‌داشته شد (منتظر «کد بده») برای: ${h}`);
        if (f) parts.push(`· ${f} ناموفق`);
        if (!d && !h && !f && j.note) parts.push(`· ${j.note}`);
        setSimResult(parts.join(" "));
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

  const deleteGateExample = useCallback(
    async (exampleId: number) => {
      await fetch(`/api/rules/${id}/examples?exampleId=${exampleId}`, { method: "DELETE" });
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
        <Card>در حال بارگذاری…</Card>
      </Shell>
    );
  }
  if (!rule) {
    return (
      <Shell>
        <Card>
          <p className="text-sm">{loadError ?? "Rule پیدا نشد."}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={load} className={btnPrimary}>تلاش دوباره</button>
            <Link href="/rules" className={`${btnGhost} inline-flex items-center`}>برگشت</Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // Unsaved edits of the rule's own fields (examples and recipients save themselves).
  const dirty =
    name !== rule.name ||
    desc !== rule.description ||
    format !== (rule.forwardFormat ?? "") ||
    header !== (rule.forwardHeader ?? "") ||
    requestTrigger !== (rule.requestTrigger ?? "") ||
    requestWindow !== rule.requestWindowSeconds ||
    sourceChats !== (rule.sourceChatIds ?? []).join(", ") ||
    excludeChats !== (rule.excludeSourceChatIds ?? []).join(", ") ||
    sourceThreads !== (rule.sourceThreadIds ?? []).join(", ") ||
    matchPattern !== (rule.matchPattern ?? "") ||
    matchAllFromSource !== !!rule.matchAllFromSource ||
    showRulePrefix !== (rule.showRulePrefix !== false) ||
    formatAsOtp !== !!rule.formatAsOtp;

  const sources = sourceChats.split(/[\s,،]+/).filter(Boolean);
  const activeRecipients = recipients.filter((r) => !r.paused).length;
  const gateActive =
    requestWindow != null && requestWindow > 0 && (requestTrigger.trim().length > 0 || gateExamples.length > 0);
  const count = (f: MatchFilter) => matches.filter((m) => matchStatus(m, recipients, rule.requestWindowSeconds) === f).length;
  const waiting = count("active");
  const partialN = count("partial");

  return (
    <Shell>
      <PageTitle
        title={`📐 ${rule.name}`}
        subtitle={`ساخته شده ${relTime(rule.createdAt)} · آخرین ویرایش ${relTime(rule.updatedAt)}`}
        actions={
          <Link href="/rules" className="inline-flex items-center whitespace-nowrap min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-sm">
            ← rules
          </Link>
        }
      />

      {/* one readable column on wide screens; the sections are forms, not a dashboard grid */}
      <div className="max-w-3xl">
      <RuleSummary
        name={name} enabled={rule.enabled} sourceChats={sourceChats} examplesCount={examples.length} negativeCount={negExamples.length}
        description={desc} matchPattern={matchPattern} matchAllFromSource={matchAllFromSource} recipients={recipients}
        formatAsOtp={formatAsOtp} format={format} header={header} requestWindow={requestWindow} requestTrigger={requestTrigger}
        gateExamplesCount={gateExamples.length}
      />

      <EditorSection icon="✏️" title="نام و توصیف" summary={name}>
        <div className="flex flex-col gap-4">
          <Field label="✏️ اسم rule">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم rule" className={inputCls} />
          </Field>
          <Field
            label="📝 توصیف (اختیاری)"
            hint="فقط وقتی به کار می‌آد که هیچ نمونه‌ای نداری — اون‌وقت rule از روی این توصیف با AI تصمیم می‌گیره. اگه نمونه داری، این نادیده گرفته می‌شه. (با «💾 ذخیره» پایین ذخیره می‌شه.)"
          >
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="مثلاً «پیام‌هایی که خبر ارز دیجیتال دارن»" rows={3} className={inputCls} />
          </Field>
        </div>
      </EditorSection>

      <EditorSection icon="🎯" title="مبدأ و الگو" summary={`${sources.length ? `${fa(sources.length)} چت مشخص` : "همه‌ی چت‌ها"}${matchPattern.trim() ? " · regex" : ""}${matchAllFromSource ? " · هر پیام" : ""}`}
        badge={sources.length === 0 ? <Chip tone="warn">بدون محدودیت</Chip> : undefined}>
        <SourceFields
          sourceChats={sourceChats} excludeChats={excludeChats} sourceThreads={sourceThreads} matchPattern={matchPattern} matchAllFromSource={matchAllFromSource}
          setSourceChats={setSourceChats} setExcludeChats={setExcludeChats} setSourceThreads={setSourceThreads} setMatchPattern={setMatchPattern} setMatchAllFromSource={setMatchAllFromSource}
        />
      </EditorSection>

      <EditorSection icon="✅" title="نمونه‌های مثبت" summary="این‌ها و هر پیامِ شبیهشون match می‌شن"
        badge={<Chip tone={examples.length === 0 ? "warn" : "ok"}>{fa(examples.length)}</Chip>}>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-text-dim)] leading-6">
            🧠 این rule <b>با نمونه</b> کار می‌کنه: نمونه‌ی پیام‌هایی که باید بگیره رو بده (یا با «🤖 بساز» چندتا بساز). هرچی بیشتر بدی دقیق‌تر
            می‌شه؛ هر پیامی که مثل نمونه‌هات باشه match می‌شه — حتی همون پیامی که ازش نمونه ساختی. اگه چیزی رو اشتباه گرفت، به «نمونه‌های منفی»
            اضافه‌اش کن.
          </p>
          {examples.length === 0 && (
            <Note tone="warn">
              ⚠️ هنوز نمونه‌ای نداری — این rule هیچی نمی‌گیره. یه پیام واقعی که باید بگیره اضافه کن (یا با «🤖 بساز» بساز) و ذخیره بزن.
            </Note>
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
        </div>
      </EditorSection>

      <EditorSection icon="🚫" title="نمونه‌های منفی" summary="این‌ها نباید match بشن" badge={<Chip>{fa(negExamples.length)}</Chip>}>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-text-dim)] leading-6">
            اگه rule داره چیزی رو اشتباه می‌گیره، متنِ همون پیامِ اشتباه رو اینجا اضافه کن و ذخیره بزن — دیگه پیام‌های شبیهش رو نمی‌گیره.
          </p>
          <ExampleEditor
            ruleId={id}
            items={negExamples}
            purpose="negative_match"
            tone="neg"
            placeholder="متن یه پیامی که اشتباه match شده (مثلاً رزرو/بلیط یا OTP)"
            onSaved={load}
          />
        </div>
      </EditorSection>

      <EditorSection icon="📬" title="گیرنده‌های فوروارد"
        summary={recipients.length === 0 ? "هیچ گیرنده‌ای ست نشده" : `${fa(activeRecipients)} فعال${recipients.length > activeRecipients ? ` · ${fa(recipients.length - activeRecipients)} متوقف` : ""}`}
        badge={<Chip tone={recipients.length === 0 ? "warn" : "info"}>{fa(recipients.length)}</Chip>}>
        <RecipientsSection
          recipients={recipients} busyMap={recipientBusy} testStatus={testStatus}
          newChat={newChat} newLabel={newLabel} adding={addingRecipient} onNewChat={setNewChat} onNewLabel={setNewLabel} onAdd={addRecipient}
          onPause={setRecipientPaused} onRemove={removeRecipient} onRename={renameRecipient} onTest={testRecipient}
        />
      </EditorSection>

      <EditorSection icon="🪧" title="قالب پیام"
        summary={`${formatAsOtp ? "حالت OTP" : format.trim() ? "format سفارشی" : "پیام اصلی"}${header.trim() ? " · هدر" : ""}${showRulePrefix ? " · prefix" : ""}`}>
        <FormatFields
          formatAsOtp={formatAsOtp} header={header} showRulePrefix={showRulePrefix} format={format} previewHeader={previewHeader}
          setFormatAsOtp={setFormatAsOtp} setHeader={setHeader} setShowRulePrefix={setShowRulePrefix} setFormat={setFormat}
        />
      </EditorSection>

      <EditorSection icon={gateActive ? "🔒" : "🔓"} title="گیت درخواست"
        summary={gateActive ? `فعال · پنجره‌ی ${windowLabel(requestWindow ?? 0)}` : "غیرفعال — ارسال فوری"}
        badge={gateExamples.length > 0 ? <Chip tone="warn">{fa(gateExamples.length)}</Chip> : undefined}>
        <GateFields
          requestTrigger={requestTrigger} requestWindow={requestWindow} gateExamples={gateExamples} generating={generating} variationStatus={variationStatus}
          setRequestTrigger={setRequestTrigger} setRequestWindow={setRequestWindow} onGenerate={generateVariations} onDeleteExample={deleteGateExample}
        />
      </EditorSection>

      <EditorSection icon="🧪" title="تست و پیش‌نمایش" summary="اجرای دستی · تست روی پیام‌های قبلی">
        <TestSection
          simText={simText} simBusy={simBusy} simResult={simResult} setSimText={setSimText} onSimulate={runSimulate}
          testLimit={testLimit} testing={testing} testResults={testResults} setTestLimit={setTestLimit} onRunTest={runTest}
        />
      </EditorSection>

      <EditorSection icon="🕐" title="تاریخچه تطبیق‌ها"
        summary={matches.length === 0 ? "هنوز هیچ پیامی به این rule نخورده" : `${fa(waiting)} منتظر · ${fa(partialN)} ناقص`}
        badge={matches.length > 0 ? <Chip tone={waiting > 0 ? "warn" : "neutral"}>{fa(matches.length)}</Chip> : undefined}>
        <MatchHistory
          matches={matches} recipients={recipients} windowSeconds={rule.requestWindowSeconds} filter={matchFilter} onFilter={setMatchFilter}
          hasMore={hasMoreMatches} loadingMore={loadingMoreMatches} error={matchesError} sentinelRef={matchSentinelRef} onLoadMore={loadMoreMatches}
          forceStatus={forceStatus} onForceSend={forceSend}
        />
      </EditorSection>

      {/* Sticky save bar: sits above the mobile tab bar (h-16), stays in reach while scrolling the sections. */}
      <div className="sticky bottom-16 md:bottom-4 z-10 -mx-4 md:mx-0 mt-4 px-4 py-3 md:rounded-2xl border-t md:border border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur shadow-[0_-8px_24px_rgba(0,0,0,0.35)] flex items-center gap-3">
        <div className={`flex-1 min-w-0 text-xs leading-5 ${dirty ? "text-amber-300" : "text-[var(--color-text-dim)]"}`}>
          {dirty ? "تغییرات ذخیره نشده" : "همه‌چیز ذخیره‌ست"}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={save} disabled={saving} className={btnPrimary}>
            {saving ? "ذخیره…" : "💾 ذخیره"}
          </button>
          <button onClick={remove} aria-label="پاک کردن rule" className="min-h-11 px-3 rounded-xl border border-red-700 text-red-300 text-sm hover:bg-red-900/30">
            🗑 پاک کن
          </button>
        </div>
      </div>
      </div>
    </Shell>
  );
}
