import { authorizeEmailLink } from "@/lib/email-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public (no-login) raw view of an email body, authed by the ?t= HMAC
// token in the URL — the same token the Telegram card buttons carry.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const emailId = Number(id);
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const e = await authorizeEmailLink(emailId, token);
  if (!e) return new Response("unauthorized", { status: 401 });
  const format = url.searchParams.get("format") === "html" ? "html" : "text";
  if (format === "html") {
    const html =
      e.htmlBody ||
      `<pre>${(e.textBody ?? "").replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))}</pre>`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Email HTML is attacker-controlled. Serving it as a top-level
        // document on our own origin would let its scripts run with our
        // cookies. `CSP: sandbox` makes the browser treat the response
        // like a sandboxed iframe — no scripts, no same-origin access.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return new Response(e.textBody ?? "(no text part)", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
