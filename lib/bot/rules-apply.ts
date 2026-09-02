// Split out of the former single lib/bot.ts. Import from "@/lib/bot" —
// that barrel re-exports every module here.
import { Bot } from "grammy";
import { hasDb, logMessage } from "../db";
import { reportWarn } from "../report";
import { getBot } from "./core";

// Messages the bot itself writes into a chat never come back as an
// update — Telegram does not echo a bot's own sends — so nothing in the
// normal pipeline ever sees them. An agent posting through the MCP
// send_message tool is exactly that case: its tickets landed in the
// topic and were invisible to rules and to messages_log alike. Callers
// that write on the bot's behalf hand the text here instead.
export async function applyRulesToBotOutgoing(args: {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  messageThreadId: number | null;
  messageId: number;
  text: string;
  senderName: string;
}): Promise<void> {
  if (!args.text.trim()) return;
  if (!hasDb()) return;
  let logId = 0;
  try {
    logId = await logMessage({
      businessConnectionId: null,
      ownerUserId: null,
      chatId: args.chatId,
      chatType: args.chatType,
      chatTitle: args.chatTitle,
      senderId: null,
      senderUsername: null,
      senderName: args.senderName,
      messageId: args.messageId,
      messageText: args.text,
      importance: 0,
      urgent: false,
      concernsOwner: false,
      reason: "bot outgoing (mcp)",
      alerted: false,
      autoReplied: false,
      fromOwner: false,
      messageThreadId: args.messageThreadId,
    });
  } catch (err) {
    reportWarn("bot", "[rules] outgoing log failed:", err);
    return;
  }
  await maybeApplyMessageRules({
    logId,
    chatId: args.chatId,
    chatTitle: args.chatTitle,
    messageThreadId: args.messageThreadId,
    senderName: args.senderName,
    messageText: args.text,
    businessConnectionId: null,
    fromOwner: false,
    bot: getBot(),
  }).catch((err) =>
    reportWarn("bot", "[rules] apply failed (bot-outgoing path):", err),
  );
}

