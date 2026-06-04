# External Instagram Change-Detector — API contract

This is the contract between `tgsecretarybot` (the downstream Hiker
client + Telegram forwarder) and an upstream service that does cheap
polling of Instagram and pings us only when something actually
changes. The split keeps the expensive HikerAPI calls bounded to
"there's new content" instead of "let's go check every 30 min".

There are **two sides** to the contract:

1. **We push to you** when an account is added / removed (so you know
   what to watch).
2. **You push to us** when you detect new content (so we kick off
   the HikerAPI fetch + Telegram forward).

Both sides are authenticated with the **same shared HMAC secret**
(`monitorExternalSecret` in our settings, `MONITOR_EXTERNAL_SECRET`
on your side).

---

## Base URLs

| Side                          | Base URL                                            |
| ----------------------------- | --------------------------------------------------- |
| Your service (set by us)      | `https://your-service.example.com`                  |
| `tgsecretarybot` (set by you) | `https://<our-vercel-deploy>.vercel.app`            |

Owner configures these from the **Admin UI** (`/admin` →
`External monitor`). Settings:

- `monitorExternalEnabled` — `"true"` to enable the integration.
- `monitorExternalBaseUrl` — your service's base URL (no trailing
  slash).
- `monitorExternalSecret` — shared HMAC secret. Both sides MUST hold
  the same value.

---

## Auth — HMAC SHA-256 over the raw request body

Every request between us carries a header:

```
X-Signature: <hex(HMAC_SHA256(raw_body, shared_secret))>
```

The signature is computed over the **raw bytes of the JSON request
body** (not the parsed object). For `GET` requests with no body, sign
the empty string.

Pseudocode:

```python
import hmac, hashlib
sig = hmac.new(SECRET.encode(), body_bytes, hashlib.sha256).hexdigest()
```

```ts
import { createHmac } from "node:crypto";
const sig = createHmac("sha256", SECRET).update(body).digest("hex");
```

Reject any incoming request whose `X-Signature` doesn't match what
you computed locally. Use a constant-time comparison.

---

## 1. Endpoints WE expose (you call them)

### `POST /api/monitored/notify`

**You call this when you detect a new post / story / reel / mention
on a username we asked you to watch.**

Headers:

```
Content-Type: application/json
X-Signature: <hmac sha256 over the raw body>
```

Body:

```json
{
  "username": "natgeo",
  "kind": "story",
  "detectedAt": "2026-06-04T19:00:00Z",
  "hint": { "anything_you_want": true }
}
```

Fields:

| Field         | Type     | Required | Notes                                                                                       |
| ------------- | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `username`    | string   | yes      | lowercased Instagram handle without the `@`. Must match `^[a-z0-9._]+$`.                    |
| `kind`        | string   | yes      | one of `"story"`, `"post"`, `"reel"`, `"mentioned"`. Drives which HikerAPI endpoint we hit. |
| `detectedAt`  | ISO 8601 | optional | when YOU detected the change. We use it for logging only.                                   |
| `hint`        | object   | optional | passthrough. We log it and forward to debugging tools.                                      |

Successful response (`HTTP 200`):

```json
{
  "ok": true,
  "handled": true,
  "username": "natgeo",
  "kind": "story",
  "totalDetected": 3,
  "totalForwarded": 3,
  "tenants": [
    { "tenantId": 1, "detected": 3, "forwarded": 3, "errors": [] }
  ],
  "errors": []
}
```

If we no longer track this username (every tenant disabled or
deleted it) you still get `HTTP 200`:

```json
{
  "ok": true,
  "handled": false,
  "reason": "no enabled tenant tracks this username"
}
```

Treat `handled: false` as a signal to remove the username from your
watch list — we won't get any cheaper.

Error responses:

| Status | Meaning                                                                                |
| ------ | -------------------------------------------------------------------------------------- |
| 401    | bad or missing `X-Signature`.                                                          |
| 400    | malformed body / invalid username.                                                     |
| 503    | external monitor disabled or secret not configured. Retry after operator fixes it.     |
| 402    | upstream HikerAPI out of credits / approval needed. Surface to operator. Don't retry. |
| 5xx    | transient. Use exponential backoff (we retry up to 3× on our end too).                 |

Idempotency: repeated notifications for the same `(username, kind)`
within a few seconds are safe. We deduplicate downstream Telegram
posts via a `monitor_events` table — sending the same story twice
won't post twice in Telegram.

### `GET /api/monitored/notify/health`

**Public, no auth.** Used by you to check we're up.

```json
{
  "ok": true,
  "service": "tgsecretarybot",
  "notifyEndpoint": "/api/monitored/notify",
  "hasDb": true,
  "hikerConfigured": true,
  "externalMonitorEnabled": true,
  "secretConfigured": true,
  "time": "2026-06-04T19:00:00Z"
}
```

