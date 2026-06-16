import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getMessageInlineButtons } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;

// Returns the URLs attached to this message via inline_buttons, plus
// (when ?label=... is set) the rendered HTML body of that button.
// Lookup-by-label rather than free-form URL keeps this from being an
// open SSRF proxy — the operator can only pull URLs that Telegram
// itself stamped onto this message.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const msgId = Number(id);
  if (!Number.isFinite(msgId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const buttons = await getMessageInlineButtons(msgId);
  if (!buttons || buttons.length === 0) {
    return NextResponse.json({ error: "no inline buttons" }, { status: 404 });
  }
  const url = new URL(request.url);
  const wantLabel = url.searchParams.get("label");
  if (!wantLabel) {
    // List mode: return the available buttons so the viewer can show
    // a "switch view" picker (HTML / Preview / Text / Debug / ...).
    return NextResponse.json({ buttons });
  }
  const match = buttons.find(
    (b) => b.label.toLowerCase() === wantLabel.toLowerCase(),
  );
  if (!match) {
    return NextResponse.json(
      { error: `no button labelled "${wantLabel}"` },
      { status: 404 },
    );
  }
  // Only fetch http(s) URLs. Refuse anything else — telegram links
  // wouldn't make sense to render here.
  let target: URL;
  try {
    target = new URL(match.url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json(
      { error: "unsupported protocol" },
      { status: 400 },
    );
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target.toString(), {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "tgsecretarybot-email-viewer/1",
        Accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: `upstream ${res.status}` },
      { status: 502 },
    );
  }
  const cl = Number(res.headers.get("content-length") || 0);
  if (cl && cl > MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return NextResponse.json({
      url: target.toString(),
      contentType: res.headers.get("content-type") ?? "text/html",
      body: text.slice(0, MAX_BYTES),
    });
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {}
      return NextResponse.json({ error: "too large" }, { status: 413 });
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return NextResponse.json({
    url: target.toString(),
    contentType: res.headers.get("content-type") ?? "text/html",
    body: buf.toString("utf-8"),
  });
}
