import type { FC } from 'react';
import type { MapMethod, MapRendererProps } from './renderer';
import { CartographyMap } from './cartography/CartographyMap';
import { ZoomMap } from './zoom/ZoomMap';
import { ChartMap } from './MapCanvas';
/** Swapped as renderers land: cartography → CartographyMap, zoom → ZoomMap. */
export const RENDERERS: Record<MapMethod, FC<MapRendererProps>> = {
  cartography: CartographyMap,
  zoom: ZoomMap,
  chart: ChartMap,
};
