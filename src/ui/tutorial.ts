import { canAddCutter, canMerge, canUpgradeCapacity, canUpgradeSpeed } from '../game/actions';
import type { GameState, Runtime, TutorialFlags } from '../game/types';

export interface TutorialStep {
  key: keyof TutorialFlags;
  text: string;
  target: 'world' | 'add' | 'merge' | 'speed' | 'capacity';
}

/**
 * Pengantar singkat yang tidak memblokir: satu petunjuk kecil pada satu waktu,
 * muncul hanya saat relevan dan hilang begitu pemain melakukannya.
 */
export function currentTutorial(state: GameState, rt: Runtime): TutorialStep | null {
  if (state.completed) return null;
  const t = state.tutorial;
  if (!t.boost && state.stats.totalCut > 3) return { key: 'boost', text: 'Tahan layar untuk ngebut!', target: 'world' };
  if (!t.capacity && rt.fullTime > 2.5 && canUpgradeCapacity(state).ok) return { key: 'capacity', text: 'Muatan penuh — naikkan Kapasitas', target: 'capacity' };
  if (!t.add && canAddCutter(state).ok) return { key: 'add', text: 'Tambah gerbong pemotong', target: 'add' };
  if (!t.merge && canMerge(state).ok) return { key: 'merge', text: 'Gabung 2 pemotong setingkat → lengan lebih panjang & gerinda lebih cepat', target: 'merge' };
  if (!t.speed && t.merge && canUpgradeSpeed(state).ok) return { key: 'speed', text: 'Naikkan kecepatan kereta', target: 'speed' };
  return null;
}

/** Tandai langkah boost selesai setelah pemain benar-benar mencobanya. */
export function updateTutorialFlags(state: GameState, rt: Runtime): boolean {
  if (!state.tutorial.boost && (rt.boost.usedSeconds > 1.2 || state.stats.levelTime > 60)) {
    state.tutorial.boost = true;
    return true;
  }
  return false;
}
