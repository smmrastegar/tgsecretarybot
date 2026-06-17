import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  clearMonitoredAccountPending,
  dueMonitoredAccounts,
  hasDb,
} from "@/lib/db";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";
import { getActiveKey, HikerOutOfCreditsError } from "@/lib/hikerapi";
import { HikerApprovalNeededError } from "@/lib/hikerapi-budget";
import { getBot } from "@/lib/bot";
import { listTenants } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}

type TenantResult = {
  tenantId: number;
  tenantName: string;
  checked: number;
  detected: number;
  forwarded: number;
  errors: string[];
  bail?: "out_of_credits" | "approval_needed";
  billingUrl?: string;
  approval?: {
    spentUsd: number;
    approvedUsd: number;
    nextThresholdUsd: number;
    budgetUsd: number;
    reason: string;
  };
};

async function processTenant(
  tenantId: number,
  tenantName: string,
): Promise<TenantResult> {
  return runWithTenant(tenantId, async () => {
    const out: TenantResult = {
      tenantId,
      tenantName,
      checked: 0,
      detected: 0,
      forwarded: 0,
      errors: [],
    };
    const target = await resolveTargetChat();
    if (!target) {
      out.errors.push(
        `tenant ${tenantName}: no chat tagged as storage/downloader`,
      );
      return out;
    }
    const due = await dueMonitoredAccounts(30, tenantId);
    const bot = getBot();
    for (const acc of due) {
      out.checked++;
      try {
        // Notify-mode accounts carry the requested actions in
        // pending_notify_kinds. Translate "story"/"post"/"reel"/...
        // into the kindOverrides processAccount expects, and only
        // include kinds the account actually has enabled (so a
        // notify that says "post" doesn't fetch posts if the
        // operator turned check_posts off).
        const pendingKinds =
          acc.mode === "notify" && acc.pendingNotifyKinds
            ? acc.pendingNotifyKinds
            : null;
        const kindOverrides:
          | {
              story?: boolean;
              post?: boolean;
              reel?: boolean;
              mentioned?: boolean;
            }
          | undefined = (() => {
          if (!pendingKinds) return undefined;
          if (pendingKinds.includes("any")) return undefined;
          // Translate the notify "actions" into kindOverrides AND
          // require the account's check_* flags to be on. A notify
          // that says "post" must not fetch posts when the operator
          // turned check_posts off — that's a hard rule.
          return {
            story: pendingKinds.includes("story") && acc.checkStories,
            post: pendingKinds.includes("post") && acc.checkPosts,
            reel: pendingKinds.includes("reel") && acc.checkReels,
            mentioned:
              pendingKinds.includes("mentioned") && acc.checkMentioned,
          };
        })();
        const result = await processAccount({
          account: acc,
          target,
          bot,
          ...(kindOverrides ? { kindOverrides } : {}),
        });
        out.detected += result.detected;
        out.forwarded += result.forwarded;
        out.errors.push(...result.errors);
        // Clear the pending queue after a successful notify-mode run
        // so the next webhook starts a fresh 3-hour window.
        if (acc.mode === "notify" && acc.pendingFetchAt) {
          await clearMonitoredAccountPending(acc.id).catch(() => {});
        }
      } catch (err) {
        if (err instanceof HikerOutOfCreditsError) {
          out.bail = "out_of_credits";
          out.billingUrl = err.billingUrl;
          out.errors.push(`HikerAPI out of credits: ${err.message}`);
          break;
        }
        if (err instanceof HikerApprovalNeededError) {
          out.bail = "approval_needed";
          out.approval = {
            spentUsd: err.spentUsd,
            approvedUsd: err.approvedUsd,
            nextThresholdUsd: err.nextThresholdUsd,
            budgetUsd: err.budgetUsd,
            reason: err.reason,
          };
          out.errors.push(err.message);
          break;
        }
        const msg = err instanceof Error ? err.message : String(err);
        out.errors.push(`${acc.username}: ${msg.slice(0, 200)}`);
      }
    }
    return out;
  });
}

async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured" },
      { status: 503 },
    );
  }
  // Iterate every enabled tenant. A tenant whose budget is exhausted
  // bails out early — other tenants keep running.
  const tenants = (await listTenants()).filter((t) => t.isEnabled);
  const results: TenantResult[] = [];
  for (const t of tenants) {
    try {
      results.push(await processTenant(t.id, t.name));
    } catch (err) {
      results.push({
        tenantId: t.id,
        tenantName: t.name,
        checked: 0,
        detected: 0,
        forwarded: 0,
        errors: [`tenant fatal: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }
  const totals = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.checked,
      detected: acc.detected + r.detected,
      forwarded: acc.forwarded + r.forwarded,
    }),
    { checked: 0, detected: 0, forwarded: 0 },
  );
  return NextResponse.json({
    ok: true,
    tenants: results,
    ...totals,
  });
}
