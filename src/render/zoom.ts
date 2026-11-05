export const PLAY_MIN_ZOOM = 1;
export const PLAY_MAX_ZOOM = 8;
export const MAP_MIN_ZOOM = 0.5;
export const MAP_MAX_ZOOM = 8;
const MAP_ZOOM_FACTOR = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Return the tile-scale offset from the auto-fit zoom after a wheel event. */
export function stepPlayZoomOffset(baseScale: number, offset: number, deltaY: number): number {
  if (!deltaY) return offset;
  const next = offset + (deltaY < 0 ? 1 : -1);
  return clamp(next, PLAY_MIN_ZOOM - baseScale, PLAY_MAX_ZOOM - baseScale);
}

/** Adjust the overview map zoom by one bounded wheel step. */
export function stepMapZoom(zoom: number, deltaY: number): number {
  if (!deltaY) return zoom;
  const next = zoom * (deltaY < 0 ? MAP_ZOOM_FACTOR : 1 / MAP_ZOOM_FACTOR);
  return Math.round(clamp(next, MAP_MIN_ZOOM, MAP_MAX_ZOOM) * 100) / 100;
}
