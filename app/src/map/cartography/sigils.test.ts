/**
 * The sigil contract. Three things matter and none of them is taste: a face
 * never leaves its disc, the same name always draws the same face, and every
 * mark says which CSS class paints it rather than carrying a colour.
 */
import { describe, expect, it } from 'vitest';

import { seededRng } from '../model';
import {
  CHARACTERS,
  PATTERN_KEYS,
  SIGIL_FAMILIES,
  characterIndex,
  characterOf,
  familyIndex,
  familyOf,
  orreryRunes,
  orreryTicks,
  paintedWorld,
  paperSigil,
  runeGlyph,
  starSigil,
  terminatorPath,
  type Mark,
} from './sigils';

const NAMES = [
  'experiments',
  'data',
  'rigs',
  'archive',
  'sweeps',
  'plots',
  'logs',
  'raw',
  '.ipynb_checkpoints',
  'a',
  'notebooks-2026',
  'very-long-folder-name-that-someone-typed',
];

/** Every coordinate a mark mentions, including the numbers inside a `d`. */
function numbersIn(mark: Mark): number[] {
  if (mark.k === 'circle') return [mark.cx, mark.cy, mark.r];
  if (mark.k === 'ellipse') return [mark.cx, mark.cy, mark.rx, mark.ry];
  if (mark.k === 'line') return [mark.x1, mark.y1, mark.x2, mark.y2];
  return (mark.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/** A line never carries a pattern; everything else may. */
function fillOf(mark: Mark): string | undefined {
  return mark.k === 'line' ? undefined : mark.fill;
}

function classesOf(marks: Mark[]): string[] {
  return marks.flatMap((mark) => mark.cls.split(' '));
}

describe('which face', () => {
  it('is stable for a name and spread across the five', () => {
    expect(characterOf('experiments')).toBe(characterOf('experiments'));
    expect(familyOf('experiments')).toBe(familyOf('experiments'));

    const characters = new Set<number>();
    const families = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      characters.add(characterIndex(`folder-${i}`));
      families.add(familyIndex(`folder-${i}`));
    }
    expect(characters.size).toBe(CHARACTERS.length);
    expect(families.size).toBe(SIGIL_FAMILIES.length);
  });

  it('does not lock the paper family to the bridge character', () => {
    // If the two hashes agreed, switching modes would repaint the same map.
    let disagreements = 0;
    for (let i = 0; i < 100; i += 1) {
      if (characterIndex(`folder-${i}`) !== familyIndex(`folder-${i}`)) disagreements += 1;
    }
    expect(disagreements).toBeGreaterThan(50);
  });
});

describe('paintedWorld', () => {
  it('draws the same world twice', () => {
    for (const name of NAMES) {
      expect(paintedWorld(name, 60)).toEqual(paintedWorld(name, 60));
    }
  });

  it('keeps the paint inside the clip, allowing for the bands that bleed', () => {
    for (const name of NAMES) {
      const R = 70;
      const painted = paintedWorld(name, R);
      for (const mark of painted.marks) {
        for (const n of numbersIn(mark)) {
          // Latitude bands and ring systems are drawn wider than the disc on
          // purpose: the clip path is what cuts them, exactly as the mockup
          // does it. What this guards is a generator that runs away entirely.
          expect(Math.abs(n), `${name} ${mark.cls}`).toBeLessThanOrEqual(R * 1.25);
        }
      }
    }
  });

  it('paints every character with classed marks only', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      const painted = paintedWorld(`folder-${i}`, 50);
      seen.add(painted.character);
      expect(painted.marks.length).toBeGreaterThan(0);
      for (const mark of painted.marks) {
        expect(mark.cls.startsWith('ct-')).toBe(true);
        const fill = fillOf(mark);
        if (fill) expect(PATTERN_KEYS).toContain(fill);
      }
    }
    expect(seen.size).toBe(CHARACTERS.length);
  });

  it('gives the ringed character a ring system and nobody else one', () => {
    for (let i = 0; i < 60; i += 1) {
      const painted = paintedWorld(`folder-${i}`, 50);
      expect(painted.ringed).toBe(painted.character === 'ringed');
      if (painted.ringed) expect(painted.ringRx).toBeGreaterThan(painted.ringRy);
    }
  });

  it('closes the terminator crescent', () => {
    const d = terminatorPath(40);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN/);
  });
});

