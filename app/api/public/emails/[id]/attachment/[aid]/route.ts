import { getEmail, getEmailAccount } from "@/lib/db";
import { fetchReceivedEmailAttachmentUrl } from "@/lib/email";
import { verifyEmailLink } from "@/lib/email-link";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public (no-login) attachment download, authed by the ?t= HMAC token.
// Resolves a fresh short-lived signed URL from Resend and redirects.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; aid: string }> },
): Promise<Response> {
  const { id, aid } = await ctx.params;
  const emailId = Number(id);
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!Number.isFinite(emailId) || !verifyEmailLink(emailId, token)) {
    return new Response("unauthorized", { status: 401 });
  }
  const e = await getEmail(emailId);
  if (!e || !e.resendId) return new Response("not found", { status: 404 });
  const att = (e.attachments ?? []).find((a) => String(a.id) === aid);
  if (!att) return new Response("attachment not found", { status: 404 });

  const account = e.accountId ? await getEmailAccount(e.accountId) : null;
  const s = await getSettings().catch(() => null);
  const apiKey = (account?.resendApiKey || s?.resendApiKey || "").trim();
  const signed = await fetchReceivedEmailAttachmentUrl(apiKey, e.resendId, aid);
  if (!signed) return new Response("could not resolve attachment", { status: 502 });
  return Response.redirect(signed.url, 302);
}
