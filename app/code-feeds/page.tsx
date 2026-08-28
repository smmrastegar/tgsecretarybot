"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type Feed = {
  id: number;
  token: string;
  label: string;
  chatId: number;
  windowSeconds: number;
  format: string;
  codesOnly: boolean;
  allowedIps: string[];
  enabled: boolean;
  lastAccessAt: string | null;
  lastAccessIp: string | null;
};

const BLANK = {
  id: 0,
  label: "",
  chatId: "",
  windowSeconds: 300,
  format: "json",
  codesOnly: true,
  allowedIps: "",
  enabled: true,
};

// navigator.clipboard is undefined on http:// origins and in some
// in-app browsers, so fall back to the textarea trick rather than
// silently doing nothing when the user taps copy.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
      title={label}
      className={`text-xs px-3 py-1.5 rounded-md border shrink-0 transition-colors ${
        done
          ? "border-emerald-700 text-emerald-300 bg-emerald-900/30"
          : "border-[var(--color-border)]"
      }`}
    >
      {done ? "کپی شد ✓" : `کپی ${label}`}
    </button>
  );
}

export default function CodeFeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // The form lives above the list, so clicking "ویرایش" on a row far
  // down the page used to change something the user couldn't see.
  const formRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/code-feeds");
    if (r.ok) setFeeds(((await r.json()) as { feeds: Feed[] }).feeds);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function focusForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function startNew() {
    setForm({ ...BLANK });
    setMsg(null);
    focusForm();
  }
  function startEdit(f: Feed) {
    setForm({
      id: f.id,
      label: f.label,
      chatId: String(f.chatId),
      windowSeconds: f.windowSeconds,
      format: f.format,
      codesOnly: f.codesOnly,
      allowedIps: f.allowedIps.join(", "),
      enabled: f.enabled,
    });
    setMsg(null);
    focusForm();
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const editing = form.id > 0;
    const r = await fetch("/api/code-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (r && r.ok) {
      setForm({ ...BLANK });
      setMsg(editing ? "تغییرات ذخیره شد ✓" : "فید ساخته شد ✓");
      void load();
    } else setMsg("خطا در ذخیره");
  }
  // The token IS the credential for this URL, so it has to be burnable
  // without rebuilding the feed. The old link dies the moment this runs.
  async function rotate(f: Feed) {
    if (
      !confirm(
        `توکنِ «${f.label}» عوض شود؟\n\nلینک فعلی بلافاصله از کار می‌افتد و هرجا استفاده شده باید با لینک جدید جایگزین شود.`,
      )
    )
      return;
    const r = await fetch("/api/code-feeds", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: f.id, action: "rotate_token" }),
    }).catch(() => null);
    setMsg(r && r.ok ? "توکن عوض شد — لینک جدید را کپی کن ✓" : "خطا در تغییر توکن");
    void load();
  }
  async function remove(id: number) {
    if (!confirm("این فید حذف شود؟ لینکش از کار می‌افتد.")) return;
    await fetch(`/api/code-feeds?id=${id}`, { method: "DELETE" }).catch(() => {});
    if (form.id === id) setForm({ ...BLANK });
    void load();
  }
  async function toggle(f: Feed) {
    await fetch("/api/code-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: f.id,
        label: f.label,
        chatId: f.chatId,
        windowSeconds: f.windowSeconds,
        format: f.format,
        codesOnly: f.codesOnly,
        allowedIps: f.allowedIps.join(","),
        enabled: !f.enabled,
      }),
    }).catch(() => {});
    void load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inp =
    "w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm";
  const editing = form.id > 0;
  const editingFeed = editing ? feeds.find((f) => f.id === form.id) : undefined;

  return (
    <Shell>
      <PageTitle
        title="🔑 فیدهای کد"
        subtitle="لینک توکن‌دار که فقط پیام‌های دارای کد یک کانال را، آن هم فقط داخل یک بازه‌ی زمانی کوتاه، نشان می‌دهد."
        actions={
          <button
            onClick={startNew}
            className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white"
          >
            ➕ فید جدید
          </button>
        }
      />

      <div ref={formRef}>
        <Card
          className={`mb-4 ${editing ? "border-[var(--color-accent)]" : ""}`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="text-sm font-medium">
              {editing ? (
                <>
                  ✏️ ویرایشِ{" "}
                  <span className="text-[var(--color-accent)]">
                    {editingFeed?.label || form.label || `#${form.id}`}
                  </span>
                </>
              ) : (
                "➕ ساختن فید جدید"
              )}
            </div>
            {editing && (
              <button
                onClick={startNew}
                className="text-[11px] px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                در عوض، فید جدید بساز
              </button>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] mb-1">نام</div>
              <input
                className={inp}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="مثلاً: کدهای SMS"
              />
            </div>
            <div>
              <div className="text-[11px] mb-1">chat_id کانال</div>
              <input
                className={inp}
                dir="ltr"
                value={form.chatId}
                onChange={(e) => setForm({ ...form, chatId: e.target.value })}
                placeholder="-1001213128961"
              />
            </div>
            <div>
              <div className="text-[11px] mb-1">بازه‌ی زمانی (ثانیه)</div>
              <input
                className={inp}
                dir="ltr"
                type="number"
                value={form.windowSeconds}
                onChange={(e) =>
                  setForm({ ...form, windowSeconds: Number(e.target.value) })
                }
              />
              <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                ۳۰۰ = پنج دقیقه‌ی اخیر
              </div>
            </div>
            <div>
              <div className="text-[11px] mb-1">فرمت خروجی</div>
              <select
                className={inp}
                value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value })}
              >
                <option value="html">HTML (صفحه‌ی آماده با دکمه‌ی کپی)</option>
                <option value="json">JSON (کد + متن + زمان)</option>
                <option value="text">متن ساده</option>
                <option value="codes">فقط کدها (هر خط یکی)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <div className="text-[11px] mb-1">
                IPهای مجاز{" "}
                <span className="text-[var(--color-text-dim)]">
                  (با کاما — خالی = همه)
                </span>
              </div>
              <input
                className={inp}
                dir="ltr"
                value={form.allowedIps}
                onChange={(e) =>
                  setForm({ ...form, allowedIps: e.target.value })
                }
                placeholder="1.2.3.4, 5.6.7.0/24"
              />
              {!form.allowedIps.trim() && (
                <div className="text-[10px] text-amber-400/80 mt-1">
                  خالی یعنی هرکسی که لینک را داشته باشد کدها را می‌بیند.
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={form.codesOnly}
                onChange={(e) =>
                  setForm({ ...form, codesOnly: e.target.checked })
                }
              />
              <span>فقط پیام‌هایی که کد دارند</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) =>
                  setForm({ ...form, enabled: e.target.checked })
                }
              />
              <span>فعال</span>
            </label>
          </div>
          <div className="flex gap-2 items-center mt-4">
            <button
              onClick={save}
              disabled={busy}
              className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              {busy ? "…" : editing ? "ذخیره‌ی تغییرات" : "ساختن فید"}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setForm({ ...BLANK });
                  setMsg(null);
                }}
                className="text-xs px-3 py-2 rounded-md border border-[var(--color-border)]"
              >
                انصراف
              </button>
            )}
            {msg && (
              <span className="text-[11px] text-[var(--color-text-dim)]">
                {msg}
              </span>
            )}
          </div>
        </Card>
      </div>

      {feeds.map((f) => {
        const url = `${origin}/api/feeds/${f.token}`;
        const isEditing = form.id === f.id;
        return (
          <Card
            key={f.id}
            className={`mb-3 ${isEditing ? "border-[var(--color-accent)]" : ""}`}
          >
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {f.label}{" "}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${f.enabled ? "bg-emerald-900/40 text-emerald-300" : "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"}`}
                  >
                    {f.enabled ? "فعال" : "غیرفعال"}
                  </span>
                  {isEditing && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] mr-1">
                      در حال ویرایش
                    </span>
                  )}
                </div>
                <div
                  className="text-[11px] text-[var(--color-text-dim)] mt-1"
                  dir="ltr"
                >
                  chat {f.chatId} · {f.windowSeconds}s · {f.format}
                  {f.codesOnly ? " · codes-only" : ""}
                  {f.allowedIps.length
                    ? ` · IP: ${f.allowedIps.join(", ")}`
                    : " · any IP"}
                </div>

                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <code
                    className="flex-1 min-w-0 text-[10px] break-all bg-[var(--color-surface-2)] p-2 rounded"
                    dir="ltr"
                  >
                    {url}
                  </code>
                  <CopyButton value={url} label="لینک" />
                  <CopyButton value={f.token} label="توکن" />
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] shrink-0"
                  >
                    باز کردن ↗
                  </a>
                </div>

                {f.lastAccessAt && (
                  <div
                    className="text-[10px] text-[var(--color-text-dim)] mt-1"
                    dir="ltr"
                  >
                    last access:{" "}
                    {new Date(f.lastAccessAt).toLocaleString("fa-IR")}
                    {f.lastAccessIp ? ` — ${f.lastAccessIp}` : ""}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => toggle(f)}
                  className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]"
                >
                  {f.enabled ? "غیرفعال کن" : "فعال کن"}
                </button>
                <button
                  onClick={() => startEdit(f)}
                  className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)]"
                >
                  ✏️ ویرایش
                </button>
                <button
                  onClick={() => rotate(f)}
                  title="توکن جدید بساز — لینک قبلی از کار می‌افتد"
                  className="text-xs px-3 py-1.5 rounded-md border border-amber-900/70 text-amber-300"
                >
                  🔄 توکن جدید
                </button>
                <button
                  onClick={() => remove(f.id)}
                  className="text-xs px-3 py-1.5 rounded-md border border-red-900 text-red-300"
                >
                  حذف
                </button>
              </div>
            </div>
          </Card>
        );
      })}
      {feeds.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            هنوز فیدی ساخته نشده — فرم بالا را پر کن و «ساختن فید» را بزن.
          </p>
        </Card>
      )}
    </Shell>
  );
}
