import { plotsOfLevel } from './layout';
import { trackFor } from './tracks';
import type { GameState, Runtime, TutorialFlags } from './types';
import { initialBlocks } from './worldgen';

export function defaultTutorial(): TutorialFlags {
  return { boost: false, add: false, merge: false, capacity: false, speed: false };
}

/** State awal permainan baru (level pertama). */
export function createNewGame(): GameState {
  const state: GameState = {
    levelIndex: 0,
    cycle: 0,
    money: 0,
    blocks: [],
    plots: [],
    stock: 0,
    completed: false,
    expandStage: 0,
    train: { distance: 0, cutters: [1], cargo: { wood: 0, stone: 0, gem: 0 } },
    speedLevel: 1,
    capacityLevel: 1,
    addsPurchased: 0,
    mergesPurchased: 0,
    tutorial: defaultTutorial(),
    stats: { levelTime: 0, totalTime: 0, totalCut: 0, totalBuilt: 0, lastCompletionBonus: 0 },
  };
  setupLevel(state, 0, 0);
  return state;
}

/**
 * Menyiapkan level baru: hutan utuh, rel cincin pertama, kereta dengan satu pemotong Lv1.
 * Uang, tutorial, dan statistik total dibawa dari level sebelumnya; upgrade kereta di-reset
 * (seperti pindah pulau di Train Miner).
 */
export function setupLevel(state: GameState, levelIndex: number, cycle: number): void {
  state.levelIndex = levelIndex;
  state.cycle = cycle;
  state.blocks = initialBlocks(levelIndex);
  state.plots = plotsOfLevel(levelIndex).map(() => 0);
  state.stock = 0;
  state.completed = false;
  state.expandStage = 0;
  state.speedLevel = 1;
  state.capacityLevel = 1;
  state.addsPurchased = 0;
  state.mergesPurchased = 0;
  state.stats.levelTime = 0;
  state.stats.lastCompletionBonus = 0;
  // Mulai tepat setelah stasiun.
  state.train = { distance: trackFor(levelIndex, 0).wrap(0.5), cutters: [1], cargo: { wood: 0, stone: 0, gem: 0 } };
}

export function createRuntime(): Runtime {
  return {
    boost: { energy: 1, holding: false, tapTimer: 0, exhausted: false, rechargeDelay: 0, mult: 1, usedSeconds: 0 },
    freeze: 0,
    cutHeat: 0,
    fullTime: 0,
    targets: [],
  };
}
