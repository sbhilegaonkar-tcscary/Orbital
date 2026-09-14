/**
 * Dockable agent panel (docs/ARCHITECTURE.md "Agent harness (M7)"): header
 * strip (connection, model, cost, menu), then either a "not connected"
 * state, `AuthGate`, or the transcript + prompt box.
 *
 * `?agentdemo=1` / `?agentdemo=auth` override the live store's rendered
 * state with the canned data in `demo.ts`, for headless screenshots and
 * manual review without a running sidecar — see the M7-B report for how
 * this was verified before `./store` existed.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AgentBlock } from './protocol';
import { useAgentStore, type AgentState, type TranscriptItem } from './store';
import { AuthGate, CommandBox } from './AuthGate';
import { ToolCard } from './ToolCard';
import { PermissionBar } from './PermissionBar';
import { DEMO_AUTH_LOGGED_OUT, DEMO_PENDING_PERMISSION, DEMO_TRANSCRIPT, EXAMPLE_PROMPTS } from './demo';
import './agent.css';

const PROMPT_MAX_LINES = 6;
const TEXTAREA_LINE_HEIGHT_PX = 18;
const TEXTAREA_VERTICAL_PADDING_PX = 14;
/** Shown in the not-running view's command box; matches the message `store.ts` builds around `AGENT_DEFAULT_URL`. */
const SIDECAR_START_COMMAND = 'scripts/agent.ps1';

const DEMO_STATE_1: Partial<AgentState> = {
  connection: 'connected',
  auth: { loggedIn: true, loginCommand: 'claude login' },
  cwd: '/workspace',
  model: 'claude-sonnet-5',
  transcript: DEMO_TRANSCRIPT,
  runStatus: 'waiting_permission',
  currentRunId: 'demo-run-1',
  pendingPermission: DEMO_PENDING_PERMISSION,
  totalCostUsd: 0.0123,
  alwaysAllow: ['orbital_read_notebook'],
};

const DEMO_STATE_AUTH: Partial<AgentState> = {
  connection: 'connected',
  auth: DEMO_AUTH_LOGGED_OUT,
  cwd: null,
  model: null,
  transcript: [],
  runStatus: 'idle',
  currentRunId: null,
  pendingPermission: null,
  totalCostUsd: 0,
  alwaysAllow: [],
};

function useDemoOverride(): Partial<AgentState> | null {
  return useMemo(() => {
    const demo = new URLSearchParams(window.location.search).get('agentdemo');
    if (demo === '1') return DEMO_STATE_1;
    if (demo === 'auth') return DEMO_STATE_AUTH;
    return null;
  }, []);
}

/**
 * Header dot per the spec: muted disconnected, warning connecting, success
 * connected+logged-in, warning connected-but-not-logged-in, danger error.
 * `title` carries the exact state text (the connection error, or the
 * "reconnecting…" message, when there is one).
 */
function connectionDotInfo(state: AgentState): { cls: string; title: string } {
  switch (state.connection) {
    case 'error':
      return { cls: 'danger', title: state.error ?? 'Agent sidecar connection error.' };
    case 'connecting':
      return { cls: 'warning', title: state.error ?? 'Connecting to the agent sidecar…' };
    case 'connected':
      return state.auth && !state.auth.loggedIn
        ? { cls: 'warning', title: 'Connected to the agent sidecar — not logged in.' }
        : { cls: 'success', title: 'Connected to the agent sidecar.' };
    default:
      return { cls: 'muted', title: 'Not connected to the agent sidecar.' };
  }
}

function statusText(state: AgentState, elapsedS: number): string {
  switch (state.runStatus) {
    case 'idle':
      return 'idle';
    case 'running':
      return `running · ${elapsedS} s`;
    case 'waiting_permission':
      return 'waiting for permission';
    case 'waiting_tool':
      return 'waiting for tool';
    case 'error':
      return state.error ?? 'error';
    default:
      return '';
  }
}

/** Injects a copy button into every `<pre><code>` block for the click-delegation in `AssistantMarkdown`. */
function withCodeCopyButtons(html: string): string {
  return html.replace(/<pre>(<code[^>]*>)/g, '<pre><button type="button" class="agent-copy-btn">Copy</button>$1');
}

function AssistantMarkdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string;
    return withCodeCopyButtons(DOMPurify.sanitize(raw));
  }, [text]);

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const btn = (e.target as HTMLElement).closest('.agent-copy-btn');
    if (!btn) return;
    const codeText = btn.closest('pre')?.querySelector('code')?.textContent ?? '';
    void navigator.clipboard?.writeText(codeText);
  }

  return (
    <div
      className="agent-markdown"
      onClick={handleClick}
      // Sanitized just above; markdown source, not raw HTML (same pattern as notebook/Output.tsx).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ThinkingBlock({ text }: { text: string }) {
  return (
    <details className="agent-thinking">
      <summary>thinking</summary>
      <div className="agent-thinking-body">{text}</div>
    </details>
  );
}

function TranscriptItemView({ item }: { item: TranscriptItem }) {
  if (item.role === 'user') {
    return (
      <div className="agent-msg agent-msg-user">
        <div className="agent-bubble">
          {item.blocks.map((b, i) => (b.kind === 'text' ? <span key={i}>{b.text}</span> : null))}
        </div>
      </div>
    );
  }

  if (item.role === 'system') {
    return (
      <div className="agent-msg agent-msg-system">
        {item.blocks.map((b, i) => (b.kind === 'text' ? <span key={i}>{b.text}</span> : null))}
      </div>
    );
  }

  const resultsByToolUseId = new Map<string, Extract<AgentBlock, { kind: 'tool_result' }>>();
  for (const b of item.blocks) if (b.kind === 'tool_result') resultsByToolUseId.set(b.toolUseId, b);

  return (
    <div className="agent-msg agent-msg-assistant">
      {item.blocks
        .filter((b) => b.kind !== 'tool_result')
        .map((b, i) => {
          if (b.kind === 'text') return <AssistantMarkdown key={i} text={b.text} />;
          if (b.kind === 'thinking') return <ThinkingBlock key={i} text={b.text} />;
          if (b.kind === 'tool_use') return <ToolCard key={i} block={b} result={resultsByToolUseId.get(b.id)} />;
          return null;
        })}
      {item.streamingText !== undefined && (
        <div className="agent-streaming">
          <AssistantMarkdown text={item.streamingText} />
          <span className="agent-caret" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="agent-empty-state">
      <p className="agent-empty-hint">Try asking:</p>
      <div className="agent-chip-row">
        {EXAMPLE_PROMPTS.map((p) => (
          <button key={p} type="button" className="agent-chip" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentMenu({ state, onClose }: { state: AgentState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // `alwaysAllow` is a plain string[] in AgentState with no dedicated
  // removal method in the store contract (only `answerPermission(...,
  // remember)` adds to it) — go through zustand's own setState rather than
  // inventing a method outside that contract.
  function removeAlwaysAllow(tool: string) {
    useAgentStore.setState((s) => ({ alwaysAllow: s.alwaysAllow.filter((t) => t !== tool) }));
  }

  return (
    <div className="agent-menu" ref={ref}>
      <button
        type="button"
        className="agent-menu-item"
        onClick={() => {
          state.clearConversation();
          onClose();
        }}
      >
        Clear conversation
      </button>
      <button
        type="button"
        className="agent-menu-item"
        onClick={() => {
          state.disconnect();
          state.connect();
          onClose();
        }}
      >
        Reconnect
      </button>
      <button
        type="button"
        className="agent-menu-item"
        onClick={() => {
          const next = window.prompt('Sidecar URL', state.url);
          if (next && next !== state.url) {
            state.setUrl(next);
            state.connect();
          }
          onClose();
        }}
      >
        Set sidecar URL…
      </button>
      <div className="agent-menu-section">
        <div className="agent-menu-label">Always allow</div>
        {state.alwaysAllow.length === 0 ? (
          <div className="agent-menu-empty">None</div>
        ) : (
          state.alwaysAllow.map((tool) => (
            <div key={tool} className="agent-menu-allow-row">
              <span className="agent-menu-allow-name">{tool}</span>
              <button
                type="button"
                className="agent-menu-allow-remove"
                aria-label={`Remove ${tool} from always-allow`}
                onClick={() => removeAlwaysAllow(tool)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function AgentPanel() {
  const live = useAgentStore();
  const demoOverride = useDemoOverride();
  const state: AgentState = demoOverride ? { ...live, ...demoOverride } : live;

  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const runStartRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const running = state.runStatus === 'running' || state.runStatus === 'waiting_tool';
  const lastItem = state.transcript[state.transcript.length - 1];

  useEffect(() => {
    if (state.runStatus !== 'running') {
      runStartRef.current = null;
      setElapsedS(0);
      return;
    }
    if (runStartRef.current === null) runStartRef.current = Date.now();
    const start = runStartRef.current;
    const iv = window.setInterval(() => setElapsedS(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(iv);
  }, [state.runStatus, state.currentRunId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.transcript, lastItem?.streamingText, lastItem?.blocks.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = TEXTAREA_LINE_HEIGHT_PX * PROMPT_MAX_LINES + TEXTAREA_VERTICAL_PADDING_PX;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [draft]);

  function handleTranscriptScroll() {
    const el = transcriptRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    state.send(text);
    setDraft('');
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  function renderBody() {
    if (state.connection === 'disconnected') {
      return (
        <div className="agent-empty">
          <p className="agent-empty-text">Not connected to the agent sidecar.</p>
          <button type="button" className="agent-connect-btn" onClick={() => state.connect()}>
            Connect
          </button>
        </div>
      );
    }

    if (state.connection === 'connecting') {
      return (
        <div className="agent-empty">
          <span className="agent-spinner" aria-hidden="true" />
          <p className="agent-empty-text">{state.error ?? 'Connecting to sidecar…'}</p>
          <button type="button" className="agent-connect-btn" onClick={() => state.retryNow()}>
            Retry
          </button>
        </div>
      );
    }

    if (state.connection === 'error') {
      return (
        <div className="agent-empty">
          <p className="agent-empty-text">{state.error}</p>
          <div className="agent-notrunning-cmd">
            <CommandBox command={SIDECAR_START_COMMAND} />
          </div>
          <button type="button" className="agent-connect-btn" onClick={() => state.retryNow()}>
            Retry
          </button>
        </div>
      );
    }

    if (state.auth && !state.auth.loggedIn) {
      return <AuthGate auth={state.auth} />;
    }

    return (
      <>
        <div className="agent-transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
          {state.transcript.length === 0 ? (
            <EmptyState onPick={setDraft} />
          ) : (
            state.transcript.map((item) => <TranscriptItemView key={item.id} item={item} />)
          )}
        </div>
        {state.pendingPermission && (
          <PermissionBar
            pending={state.pendingPermission}
            onAllow={() => state.answerPermission(true)}
            onAlwaysAllow={() => state.answerPermission(true, true)}
            onDeny={() => state.answerPermission(false)}
          />
        )}
        <div className="agent-prompt">
          <textarea
            ref={textareaRef}
            className="agent-textarea"
            value={draft}
            placeholder="Ask the agent…"
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
          />
          <div className="agent-prompt-row">
            <label className="agent-toggle">
              <input
                type="checkbox"
                checked={state.includeNotebook}
                onChange={(e) => state.setInclude('notebook', e.target.checked)}
              />
              notebook
            </label>
            <label className="agent-toggle">
              <input
                type="checkbox"
                checked={state.includeSelectedCell}
                onChange={(e) => state.setInclude('cell', e.target.checked)}
              />
              selected cell
            </label>
            <button
              type="button"
              className={`agent-send-btn${running ? ' agent-send-btn-stop' : ''}`}
              disabled={!running && draft.trim() === ''}
              onClick={running ? () => state.interrupt() : handleSend}
            >
              {running ? 'Stop' : 'Send'}
            </button>
          </div>
          <div className="agent-status-line">{statusText(state, elapsedS)}</div>
        </div>
      </>
    );
  }

  const dot = connectionDotInfo(state);

  return (
    <div className="agent-panel">
      <div className="agent-header">
        <span className={`agent-dot agent-dot-${dot.cls}`} title={dot.title} aria-hidden="true" />
        <span className="agent-model">{state.model ?? '—'}</span>
        <span className="agent-cost">${state.totalCostUsd.toFixed(4)}</span>
        <div className="agent-menu-wrap">
          <button type="button" className="agent-menu-btn" aria-label="Agent menu" onClick={() => setMenuOpen((o) => !o)}>
            ⋯
          </button>
          {menuOpen && <AgentMenu state={state} onClose={() => setMenuOpen(false)} />}
        </div>
      </div>
      {renderBody()}
    </div>
  );
}
