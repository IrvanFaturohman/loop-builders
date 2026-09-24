/**
 * Struktur data inti permainan. Semua yang ada di sini murni data (tanpa Three.js / DOM),
 * sehingga logika simulasi bisa diuji di Node dan disimpan ke localStorage.
 *
 * Konsep (mengikuti Train Miner): kereta berjalan searah jarum jam di rel yang mengelilingi
 * kota, hanya selama pemain menahan/mengetuk layar. Susunannya lokomotif → satu gerbong
 * muatan → gerbong pemotong. Gerinda di sisi kiri pemotong (arah hutan) menggerus blok yang
 * menempel ke rel. Rel mengikuti baris hutan terdepan: begitu blok hancur, rel di titik itu
 * langsung maju, dan blok keras membuat rel berbelok mengitarinya. Muatan dibongkar di stasiun
 * dan langsung dipasang ke bangunan kota di belakang rel; setiap poin bahan menjadi koin.
 * Hutan tidak tumbuh kembali: total bahan di hutan sama persis dengan total kebutuhan kota.
 */

export type MaterialKind = 'wood' | 'brick';
export type ThemeKind = 'forest' | 'meadow' | 'city';
/** Jenis muatan kereta. */
export type Resource = 'wood' | 'stone' | 'gem';

export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Definisi konten (config, tidak disimpan)
// ---------------------------------------------------------------------------

/** Satu bangunan kota. Biaya sebenarnya dihitung dari hasil pita hutan (lihat economy.ts). */
export interface LotDef {
  /** Id tipe bangunan (lihat config/buildings). */
  building: string;
  variant: number;
  /** Bobot porsi bahan pita hutan yang dipakai bangunan ini. */
  weight: number;
}

/** Distrik k terbuka di tahap k: distrik 0 = lapangan tengah, distrik k = lahan bekas pita k-1. */
export interface DistrictDef {
  name: string;
  lots: LotDef[];
}

export type BlockKind = 'tree' | 'treeGold' | 'treeRed' | 'rock' | 'crystal';

export interface LevelDefinition {
  id: string;
  name: string;
  theme: ThemeKind;
  /** Tampilan bangunan: kayu atau bata. */
  material: MaterialKind;
  /** Setengah lebar rel awal (persegi; pusat → garis tengah rel). */
  ringStart: number;
  /** Lebar tiap pita hutan (zona jenis blok) = jarak antar cincin kavling distrik. */
  ringStep: number;
  /** Distrik k dibiayai pita hutan k; kavlingnya terbuka satu per satu saat rel melewatinya. */
  districts: DistrictDef[];
  /** Bobot jenis blok per pita hutan (indeks = distrik). */
  bands: Partial<Record<BlockKind, number>>[];
  /** Setengah lebar peta (grid sel dibuat di [-mapHalf, mapHalf]). */
  mapHalf: number;
  seed: number;
  costScale: number;
  completionBonus: number;
}

/** Primitive geometri bangunan (koordinat lokal bangunan, satuan dunia). */
export type Prim = PrimShape & {
  /** true = hanya tampil di model solid (detail kecil), tidak ikut siluet ghost. */
  noGhost?: boolean;
};

export type PrimShape =
  | { kind: 'box'; p: [number, number, number]; s: [number, number, number]; r?: [number, number, number]; c: string; round?: number }
  | { kind: 'cyl'; p: [number, number, number]; radius: number; len: number; axis: 'x' | 'y' | 'z'; c: string; cap?: string; seg?: number }
  | { kind: 'prism'; p: [number, number, number]; w: number; h: number; d: number; r?: [number, number, number]; c: string }
  | { kind: 'sphere'; p: [number, number, number]; radius: number; c: string }
  | { kind: 'cone'; p: [number, number, number]; radius: number; h: number; c: string; seg?: number; r?: [number, number, number] };

export interface ModuleDef {
  stage: number;
  weight: number;
  prims: Prim[];
}

export interface ProjectDefinition {
  id: string;
  name: string;
  material: MaterialKind;
  target: number;
  stageNames: string[];
  modules: ModuleDef[];
}

/** Proyek yang sudah difinalisasi: tiap modul punya biaya integer & ambang kumulatif. */
export interface FinalProject extends ProjectDefinition {
  costs: number[];
  thresholds: number[];
}

// ---------------------------------------------------------------------------
// State yang disimpan
// ---------------------------------------------------------------------------

export interface Cargo {
  wood: number;
  stone: number;
  gem: number;
}

export interface Train {
  /** Jarak tempuh lokomotif di lintasan, 0 <= distance < panjang lintasan. */
  distance: number;
  /** Tingkat tiap gerbong pemotong, urut dari depan (tepat di belakang gerbong muatan). */
  cutters: number[];
  /** Isi satu-satunya gerbong muatan (tepat di belakang lokomotif). */
  cargo: Cargo;
}

export interface TutorialFlags {
  drive: boolean;
  add: boolean;
  merge: boolean;
  capacity: boolean;
  speed: boolean;
}

export interface GameStats {
  levelTime: number;
  totalTime: number;
  totalCut: number;
  /** Poin bahan yang sudah terpasang ke bangunan (semua level). */
  totalBuilt: number;
  lastCompletionBonus: number;
}

export interface GameState {
  levelIndex: number;
  cycle: number;
  money: number;
  /** HP sisa tiap sel hutan: >0 blok hidup, 0 = sudah ditebang, -1 = kosong / jalur rel. */
  blocks: number[];
  /** Poin bahan terpasang per kavling (urut distrik, lalu urutan di distrik). */
  plots: number[];
  /** Poin bahan di gudang stasiun yang belum punya bangunan terbuka. */
  stock: number;
  completed: boolean;
  train: Train;
  speedLevel: number;
  capacityLevel: number;
  addsPurchased: number;
  mergesPurchased: number;
  tutorial: TutorialFlags;
  stats: GameStats;
}

// ---------------------------------------------------------------------------
// State sementara (tidak disimpan)
// ---------------------------------------------------------------------------

export interface DriveState {
  /** Pemain sedang menahan layar/spasi. */
  holding: boolean;
  /** Sisa detik dorongan dari tap. */
  tapTimer: number;
  /** Laju saat ini sebagai porsi kecepatan penuh (0 = diam). */
  v: number;
  /** Total detik kereta digerakkan pemain (untuk tutorial). */
  usedSeconds: number;
}

export interface Runtime {
  drive: DriveState;
  /** Detik terakhir pemotong menggerus (untuk audio/visual). */
  cutHeat: number;
  /** Detik muatan penuh berturut-turut (untuk hint kapasitas). */
  fullTime: number;
  /** Sel yang sedang digerus tiap pemotong (-1 = tidak ada). Render membacanya untuk gerinda. */
  targets: number[];
}
