import { requireSession } from "@/lib/auth";
import { getEmail } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try { await requireSession(); } catch { return new Response("unauthorized", { status: 401 }); }
  const { id } = await ctx.params;
  const e = await getEmail(Number(id));
  if (!e) return new Response("not found", { status: 404 });
  const format = new URL(request.url).searchParams.get("format") === "html" ? "html" : "text";
  if (format === "html") {
    const html = e.htmlBody || `<pre>${(e.textBody ?? "").replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))}</pre>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response(e.textBody ?? "(no text part)", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
