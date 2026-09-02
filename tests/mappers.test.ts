import { describe, expect, it } from "vitest";
import { rowToRule } from "../lib/db/rules";
import { rowToChatRule } from "../lib/db/chats";

// The two hottest row mappers moved from `as` casts to typed accessors.
// These pin the defaults and NULL handling the rest of the app relies on,
// using rows shaped the way the Postgres driver returns them.

describe("rowToRule", () => {
  const base = {
    id: "6", tenant_id: null, name: "تیکت‌ها", description: "d",
    forward_format: null, forward_header: "🎫", request_trigger: null,
    request_window_seconds: null, source_chat_ids: null, source_thread_ids: "7124, 3",
    match_pattern: "^x", match_all_from_source: false, show_rule_prefix: null,
    format_as_otp: false, enabled: true, created_by: "1",
    created_at: new Date("2026-08-28T00:00:00Z"), updated_at: new Date("2026-09-01T00:00:00Z"),
  };
  it("coerces ids, parses thread lists, and defaults showRulePrefix to true on NULL", () => {
    const r = rowToRule(base);
    expect(r.id).toBe(6);
    expect(r.tenantId).toBeNull();
    expect(r.createdBy).toBe(1);
    expect(r.sourceChatIds).toBeNull();
    expect(r.sourceThreadIds).toEqual([7124, 3]);
    expect(r.matchPattern).toBe("^x");
    expect(r.showRulePrefix).toBe(true);
    expect(r.enabled).toBe(true);
    expect(r.createdAt.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });
  it("respects an explicit false for showRulePrefix", () => {
    expect(rowToRule({ ...base, show_rule_prefix: false }).showRulePrefix).toBe(false);
  });
});

describe("rowToChatRule", () => {
  const row = {
    chat_id: "-1004364845878", chat_type: "supergroup", chat_title: "LimooMe",
    vip: false, muted: false, custom_reply: null, notes: null,
    mode: "off", mode_changed_at: null, updated_at: new Date("2026-09-01T00:00:00Z"),
    secretary_user_id: null, first_name: null, last_name: null, nickname: "مطی",
    relationship: "friend", function_role: "notes_inbox", function_config: { a: 1 },
    auto_summarize_enabled: true, auto_summarize_gap_minutes: "0", auto_summarize_smart_timing: null,
    auto_forward_voice: true, auto_forward_video: false, self_voice_transcript: true,
    is_bot: false, ignored: false, summary_interval_hours: "24",
    analytics_share_token: "LXo", follow_up_enabled: null, follow_up_threshold_hours: null,
    follow_up_escalate_hours: "6", profile_id: null,
  };
  it("maps a typical group row with the documented defaults", () => {
    const c = rowToChatRule(row);
    expect(c.chatId).toBe(-1004364845878);
    expect(c.nickname).toBe("مطی");
    expect(c.mode).toBe("off");
    // mode_changed_at NULL → falls back to updated_at
    expect(c.modeChangedAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(c.functionRole).toBe("notes_inbox");
    expect(c.functionConfig).toEqual({ a: 1 });
    // gap 0 → default 5; smart timing NULL → true
    expect(c.autoSummarizeGapMinutes).toBe(5);
    expect(c.autoSummarizeSmartTiming).toBe(true);
    expect(c.autoForwardVoice).toBe(true);
    expect(c.autoForwardVideo).toBe(false);
    expect(c.selfVoiceTranscript).toBe(true);
    expect(c.summaryIntervalHours).toBe(24);
    expect(c.analyticsShareToken).toBe("LXo");
    // follow-up defaults: enabled NULL → true, threshold NULL → 2, escalate "6" → 6
    expect(c.followUpEnabled).toBe(true);
    expect(c.followUpThresholdHours).toBe(2);
    expect(c.followUpEscalateHours).toBe(6);
    expect(c.profileId).toBeNull();
  });
  it("rejects unknown enum values instead of passing them through", () => {
    const c = rowToChatRule({ ...row, mode: "bogus", relationship: "nope", function_role: "nah" });
    expect(c.mode).toBe("off");
    expect(c.relationship).toBeNull();
    expect(c.functionRole).toBeNull();
  });
  it("treats mysql-style 0/1 booleans like postgres booleans", () => {
    const c = rowToChatRule({ ...row, vip: 1, muted: 0, ignored: "1" });
    expect(c.vip).toBe(true);
    expect(c.muted).toBe(false);
    expect(c.ignored).toBe(true);
  });
});