- `externalMonitorEnabled: false` → operator hasn't turned the
  integration on yet. Stop sending notifications.
- `secretConfigured: false` → we won't accept your notifications
  until operator pastes the secret in.
- `hikerConfigured: false` → we can't actually fetch even if you
  ping us. Operator needs to set a HikerAPI key.

---

## 2. Endpoints YOU expose (we call them)

These are the endpoints we need **you** to expose at
`{monitorExternalBaseUrl}`. We sign every request the same way.

### `GET /health`

Lightweight liveness probe. We poll this from the admin panel.

Expected response (`HTTP 200`):

```json
{
  "ok": true,
  "service": "ig-change-detector",
  "version": "1.0.0",
  "watching": 47,
  "uptimeSeconds": 12345
}
```

`watching` is informational — surface however many usernames are
currently registered.

### `POST /accounts`

We call this whenever an owner adds an Instagram username to the
monitor list (or when admin clicks "sync all").

Body:

```json
{
  "username": "natgeo",
  "kinds": {
    "stories": true,
    "posts": true,
    "reels": true,
    "mentioned": false
  }
}
```

- `username` is always lowercased.
- `kinds` is advisory — feel free to ignore and just watch
  everything. If you DO honor it, only ping us back for kinds the
  operator opted in to.
- This call is idempotent. Re-registering an existing username
  should be a no-op + refresh of any registration timestamp.

Expected response (`HTTP 200` or `HTTP 201`):

```json
{ "ok": true }
```

Any 4xx / 5xx is logged and surfaced in our admin UI. Operator can
hit "sync all" to retry.

### `DELETE /accounts/:username`

We call this when the LAST tenant tracking a username removes it.
Use it to stop polling that account.

`username` in the path is already lowercased.

Expected response (`HTTP 200` or `HTTP 204`):

```json
{ "ok": true }
```

If you've never heard of the username, return 200 anyway — don't
404 (we'll log it as a real error otherwise).

---

## Flow walkthrough

```
Owner adds @natgeo on /monitored
        │
        ▼
  POST /accounts {username: "natgeo", kinds: {...}}        ← we → you
        │
        ▼
You start polling @natgeo cheaply (web-scrape, RSS, etc.)
        │
        ▼
  (eventually) new story detected
        │
        ▼
  POST /api/monitored/notify                                ← you → us
   {username: "natgeo", kind: "story", detectedAt: "..."}
        │
        ▼
We run HikerAPI processAccount with kindOverrides={story: true}
and forward to the tenant's storage Telegram chat. Reply with
totalForwarded / totalDetected.

— meanwhile —

Admin clicks "🩺 health" on /admin → External monitor
        │
        ▼
  GET /health (HMAC signed)                                 ← we → you

Admin clicks "🔄 sync all" on /admin → External monitor
        │
        ▼
  POST /accounts × N (one per enabled monitored username)   ← we → you
```

---

## Sample Python (FastAPI) handler for `POST /api/monitored/notify`

```python
import hmac, hashlib, os, httpx
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET = os.environ["MONITOR_EXTERNAL_SECRET"].encode()
NOTIFY_URL = "https://your-tgsecretarybot.vercel.app/api/monitored/notify"

async def notify(username: str, kind: str):
    body = json.dumps({
        "username": username,
        "kind": kind,
        "detectedAt": datetime.utcnow().isoformat() + "Z",
    }, separators=(",", ":")).encode()
    sig = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient() as c:
        r = await c.post(
            NOTIFY_URL,
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Signature": sig,
            },
            timeout=30,
        )
    return r.json()
```

## Sample Python verification for `POST /accounts` (your side)

```python
@app.post("/accounts")
async def add_account(req: Request):
    raw = await req.body()
    sig = req.headers.get("x-signature", "")
    expected = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "bad signature")
    data = json.loads(raw)
    upsert_watch(data["username"], data.get("kinds", {}))
    return {"ok": True}
```

---

## Retry / backoff guidance

- **You → us** notify: retry on 5xx with exponential backoff
  (1s → 2s → 4s → 8s, then give up after ~5 attempts). 401/400/402
  are permanent for that request.
- **Us → you** register / unregister: we fire-and-forget. If the
  call fails it's logged and the admin sees it in the "subscriptions"
  list with the last status. Admin can "sync all" to retry.
- **Health checks**: timeout at 5s, treat any non-200 as down.

## Multi-tenancy note

A single Instagram username may be watched by **multiple tenants**
on our side (e.g. two owners both monitoring `@natgeo`). You don't
need to know about that — we keep a single subscription per
username and fan out across tenants on receipt. Every tenant gets
its own download to its own storage chat with its own HikerAPI
budget gate.
