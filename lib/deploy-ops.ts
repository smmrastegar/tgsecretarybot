// Deploy-box operations exposed over MCP.
//
// Why this exists: the app can reach its database and Telegram, but the
// box it runs on was a black box — the deploy pipeline's only output was
// /var/log/tgsecretarybot-autodeploy.log, which nothing could read. A
// self-heal that failed and one that never ran looked identical from
// outside, which is exactly how a broken Caddy vhost stayed broken
// through three deploys.
//
// Deliberately NOT a shell tool. Each function is a named, bounded
// operation with a fixed argv — there is no path from an MCP argument to
// a command string, so a leaked token can't turn into arbitrary RCE.
// These are full-access-only (absent from SCOPED_TOOLS in the MCP route).

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

const APP_DIR = "/opt/tgsecretarybot";
const DEPLOY_LOG = "/var/log/tgsecretarybot-autodeploy.log";
const CADDYFILE = "/etc/caddy/Caddyfile";

function run(
  cmd: string,
  argv: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      argv,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, cwd: APP_DIR },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: (stdout ?? "").toString(),
          stderr: (stderr ?? "").toString(),
        });
      },
    );
  });
}

async function tail(path: string, lines: number): Promise<string> {
  const r = await run("tail", ["-n", String(lines), path], 5_000);
  if (r.ok) return r.stdout.trimEnd();
  return `(unreadable: ${r.stderr.trim() || "no such file"})`;
}

export async function deployStatus(logLines = 40): Promise<{
  sha: string;
  branch: string;
  behindRemote: string;
  services: Record<string, string>;
  caddyWildcardVhost: boolean;
  caddyfileReadable: boolean;
  log: string;
}> {
  const n = Math.min(Math.max(1, Math.trunc(logLines) || 40), 200);
  const [sha, branch, remote, appSvc, caddySvc, timerSvc] = await Promise.all([
    run("git", ["rev-parse", "--short", "HEAD"], 5_000),
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], 5_000),
    run("git", ["rev-parse", "--short", "@{u}"], 5_000),
    run("systemctl", ["is-active", "tgsecretarybot"], 5_000),
    run("systemctl", ["is-active", "caddy"], 5_000),
    run("systemctl", ["is-active", "tgsecretarybot-autodeploy.timer"], 5_000),
  ]);
  let caddyfile = "";
  let caddyfileReadable = false;
  try {
    caddyfile = await readFile(CADDYFILE, "utf8");
    caddyfileReadable = true;
  } catch {
    /* not readable by this process — reported as false, not thrown */
  }
  return {
    sha: sha.stdout.trim() || "unknown",
    branch: branch.stdout.trim() || "unknown",
    behindRemote: remote.stdout.trim() || "unknown",
    services: {
      app: appSvc.stdout.trim() || "unknown",
      caddy: caddySvc.stdout.trim() || "unknown",
      autodeployTimer: timerSvc.stdout.trim() || "unknown",
    },
    caddyWildcardVhost: caddyfile.includes("managed:wildcard-vhost"),
    caddyfileReadable,
    log: await tail(DEPLOY_LOG, n),
  };
}

// Pull + build + restart right now instead of waiting for the 30s timer.
// Runs the SAME script the timer runs, so there is exactly one deploy
// path to reason about. The script takes its own flock, so a concurrent
// timer tick can't collide with this.
export async function deployNow(): Promise<{
  ok: boolean;
  output: string;
  status: Awaited<ReturnType<typeof deployStatus>>;
}> {
  const r = await run(
    "/bin/bash",
    [`${APP_DIR}/deploy/auto-deploy.sh`],
    240_000,
  );
  return {
    ok: r.ok,
    output: [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(Boolean).join("\n"),
    status: await deployStatus(30),
  };
}

// Ensure Caddy is actually SERVING the wildcard vhost — not merely that
// the block exists in the file. The first self-heal only checked for its
// own marker, so once the block was written but the reload failed, every
// later run skipped and the vhost stayed dead. This probes the running
// server and reports each step, so a failure names itself.
export async function caddyEnsureVhost(): Promise<Record<string, unknown>> {
  const trace: Record<string, unknown> = {};

  const unit = await run("systemctl", ["cat", "caddy"], 5_000);
  // Which config file the RUNNING service was started with — appending to
  // the wrong file would look exactly like a failed reload.
  trace.unitExecStart =
    unit.stdout
      .split("\n")
      .filter((l) => l.trim().startsWith("ExecStart"))
      .join(" | ") || "(unreadable)";

  let caddyfile = "";
  try {
    caddyfile = await readFile(CADDYFILE, "utf8");
  } catch (err) {
    trace.readError = err instanceof Error ? err.message : String(err);
    return trace;
  }
  trace.markerPresent = caddyfile.includes("managed:wildcard-vhost");

  const validate = await run(
    "caddy",
    ["validate", "--adapter", "caddyfile", "--config", CADDYFILE],
    20_000,
  );
  trace.validate = {
    ok: validate.ok,
    detail: (validate.stderr || validate.stdout).trim().slice(-600),
  };
  if (!validate.ok) return trace;

  const reload = await run("systemctl", ["reload", "caddy"], 30_000);
  trace.reload = {
    ok: reload.ok,
    detail: (reload.stderr || reload.stdout).trim().slice(-600),
  };
  if (!reload.ok) {
    // systemd only ever says "Job for caddy.service failed". Ask Caddy
    // itself — `caddy reload` talks to the admin API and prints the
    // actual reason — and take the journal tail as a second opinion.
    const direct = await run(
      "caddy",
      ["reload", "--adapter", "caddyfile", "--config", CADDYFILE],
      30_000,
    );
    trace.caddyReloadDirect = {
      ok: direct.ok,
      detail: (direct.stderr || direct.stdout).trim().slice(-1200),
    };
    const journal = await run(
      "journalctl",
      ["-u", "caddy", "-n", "25", "--no-pager", "-o", "cat"],
      15_000,
    );
    trace.journalTail = journal.stdout.trim().slice(-1500) || "(empty)";
  }

  // The real test: does an arbitrary *.text.bz name reach the app? 401 is
  // the app answering (deploy-status rejects an unauthenticated POST), so
  // it proves the wildcard vhost matched and proxied.
  const probe = await run(
    "curl",
    [
      "-sk", "-m", "8", "-o", "/dev/null", "-w", "%{http_code}",
      "--resolve", "probe.text.bz:443:127.0.0.1",
      "-X", "POST", "https://probe.text.bz/api/deploy-status",
    ],
    15_000,
  );
  trace.probeHttpCode = probe.stdout.trim() || `(curl failed: ${probe.stderr.trim()})`;
  trace.serving = probe.stdout.trim() === "401";
  return trace;
}
