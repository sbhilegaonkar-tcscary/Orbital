/**
 * Sandboxes a `text/html` output that carries executable content (Plotly,
 * Bokeh, Altair, folium and friends all emit a `<script>` tag) inside
 * `<iframe sandbox="allow-scripts" srcdoc=…>`. The iframe gets a copy of the
 * current theme tokens as inline CSS variables (read once, at render time,
 * via `getComputedStyle`) so the embedded content isn't stuck on browser
 * defaults, and a small script that reports its content height back to us.
 *
 * Message protocol: the srcdoc page posts `{ type: 'orbital:height', height
 * }` to `parent` on load and whenever a `ResizeObserver` sees
 * `document.body` change size. A single module-level `message` listener
 * looks up the sender via `event.source === iframe.contentWindow` (each
 * frame also carries a `data-frame-id` for inspection/debugging) and clamps
 * the reported height to [40, 2000]px; taller content scrolls inside the
 * frame instead of growing further.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { TOKEN_NAMES } from '../theme/tokens';

const RISKY_HTML_PATTERN = /<\s*(script|iframe|object|embed)\b|on[a-z]+\s*=/i;

/**
 * True when `raw` needs the sandboxed iframe path rather than the plain
 * DOMPurify path: it contains a `<script>`, `<iframe>`, `<object>`,
 * `<embed>`, or an `on*=` event-handler attribute — i.e. anything DOMPurify's
 * default config would strip, making the sanitized output differ from the
 * raw output in a way that would break the visualization.
 */
export function needsSandbox(raw: string): boolean {
  return RISKY_HTML_PATTERN.test(raw);
}

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 2000;

type HeightSetter = (height: number) => void;

const frameRegistry = new Map<Window, HeightSetter>();
let listenerAttached = false;

function ensureListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; height?: unknown } | null;
    if (!data || data.type !== 'orbital:height' || typeof data.height !== 'number') return;
    const setHeight = frameRegistry.get(event.source as Window);
    setHeight?.(data.height);
  });
}

function buildSrcDoc(html: string): string {
  const computed = getComputedStyle(document.documentElement);
  const vars = TOKEN_NAMES.map((name) => `--${name}: ${computed.getPropertyValue(`--${name}`).trim()};`).join('\n      ');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
    ${vars}
    color-scheme: light dark;
  }
  html, body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13px;
  }
</style>
</head>
<body>
${html}
<script>
(function () {
  function postHeight() {
    var height = document.body.scrollHeight;
    parent.postMessage({ type: 'orbital:height', height: height }, '*');
  }
  window.addEventListener('load', postHeight);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(postHeight).observe(document.body);
  } else {
    setTimeout(postHeight, 50);
  }
  postHeight();
})();
</script>
</body>
</html>`;
}

export interface OutputFrameProps {
  html: string;
}

export function OutputFrame({ html }: OutputFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const frameId = useId();
  const doc = useMemo(() => buildSrcDoc(html), [html]);

  useEffect(() => {
    ensureListener();
    setHeight(MIN_HEIGHT);
    const iframe = iframeRef.current;
    const contentWindow = iframe?.contentWindow;
    if (!contentWindow) return;
    frameRegistry.set(contentWindow, (h) => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h))));
    return () => {
      frameRegistry.delete(contentWindow);
    };
  }, [doc]);

  return (
    <iframe
      ref={iframeRef}
      className="cell-output-frame"
      data-frame-id={frameId}
      title="notebook output"
      sandbox="allow-scripts"
      srcDoc={doc}
      style={{ width: '100%', border: 'none', display: 'block', height }}
    />
  );
}
