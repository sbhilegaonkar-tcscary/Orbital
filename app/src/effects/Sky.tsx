import { useMemo } from 'react';

/**
 * Bridge-only animated background. Mounted by AppShell only when
 * mode === 'bridge'; unmounting tears everything down (no timers, just CSS
 * animations that stop existing). Three drifting nebula clouds, two
 * parallax star layers, and one shooting star. Star positions are generated
 * once with a fixed seed so the sky is identical on every load.
 */

const SEED = 7;

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function starField(rng: () => number, count: number, w: number, h: number, maxSize: number): string {
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(rng() * w);
    const y = Math.round(rng() * h);
    const size = (rng() * maxSize).toFixed(1);
    const alpha = Math.round((0.35 + rng() * 0.65) * 100);
    shadows.push(`${x}px ${y}px 0 ${size}px color-mix(in srgb, var(--text) ${alpha}%, transparent)`);
  }
  return shadows.join(',');
}

export function Sky() {
  const { farShadow, nearShadow } = useMemo(() => {
    const rng = makeRng(SEED);
    const w = Math.max(typeof window !== 'undefined' ? window.innerWidth : 1600, 1600) * 1.2;
    const h = Math.max(typeof window !== 'undefined' ? window.innerHeight : 1000, 1000) * 1.2;
    return {
      farShadow: starField(rng, 220, w, h, 0.6),
      nearShadow: starField(rng, 70, w, h, 1.1),
    };
  }, []);

  return (
    <div className="sky" aria-hidden="true">
      <div className="sky-cloud sky-cloud-1" />
      <div className="sky-cloud sky-cloud-2" />
      <div className="sky-cloud sky-cloud-3" />
      <div className="sky-stars sky-stars-far" style={{ boxShadow: farShadow }} />
      <div className="sky-stars sky-stars-near" style={{ boxShadow: nearShadow }} />
      <div className="sky-streak" />
    </div>
  );
}
