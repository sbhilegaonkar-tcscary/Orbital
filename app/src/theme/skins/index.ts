import type { Mode, Skin } from '../tokens';
import { clinicalTerminal } from './clinical-terminal';
import { clinical } from './clinical';
import { terminalLight } from './terminal-light';
import { deepSpace } from './deep-space';
import { aurora } from './aurora';
import { graphite } from './graphite';
import { glassDeck } from './glass-deck';
import { glassCockpit } from './glass-cockpit';
import { nebulaDrift } from './nebula-drift';
import { nebula } from './nebula';
import { synthwave } from './synthwave';
import { retroCrt } from './retro-crt';

/** Every registered skin, default-first within each mode. */
export const SKINS: Skin[] = [
  clinicalTerminal,
  clinical,
  terminalLight,
  deepSpace,
  aurora,
  graphite,
  glassDeck,
  glassCockpit,
  nebulaDrift,
  nebula,
  synthwave,
  retroCrt,
];

export const DEFAULT_SKIN_BY_MODE: Record<Mode, string> = {
  paper: clinicalTerminal.id,
  'night-ops': deepSpace.id,
  cockpit: glassDeck.id,
  bridge: nebulaDrift.id,
};

export function getSkinsForMode(mode: Mode): Skin[] {
  return SKINS.filter((skin) => skin.mode === mode);
}

export function getSkinById(id: string): Skin | undefined {
  return SKINS.find((skin) => skin.id === id);
}