export async function maybeApplyMessageRules(args: {
  logId: number;
  chatId: number;
  chatTitle: string | null;
  /** Forum topic the message arrived in, for rules scoped to a topic. */
  messageThreadId?: number | null;
  senderName: string;
  messageText: string;
  businessConnectionId: string | null;
  fromOwner: boolean;
  bot: Bot;
}): Promise<void> {
  if (args.fromOwner) return;
  if (!args.messageText || !args.messageText.trim()) return;
  // Self-forward guard: when the recipient is itself a business-
  // connected account, our bot.api.sendMessage(...) reflects back
  // through *their* business connection as a fresh business_message.
  // Without this gate that message would re-match the rule and we'd
  // loop. Our forward prefix is "🏷 [rule:" — no real customer
  // message starts with that, so it's a safe sentinel.
  if (/^🏷 \[rule:/.test(args.messageText.trim())) {
    console.log(
      `[rules] skipping rule-prefixed forward echo chat=${args.chatId} log=${args.logId}`,
    );
    return;
  }
  try {
    const {
      listMessageRules,
      listRuleRecipients,
      recordRuleMatch,
    } = await import("../db");
    const { matchRules, formatMessageForRule } = await import("../rules");
    const allRules = await listMessageRules({ enabledOnly: true });
    // Source allowlist: a rule with source_chat_ids set can ONLY match
    // messages arriving from those chats. Deterministic scoping so a
    // broad description ("any message with a code") can't grab numbers
    // out of unrelated conversations.
    const scoped = allRules.filter((r) => {
      if (r.sourceChatIds && !r.sourceChatIds.includes(args.chatId)) return false;
      // Topic scope narrows an allowed chat to specific forum threads.
      // A group carries unrelated traffic in a dozen topics, so "this
      // chat" is usually too broad a unit to route on.
      if (r.sourceThreadIds) {
        const t = args.messageThreadId ?? null;
        if (t == null || !r.sourceThreadIds.includes(t)) return false;
      }
      // Deterministic shape gate. When a rule demands a literal format,
      // the classifier must never get a say — it will read intent into
      // anything a person types. A bad pattern fails CLOSED: a rule
      // that asked for a shape should forward nothing rather than
      // everything.
      if (r.matchPattern) {
        let re: RegExp;
        try {
          re = new RegExp(r.matchPattern, "u");
        } catch {
          reportWarn("bot", `[rules] rule ${r.id} has an invalid match_pattern — skipping`);
          return false;
        }
        if (!re.test(args.messageText)) return false;
      }
      return true;
    });
    // Loop guard. A forward carries the original text, so a rule whose
    // own output lands somewhere it also watches would re-match it
    // forever. Never evaluate a rule against a message sitting in one
    // of that rule's own recipient chats.
    const rules: typeof scoped = [];
    for (const r of scoped) {
      const dests = await listRuleRecipients(r.id).catch(() => []);
      if (dests.some((d) => d.recipientChatId === args.chatId)) {
        console.log(
          `[rules] rule ${r.id} skipped: chat ${args.chatId} is its own recipient`,
        );
        continue;
      }
      rules.push(r);
    }
    console.log(
      `[rules] eval chat=${args.chatId} log=${args.logId} enabledRules=${rules.length}/${allRules.length} text="${args.messageText.slice(0, 80).replace(/\n/g, " ")}"`,
    );
    if (rules.length === 0) return;
    // Source-feed rules (match_all_from_source + source scope) matched by
    // SOURCE alone — they already passed the source filter above, so no
    // LLM check. The rest go through the content classifier.
    const forced = rules.filter(
      (r) =>
        // Source-feed rules: matched by SOURCE alone.
        (r.matchAllFromSource && r.sourceChatIds && r.sourceChatIds.length > 0) ||
        // Pattern rules: matched by SHAPE alone. Everything reaching
        // here already passed the regex, and asking the classifier to
        // second-guess a format the operator specified exactly is how a
        // structurally perfect ticket got dropped for having a body that
        // "read like" a status request. If the shape is the rule, the
        // shape decides.
        Boolean(r.matchPattern),
    );
    const llmRules = rules.filter((r) => !forced.includes(r));
    const matchedLlm = llmRules.length
      ? await matchRules(
          {
            chatId: args.chatId,
            chatTitle: args.chatTitle,
            senderName: args.senderName,
            messageText: args.messageText,
            businessConnectionId: args.businessConnectionId,
          },
          llmRules,
        )
      : [];
    const matched = Array.from(
      new Set([...forced.map((r) => r.id), ...matchedLlm]),
    );
    if (matched.length === 0) return;
    for (const ruleId of matched) {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) continue;
      // Paused recipients keep their config but receive no forwards.
      const recipients = (await listRuleRecipients(ruleId)).filter(
        (r) => !r.paused,
      );
      if (recipients.length === 0) {
        await recordRuleMatch({
          ruleId,
          messageLogId: args.logId,
          formattedText: null,
          forwardedTo: [],
        }).catch(() => {});
        continue;
      }
      // OTP mode short-circuits the LLM formatter — we just extract
      // the digits ourselves. Saves a model call AND avoids the model
      // helpfully "tidying up" the code.
      const formatted = rule.formatAsOtp
        ? null
        : await formatMessageForRule(rule, {
            chatId: args.chatId,
            chatTitle: args.chatTitle,
            senderName: args.senderName,
            messageText: args.messageText,
            businessConnectionId: args.businessConnectionId,
          });
      const body =
        formatted && formatted.trim().length > 0
          ? formatted
          : args.messageText;
      const { buildRuleForwardText } = await import("../rule-delivery");
      let otpCode: string | null = null;
      if (rule.formatAsOtp) {
        const { extractOtpCodeAi } = await import("../rules");
        otpCode = await extractOtpCodeAi(body).catch(() => null);
      }
      // OTP mode + no extractable code = the matched message wasn't
      // actually an OTP carrier (it was probably someone asking for
      // the code). Skip the forward rather than ship "🔑 کد بده" —
      // that just trains the recipient to ignore the channel.
      if (rule.formatAsOtp && !otpCode) {
        console.log(
          `[rule] skip forward — formatAsOtp=true but no code extracted ` +
            `from message; rule=${ruleId} chat=${args.chatId}`,
        );
        await recordRuleMatch({
          ruleId,
          messageLogId: args.logId,
          formattedText: null,
          forwardedTo: [],
        }).catch(() => {});
        continue;
      }
      const built = buildRuleForwardText({
        ruleName: rule.name,
        senderName: args.senderName,
        body,
        showRulePrefix: rule.showRulePrefix,
        formatAsOtp: rule.formatAsOtp,
        otpCode,
        forwardHeader: rule.forwardHeader,
        chatTitle: args.chatTitle,
      });
      const outText = built.text;
      const outParseMode = built.parseMode;

      // Request-gate: hold the forward for each recipient until they've
      // sent a trigger-matching message within the window. The gate is
      // ACTIVE when the window is set AND there's either a trigger
      // description OR saved gate examples. (Previously only the
      // trigger text counted — an operator who generated gate examples
      // but never saved the description silently ran WITHOUT a gate and
      // codes forwarded to everyone immediately.)
      const { listRuleExamples: listExamplesForGate } = await import("../db");
      const windowed =
        rule.requestWindowSeconds != null && rule.requestWindowSeconds > 0;
      let gated = false;
      if (windowed) {
        if (rule.requestTrigger?.trim()) {
          gated = true;
        } else {
          // Examples-only gate. FAIL CLOSED: if we can't read the
          // examples (transient DB error), HOLD rather than broadcast
          // the code to everyone. A held code is recoverable (the
          // recipient can ask again); a leaked code is not.
          try {
            const ex = await listExamplesForGate(ruleId, "gate_match");
            gated = ex.length > 0;
          } catch (err) {
            reportWarn("bot", 
              `[rules] gate-example read failed rule=${ruleId} — failing closed (holding):`,
              err,
            );
            gated = true;
          }
        }
      }

      const { sendRuleForward } = await import("../rule-delivery");
      const { consumeRecipientRequest } = await import("../db");
      const delivered: number[] = [];
      const failures: Array<{ chatId: number; reason: string }> = [];
      for (const r of recipients) {
        let shouldForward = !gated;
        if (gated) {
          // ATOMIC check-and-consume: forward NOW only if this recipient
          // has a still-valid request stamp, which is cleared in the
          // same statement. Two codes arriving concurrently for one ask
          // can no longer both pass this gate. If the send then fails
          // the match stays held and a re-ask re-releases it.
          shouldForward = await consumeRecipientRequest({
            ruleId,
            recipientChatId: r.recipientChatId,
            windowSeconds: rule.requestWindowSeconds ?? 0,
          }).catch(() => false);
        }
        if (!shouldForward) continue;
        const { fillDestPlaceholder } = await import("../rule-delivery");
        const out = await sendRuleForward({
          bot: args.bot,
          chatId: r.recipientChatId,
          text: fillDestPlaceholder(outText, r.recipientLabel),
          parseMode: outParseMode,
        });
        if (out.ok) {
          delivered.push(r.recipientChatId);
          console.log(
            `[rules] forward sent rule=${ruleId} → chat=${r.recipientChatId} mode=${out.mode} msg_id=${out.sentMessageId} bcId=${out.businessConnectionId ?? "—"}${gated ? " (gate: recipient requested recently)" : ""}`,
          );
        } else {
          failures.push({
            chatId: r.recipientChatId,
            reason: out.error,
          });
          reportWarn("bot", 
            `[rules] forward to ${r.recipientChatId} failed (both modes): ${out.error}`,
          );
        }
      }
      if (failures.length > 0) {
        reportWarn("bot", 
          `[rules] partial forward rule=${ruleId} delivered=${delivered.length}/${recipients.length} failures=${JSON.stringify(failures)}`,
        );
      }
      if (gated && delivered.length < recipients.length) {
        console.log(
          `[rules] gate-held ${recipients.length - delivered.length}/${recipients.length} (rule=${ruleId} window=${rule.requestWindowSeconds}s)`,
        );
      }
      const errMap: Record<string, string> = {};
      for (const f of failures) errMap[String(f.chatId)] = f.reason;
      await recordRuleMatch({
        ruleId,
        messageLogId: args.logId,
        formattedText: formatted,
        forwardedTo: delivered,
        forwardErrors: errMap,
      }).catch(() => {});
    }
  } catch (err) {
    reportWarn("bot", "[rules] application failed:", err);
  }
}

