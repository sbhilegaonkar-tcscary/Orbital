/**
 * Session store tests: the connect retry loop.
 *
 * No server and no real clock. A fake provider from `session/testing.ts` is
 * injected through `setProviderFactory` and made to fail on demand, and
 * `vi.useFakeTimers()` drives the backoff so the 120 s retry window costs
 * milliseconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETRY_WINDOW_MS, setProviderFactory, useSessionStore } from './store';
import { makeFakeProvider } from './testing';
import type { SessionProvider } from './types';

const session = () => useSessionStore.getState();

/** Lets every pending microtask (and zero-delay timer) settle. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** A provider whose connect() rejects with `error()` and counts the calls. */
function failingProvider(error: (call: number) => Error): {
  provider: SessionProvider;
  calls: () => number;
} {
  let calls = 0;
  const provider = makeFakeProvider({
    connect: async () => {
      calls += 1;
      throw error(calls);
    },
  });
  return { provider, calls: () => calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({
    connection: 'disconnected',
    error: null,
    provider: null,
    attempt: null,
    kernelStatus: 'disconnected',
    kernelName: null,
  });
});

afterEach(() => {
  // Park any loop still running before the clock goes back to real time.
  session().cancelConnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProviderFactory();
});

describe('connect() retry loop', () => {
  it('stays connecting across failures and lands connected', async () => {
    let calls = 0;
    const provider = makeFakeProvider({
      connect: async () => {
        calls += 1;
        if (calls <= 3) throw new Error('connect ECONNREFUSED 127.0.0.1:8888');
      },
    });
    setProviderFactory(() => provider);

    const done = session().connect();
    expect(session().connection).toBe('connecting');

    // Backoff after failures 1..3 is 750, 1200 and 1920 ms.
    await flush();
    expect(session().connection).toBe('connecting');
    await vi.advanceTimersByTimeAsync(800);
    expect(session().connection).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1300);
    expect(session().connection).toBe('connecting');

    await vi.advanceTimersByTimeAsync(2000);
    await done;

    expect(calls).toBe(4);
    expect(session().connection).toBe('connected');
    expect(session().provider).toBe(provider);
    expect(session().error).toBeNull();
    expect(session().attempt).toBeNull();
  });

  it('advances attempt.tries and attempt.lastError on every failure', async () => {
    const { provider } = failingProvider((call) => new Error(`boom ${call}`));
    setProviderFactory(() => provider);

    void session().connect();
    expect(session().attempt).toMatchObject({ tries: 1, lastError: null });

    await flush();
    expect(session().attempt).toMatchObject({ tries: 2, lastError: 'boom 1' });

    await vi.advanceTimersByTimeAsync(800);
    expect(session().attempt).toMatchObject({ tries: 3, lastError: 'boom 2' });

    await vi.advanceTimersByTimeAsync(1300);
    expect(session().attempt).toMatchObject({ tries: 4, lastError: 'boom 3' });
    expect(session().connection).toBe('connecting');
  });

  it('cancelConnect() disconnects and ignores a late success from the old loop', async () => {
    let settle!: () => void;
    const provider = makeFakeProvider({
      connect: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    });
    setProviderFactory(() => provider);

    void session().connect();
    await flush();
    expect(session().connection).toBe('connecting');

    session().cancelConnect();
    expect(session().connection).toBe('disconnected');
    expect(session().attempt).toBeNull();
    expect(session().error).toBeNull();

    // The attempt that was in flight finally succeeds: it must not write.
    settle();
    await flush();
    expect(session().connection).toBe('disconnected');
    expect(session().provider).toBeNull();
  });

  it('stops immediately on a hard error', async () => {
    const message =
      'Jupyter Server at http://localhost:8888 rejected the token (HTTP 403). Check the token in Settings.';
    const { provider, calls } = failingProvider(() => new Error(message));
    setProviderFactory(() => provider);

    await session().connect();

    expect(calls()).toBe(1);
    expect(session().connection).toBe('error');
    expect(session().error).toBe(message);
    expect(session().attempt).toBeNull();
  });

  it('gives up once the retry window is exhausted', async () => {
    const { provider, calls } = failingProvider(() => new Error('connect ECONNREFUSED'));
    setProviderFactory(() => provider);

    const done = session().connect();
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS + 10_000);
    await done;

    expect(calls()).toBeGreaterThan(5);
    expect(session().connection).toBe('error');
    expect(session().error).toBe('Jupyter did not answer at http://localhost:8888 for 120 s');
    expect(session().attempt).toBeNull();
  });

  it('disconnect() clears the autoconnect flag a successful connect set', async () => {
    const cells = new Map<string, string>();
    const fake: Storage = {
      get length() {
        return cells.size;
      },
      clear: () => cells.clear(),
      getItem: (key: string) => cells.get(key) ?? null,
      key: (index: number) => [...cells.keys()][index] ?? null,
      removeItem: (key: string) => {
        cells.delete(key);
      },
      setItem: (key: string, value: string) => {
        cells.set(key, value);
      },
    };
    vi.stubGlobal('localStorage', fake);
    setProviderFactory(() => makeFakeProvider());

    await session().connect();
    expect(session().connection).toBe('connected');
    expect(cells.get('orbital.autoconnect')).toBe('1');

    await session().disconnect();
    expect(session().connection).toBe('disconnected');
    expect(cells.has('orbital.autoconnect')).toBe(false);
  });
});
