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
  if (!t.drive) return { key: 'drive', text: 'Tahan layar supaya kereta jalan!', target: 'world' };
  if (!t.capacity && rt.fullTime > 2.5 && canUpgradeCapacity(state).ok) return { key: 'capacity', text: 'Muatan penuh — naikkan Kapasitas', target: 'capacity' };
  if (!t.add && canAddCutter(state).ok) return { key: 'add', text: 'Tambah gerbong pemotong', target: 'add' };
  if (!t.merge && canMerge(state).ok) return { key: 'merge', text: 'Gabung 2 pemotong setingkat → lengan lebih panjang & gerinda lebih cepat', target: 'merge' };
  if (!t.speed && t.merge && canUpgradeSpeed(state).ok) return { key: 'speed', text: 'Naikkan kecepatan kereta', target: 'speed' };
  return null;
}

/** Tandai langkah jalan selesai setelah pemain benar-benar menjalankan kereta sebentar. */
export function updateTutorialFlags(state: GameState, rt: Runtime): boolean {
  if (!state.tutorial.drive && rt.drive.usedSeconds > 2.5) {
    state.tutorial.drive = true;
    return true;
  }
  return false;
}
