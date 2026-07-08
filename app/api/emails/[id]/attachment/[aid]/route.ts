import { requireSession } from "@/lib/auth";
import { getEmail, getEmailAccount } from "@/lib/db";
import { fetchReceivedEmailAttachmentUrl } from "@/lib/email";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve a fresh signed download URL for a received-email attachment
// and redirect to it. The stored attachment metadata only carries the
// id; the download URL is short-lived so we mint it on demand.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; aid: string }> },
): Promise<Response> {
  try {
    await requireSession();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const { id, aid } = await ctx.params;
  const e = await getEmail(Number(id));
  if (!e || !e.resendId) return new Response("not found", { status: 404 });
  const att = (e.attachments ?? []).find((a) => a.id === aid);
  if (!att) return new Response("attachment not found", { status: 404 });

  const account = e.accountId ? await getEmailAccount(e.accountId) : null;
  const s = await getSettings().catch(() => null);
  const apiKey = (account?.resendApiKey || s?.resendApiKey || "").trim();
  const signed = await fetchReceivedEmailAttachmentUrl(apiKey, e.resendId, aid);
  if (!signed) return new Response("could not resolve attachment", { status: 502 });
  return Response.redirect(signed.url, 302);
}
