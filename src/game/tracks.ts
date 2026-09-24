import { LEVELS } from '../config/levels';
import { stageDef, stationPoint } from './layout';
import { buildStageMapping, TrackPath, type StageMapping } from './track';

/** Cache lintasan per (level, tahap) & peta antar tahap (dipakai logika dan render). */
const trackCache = new Map<string, TrackPath>();

export function trackFor(levelIndex: number, stage: number): TrackPath {
  const key = `${levelIndex}:${stage}`;
  let t = trackCache.get(key);
  if (!t) {
    t = new TrackPath(stageDef(LEVELS[levelIndex], stage));
    trackCache.set(key, t);
  }
  return t;
}

const mappingCache = new Map<string, StageMapping>();

/**
 * Peta jarak lintasan tahap `from` → `to`. Cincin baru adalah offset cincin lama, jadi
 * pemetaan proporsional dengan stasiun (jarak 0 di kedua cincin) sebagai titik bersama
 * menjaga urutan kereta terhadap stasiun.
 */
export function stageMapping(levelIndex: number, from: number, to: number): StageMapping {
  const key = `${levelIndex}:${from}:${to}`;
  let m = mappingCache.get(key);
  if (!m) {
    const level = LEVELS[levelIndex];
    m = buildStageMapping(trackFor(levelIndex, from), trackFor(levelIndex, to), [stationPoint(level, Math.min(from, to))]);
    mappingCache.set(key, m);
  }
  return m;
}