describe('paperSigil', () => {
  it('draws the same sigil twice', () => {
    for (const name of NAMES) {
      expect(paperSigil(name, 62)).toEqual(paperSigil(name, 62));
    }
  });

  it('never leaves the cartouche', () => {
    for (let i = 0; i < 120; i += 1) {
      const R = 40 + (i % 7) * 8;
      const sigil = paperSigil(`folder-${i}`, R);
      for (const mark of sigil.marks) {
        for (const n of numbersIn(mark)) {
          expect(Math.abs(n), `${sigil.family} ${mark.cls}`).toBeLessThanOrEqual(R * 1.02);
        }
      }
    }
  });

  it('is ink and pattern only: no sphere, no shading, no gradient', () => {
    for (let i = 0; i < 120; i += 1) {
      const sigil = paperSigil(`folder-${i}`, 55);
      expect(sigil.marks.length).toBeGreaterThan(4);
      for (const mark of sigil.marks) {
        expect(mark.cls.startsWith('ct-sg-')).toBe(true);
        const fill = fillOf(mark);
        if (fill) expect(PATTERN_KEYS).toContain(fill);
        // The painted-world vocabulary must never leak into a paper sigil.
        expect(mark.cls).not.toMatch(/ct-(band|storm|cap-ice|maria|crater)/);
      }
    }
  });

  it('draws all five families, each with its own vocabulary', () => {
    const byFamily = new Map<string, string[]>();
    for (let i = 0; i < 300 && byFamily.size < 5; i += 1) {
      const sigil = paperSigil(`folder-${i}`, 60);
      if (!byFamily.has(sigil.family)) byFamily.set(sigil.family, classesOf(sigil.marks));
    }
    expect([...byFamily.keys()].sort()).toEqual([...SIGIL_FAMILIES].sort());
    expect(byFamily.get('astrolabe')).toContain('ct-sg-rete');
    expect(byFamily.get('astrolabe')).toContain('ct-sg-barb');
    expect(byFamily.get('rosette')).toContain('ct-sg-petal');
    expect(byFamily.get('lattice')).toContain('ct-sg-mesh');
    expect(byFamily.get('volvelle')).toContain('ct-sg-rune');
    expect(byFamily.get('volvelle')).toContain('ct-sg-arm');
    expect(byFamily.get('constellation')).toContain('ct-sg-star');
    expect(byFamily.get('constellation')).toContain('ct-sg-link');
  });

  it('never emits NaN, whatever the radius', () => {
    for (const R of [1, 8, 45, 85, 300]) {
      for (let i = 0; i < 25; i += 1) {
        for (const mark of paperSigil(`folder-${i}`, R).marks) {
          for (const n of numbersIn(mark)) expect(Number.isFinite(n)).toBe(true);
        }
      }
    }
  });

  it('keeps a lattice from swallowing the plate', () => {
    // The mesh is generated per cell; a bad reach test turns a 300px world
    // into thousands of hexagons.
    for (let i = 0; i < 300; i += 1) {
      const sigil = paperSigil(`folder-${i}`, 300);
      expect(sigil.marks.length).toBeLessThan(260);
    }
  });
});

describe('runes and the star', () => {
  it('builds a rune from absolute moves and lines only', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 40; i += 1) {
      const d = runeGlyph(rng);
      expect(d).toMatch(/^M/);
      expect(d).not.toMatch(/[a-z]/);
      expect(d).not.toMatch(/NaN/);
    }
  });

  it('rings the star with runes and ticks', () => {
    const runes = orreryRunes('experiments', 170, 58);
    expect(runes).toHaveLength(58);
    for (const rune of runes) {
      expect(Math.hypot(rune.x, rune.y)).toBeCloseTo(170, 0);
      expect(rune.d.startsWith('M')).toBe(true);
    }
    expect(orreryRunes('experiments', 170, 58)).toEqual(runes);
    expect(orreryRunes('data', 170, 58)[3].d).not.toBe(runes[3].d);
    expect(orreryTicks(170, 58, 4)).toHaveLength(Math.ceil(58 / 4));
  });

  it('opens the star fan downward and scales with the radius', () => {
    const star = starSigil(46);
    expect(star.rings).toHaveLength(3);
    expect(star.rings.some((ring) => ring.dashed)).toBe(true);
    expect(star.rays.length).toBeGreaterThan(8);
    // Nothing points straight down: that is where the system's name sits.
    for (const ray of star.rays) expect(ray.y1).toBeLessThan(46 * 0.55);
    expect(star.glyph).not.toMatch(/NaN/);
    const big = starSigil(92);
    expect(big.coreR).toBeCloseTo(star.coreR * 2, 5);
  });
});
