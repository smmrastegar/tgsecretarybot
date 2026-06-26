# MCP — data-analysis connection

The bot exposes its Postgres database over the [Model Context
Protocol](https://modelcontextprotocol.io) at:

```
https://<your-app>.vercel.app/api/mcp
```

Transport is **stateless Streamable HTTP** (each call is one JSON-RPC
POST). Auth is a single bearer token.

## 1. Set the secret

Add an env var in Vercel (Project → Settings → Environment Variables),
then redeploy:

```
MCP_SECRET=<a long random string>
```

Generate one with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Until `MCP_SECRET` is set the endpoint refuses every request (401).

## 2. Tools

| Tool | What it does |
|------|--------------|
| `list_tables` | every public table + row-count estimate — start here |
| `describe_table` | columns of one table (name, type, nullable, default) |
| `query` | **read-only** SQL (SELECT / WITH / EXPLAIN / SHOW). Single statement, write keywords rejected, capped at 2000 rows |
| `execute` | **write** SQL (INSERT / UPDATE / DELETE / DDL). Requires `confirm=true`. Mutates production — not reversible |

Key tables: `messages_log`, `chat_rules`, `chat_members`,
`forum_topics`, `group_analytics`, `ai_usage`, `note_watch_items`,
`sms_webhooks`.

## 3. Connect

### Claude Desktop / Claude.ai (remote connector)

Settings → Connectors → Add custom connector:

- **URL**: `https://<your-app>.vercel.app/api/mcp`
- **Authorization**: paste `Bearer <MCP_SECRET>` if asked for a header,
  or the token alone if the field is labelled "token".

### Cursor / VS Code / mcp-remote

`~/.cursor/mcp.json` (or the VS Code MCP config):

```json
{
  "mcpServers": {
    "tgsecretarybot": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://<your-app>.vercel.app/api/mcp",
        "--header", "Authorization: Bearer ${MCP_SECRET}"
      ],
      "env": { "MCP_SECRET": "<your secret>" }
    }
  }
}
```

Clients that speak Streamable HTTP natively can point straight at the
URL with an `Authorization: Bearer <secret>` header — no `mcp-remote`
needed.

## 4. Quick smoke test

```bash
curl -s https://<your-app>.vercel.app/api/mcp \
  -H "Authorization: Bearer $MCP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```