// Called for every logged incoming message. If the sender's chat is a
// recipient of any rule that has a request_trigger, check whether the
// text counts as a trigger — if it does, release the matching messages
// that were held within the window.
export async function maybeReleaseGatedRules(args: {
  senderChatId: number;
  messageText: string;
  bot: Bot;
}): Promise<void> {
  if (!args.messageText || !args.messageText.trim()) return;
  // Same self-forward guard as maybeApplyMessageRules: our own
  // rule-tagged forward bouncing back must not look like a trigger.
  if (/^🏷 \[rule:/.test(args.messageText.trim())) return;
  try {
    const {
      listRulesForRecipient,
      findPendingMatchesForRecipient,
      markMatchForwardedTo,
      markRecipientRequestedNow,
      clearRecipientRequest,
      listRuleExamples,
    } = await import("../db");
    const { checkRequestTriggerMatch } = await import("../rules");
    const rules = await listRulesForRecipient(args.senderChatId);
    // Same gate-activation logic as the forward path: window set AND
    // (trigger description OR gate examples). Rules whose gate is
    // active only via examples must still be releasable here.
    const candidates = rules.filter(
      (r) =>
        r.enabled &&
        r.requestWindowSeconds != null &&
        r.requestWindowSeconds > 0,
    );
    if (candidates.length === 0) return;
    const { listRuleRecipients: listRecips } = await import("../db");
    for (const rule of candidates) {
      // A paused recipient must not have codes released to them either.
      const myRecip = (await listRecips(rule.id).catch(() => [])).find(
        (r) => r.recipientChatId === args.senderChatId,
      );
      if (myRecip?.paused) continue;
      // Gate-side example phrasings (the "🤖 ساخت پاراف‌راز با AI"
      // output) widen the gate's understanding beyond the one-line
      // description.
      const gateExamples = await listRuleExamples(rule.id, "gate_match")
        .then((rows) => rows.map((r) => r.text))
        .catch(() => []);
      const hasGate =
        !!rule.requestTrigger?.trim() || gateExamples.length > 0;
      if (!hasGate) continue;
      const isTrigger = await checkRequestTriggerMatch(
        args.messageText,
        rule.requestTrigger ?? "",
        gateExamples,
      );
      if (!isTrigger) continue;
      // Stamp the trigger so a match arriving RIGHT AFTER this ask
      // (bidirectional gate) forwards immediately. Consumed on
      // delivery — one ask, one code.
      await markRecipientRequestedNow({
        ruleId: rule.id,
        recipientChatId: args.senderChatId,
      }).catch(() => {});
      const pending = await findPendingMatchesForRecipient({
        ruleId: rule.id,
        recipientChatId: args.senderChatId,
        withinSeconds: rule.requestWindowSeconds ?? 0,
      });
      if (pending.length === 0) continue;
      const { sendRuleForward, buildRuleForwardText } = await import("../rule-delivery");
      const { extractOtpCodeAi } = await import("../rules");
      // Release ONLY the newest pending match — one ask, one code. The
      // old behavior dumped every held match in the window at once,
      // which could leak several unrelated codes on a single request.
      const newestFirst = [...pending].sort(
        (a, b) =>
          new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime(),
      );
      for (const p of newestFirst) {
        // Same rule-flag-aware build as the forward path. OTP mode
        // re-extracts the code from formatted_text (or messageText)
        // — we don't trust whatever was held to be already OTP-shaped.
        const body =
          p.formattedText && p.formattedText.trim().length > 0
            ? p.formattedText
            : p.messageText;
        const otpCode = rule.formatAsOtp
          ? await extractOtpCodeAi(body).catch(() => null)
          : null;
        // OTP mode without an extractable code: the held message
        // was a false positive (asker, not OTP carrier). Drop it
        // silently instead of releasing "🔑 <raw text>" and try the
        // next-newest held match instead.
        if (rule.formatAsOtp && !otpCode) {
          console.log(
            `[rule] gate-release skip — formatAsOtp=true but no code ` +
              `extractable; rule=${rule.id} match=${p.matchId}`,
          );
          continue;
        }
        const built = buildRuleForwardText({
          ruleName: rule.name,
          senderName: p.senderName,
          body,
          showRulePrefix: rule.showRulePrefix,
          formatAsOtp: rule.formatAsOtp,
          otpCode,
        });
        const outText = built.text;
        const out = await sendRuleForward({
          bot: args.bot,
          chatId: args.senderChatId,
          text: outText,
          parseMode: built.parseMode,
        });
        if (out.ok) {
          await markMatchForwardedTo({
            matchId: p.matchId,
            recipientChatId: args.senderChatId,
          });
          // Delivered — consume the request stamp and stop. One ask
          // releases exactly one code.
          await clearRecipientRequest({
            ruleId: rule.id,
            recipientChatId: args.senderChatId,
          }).catch(() => {});
          console.log(
            `[rules] released held match=${p.matchId} → ${args.senderChatId} mode=${out.mode} (rule=${rule.id})`,
          );
          break;
        } else {
          reportWarn("bot", 
            `[rules] release-forward to ${args.senderChatId} failed: ${out.error}`,
          );
          break;
        }
      }
    }
  } catch (err) {
    reportWarn("bot", "[rules] release-gated failed:", err);
  }
}
