/**
 * Login probe for the ORBITAL agent sidecar.
 *
 * ORBITAL runs the agent on the user's Claude login, never an API key. This
 * module never reads, writes, forwards or prompts for a credential: it asks
 * the Claude Code runtime that ships inside the Agent SDK whether a login
 * exists, and hands the UI the exact command to create one if not.
 *
 * Two stages, cheapest first:
 *   1. `claude auth status --json` — free, instant, and unambiguous about
 *      whether any credential is on disk.
 *   2. only when stage 1 says yes: a one-turn `query()` with no tools, which
 *      is the only way to learn that a stored OAuth session is dead (the
 *      refresh token expired) rather than missing.
 *
 * The answer is cached for five minutes so reconnecting panels are free.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * How the user logs in. `npx` is deliberate: ORBITAL must not require a
 * global Claude Code install, and this package's bundled binary writes the
 * same `~/.claude/.credentials.json` the SDK reads. `auth login` defaults to
 * `--claudeai`, the Claude subscription flow, which is what we want.
 */
export const LOGIN_COMMAND = 'npx -y @anthropic-ai/claude-code@latest auth login';

const CACHE_MS = 5 * 60 * 1000;
const STATUS_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 60_000;

/** Substrings that mean "this failed because nobody is logged in". */
const AUTH_HINTS = ['authenticat', 'oauth', 'log in', 'login', 'credential', 'unauthorized'];

function looksLikeAuthFailure(text) {
  const lower = String(text ?? '').toLowerCase();
  return AUTH_HINTS.some((hint) => lower.includes(hint));
}

// ---- locating the bundled Claude Code runtime -----------------------------

const require_ = createRequire(import.meta.url);

/**
 * The SDK ships its runtime as a per-platform optional dependency installed
 * beside it (`@anthropic-ai/claude-agent-sdk-win32-x64`, ...). We resolve the
 * SDK, then look for its sibling. Falls back to whatever `claude` is on PATH.
 */
function resolveClaudeBinary() {
  if (process.env.ORBITAL_CLAUDE_BIN) return process.env.ORBITAL_CLAUDE_BIN;

  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const suffixes =
    process.platform === 'linux'
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`];

  let sdkDir = null;
  try {
    sdkDir = path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk'));
  } catch {
    sdkDir = null;
  }

  if (sdkDir) {
    const scope = path.dirname(sdkDir);
    for (const suffix of suffixes) {
      const candidate = path.join(scope, `claude-agent-sdk-${suffix}`, exe);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'claude';
}

let claudeBinary = null;

/** Path the probe will run. Exported so the server can log it once at boot. */
export function claudeBinaryPath() {
  claudeBinary ??= resolveClaudeBinary();
  return claudeBinary;
}

function runClaude(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      claudeBinaryPath(),
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

// ---- stage 1: is there a credential at all? -------------------------------

/**
 * @returns {Promise<{ ok: true, loggedIn: boolean, authMethod: string } | { ok: false, reason: string }>}
 */
async function readAuthStatus() {
  const { err, stdout, stderr } = await runClaude(['auth', 'status', '--json'], STATUS_TIMEOUT_MS);
  if (err && !stdout) {
    return { ok: false, reason: (stderr || err.message).trim() };
  }
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed?.loggedIn !== 'boolean') {
      return { ok: false, reason: 'claude auth status returned no loggedIn field' };
    }
    return { ok: true, loggedIn: parsed.loggedIn, authMethod: parsed.authMethod ?? 'unknown' };
  } catch {
    return { ok: false, reason: 'claude auth status returned unparseable output' };
  }
}

// ---- stage 2: do the stored credentials still work? -----------------------

/**
 * One turn, no tools, a trivial prompt. Classifies the outcome rather than
 * caring about the answer. `persistSession: false` keeps probes out of the
 * user's session history.
 *
 * @param {string} cwd
 * @returns {Promise<{ loggedIn: boolean, reason?: string }>}
 */
async function probeWithQuery(cwd) {
  let query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch (err) {
    return { loggedIn: false, reason: `Could not load the Claude Agent SDK: ${err.message}` };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);

  try {
    const run = query({
      prompt: 'Reply with the single word: ok',
      options: {
        cwd,
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'default',
        persistSession: false,
        settingSources: [],
        systemPrompt: 'Answer in one word.',
        abortController: abort,
      },
    });

    let failure = null;
    for await (const message of run) {
      if (message.type === 'assistant' && message.error) {
        // SDKAssistantMessageError; 'authentication_failed' is the exact signal.
        if (message.error === 'authentication_failed' || message.error === 'oauth_org_not_allowed') {
          return { loggedIn: false, reason: `Claude reported ${message.error}.` };
        }
        failure = `Claude reported ${message.error}.`;
      }
      if (message.type === 'result') {
        if (message.is_error || message.subtype !== 'success') {
          const text = message.result ?? (message.errors ?? []).join('; ') ?? message.subtype;
          if (looksLikeAuthFailure(text)) return { loggedIn: false, reason: String(text).trim() };
          // A non-auth failure still proves the credentials were accepted.
          return { loggedIn: true };
        }
        return { loggedIn: true };
      }
    }
    return failure && looksLikeAuthFailure(failure)
      ? { loggedIn: false, reason: failure }
      : { loggedIn: true };
  } catch (err) {
    const text = err?.message ?? String(err);
    if (looksLikeAuthFailure(text)) return { loggedIn: false, reason: text.trim() };
    return { loggedIn: false, reason: `The login probe failed: ${text}` };
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

// ---- public API -----------------------------------------------------------

let cached = null;
let cachedAt = 0;

/**
 * @param {{ cwd: string, force?: boolean }} params
 * @returns {Promise<{ loggedIn: boolean, reason?: string, loginCommand: string }>}
 *   Shaped exactly like `AuthStatus` in `app/src/agent/protocol.ts`.
 */
export async function probeAuth({ cwd, force = false }) {
  if (process.env.ORBITAL_AGENT_FAKE === '1') {
    return { loggedIn: true, loginCommand: LOGIN_COMMAND };
  }
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const status = await readAuthStatus();

  let result;
  if (status.ok && !status.loggedIn) {
    result = {
      loggedIn: false,
      reason: 'No Claude login was found on this machine.',
      loginCommand: LOGIN_COMMAND,
    };
  } else if (status.ok) {
    // A credential exists; only a real request proves it still works.
    const probe = await probeWithQuery(cwd);
    result = probe.loggedIn
      ? { loggedIn: true, loginCommand: LOGIN_COMMAND }
      : { loggedIn: false, reason: probe.reason, loginCommand: LOGIN_COMMAND };
  } else {
    // The status command itself is unavailable: fall back to the live probe
    // rather than guessing, so a broken install never reads as "logged in".
    const probe = await probeWithQuery(cwd);
    result = probe.loggedIn
      ? { loggedIn: true, loginCommand: LOGIN_COMMAND }
      : {
          loggedIn: false,
          reason: probe.reason ?? status.reason,
          loginCommand: LOGIN_COMMAND,
        };
  }

  cached = result;
  cachedAt = Date.now();
  return result;
}

/** Drops the cache; the next `probeAuth` re-runs both stages. */
export function resetAuthCache() {
  cached = null;
  cachedAt = 0;
}
