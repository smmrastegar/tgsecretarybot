import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, upsertMonitoredAccounts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse a CSV with the header:
//   id;type;param;url;created_at;topic_id
// Separator is auto-detected (`;` then `,`). Quoted values are
// supported. Header is matched case-insensitively. type/platform
// filters to "instagram" only for now.
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return rows;
  const firstLine = lines[0]!;
  const sep = firstLine.includes(";")
    ? ";"
    : firstLine.includes("\t")
      ? "\t"
      : ",";
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else {
        if (c === '"') inQ = true;
        else if (c === sep) {
          out.push(cur);
          cur = "";
        } else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(firstLine).map((h) => h.toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let csvText = "";
  const ct = request.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await request.json()) as { csv?: string };
      csvText = body.csv ?? "";
    } else {
      csvText = await request.text();
    }
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!csvText.trim()) {
    return NextResponse.json({ error: "empty csv" }, { status: 400 });
  }

  const parsed = parseCsv(csvText);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "no rows parsed" }, { status: 400 });
  }
  const items = parsed
    .map((r) => {
      const platform = (r.type || r.platform || "instagram").toLowerCase();
      const username = (r.param || r.username || "").trim();
      const url = (r.url || "").trim() || null;
      const externalId = (r.id || r.external_id || "").trim() || null;
      const topicId = (r.topic_id || r.topicid || "").trim() || null;
      return { platform, username, url, externalId, topicId };
    })
    .filter((r) => r.platform === "instagram" && r.username);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "no valid instagram rows" },
      { status: 400 },
    );
  }
  const { inserted, updated } = await upsertMonitoredAccounts(items);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.import",
    details: { inserted, updated, parsed: parsed.length },
  });
  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    parsed: parsed.length,
    valid: items.length,
  });
}
