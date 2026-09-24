import type { LevelDefinition, LotDef } from '../game/types';

/**
 * Data level. Tiap level: pulau hutan dengan rel cincin di sekeliling alun-alun tengah.
 * Tahap k = rel cincin ke-k; pemotong membersihkan pita hutan di luarnya, lalu rel melebar
 * sendiri ke pita berikutnya. Distrik k (daftar bangunan) terbuka di tahap k: distrik 0 di
 * alun-alun, distrik k di lahan bekas pita k-1. Biaya tiap bangunan = porsi bobotnya dari hasil
 * pita hutan distrik itu, jadi kota selesai tepat saat hutan habis.
 * Untuk menambah level: salin satu objek di LEVELS lalu ubah distrik, bobot, pita, dan seed.
 */

const L = (building: string, variant: number, weight = 1): LotDef => ({ building, variant, weight });

export const LEVELS: LevelDefinition[] = [
  {
    id: 'hutan-cemara',
    name: 'Hutan Cemara',
    theme: 'forest',
    material: 'wood',
    ringStart: 4.25,
    ringStep: 2.5,
    cornerRadius: 1.5,
    districts: [
      { name: 'Alun-alun', lots: [L('rumah-kayu', 0), L('warung', 0), L('rumah-papan', 0), L('rumah-kayu', 1)] },
      {
        name: 'Kampung Cemara',
        lots: [L('rumah-papan', 1), L('rumah-panggung', 0, 1.2), L('warung', 1), L('rumah-kayu', 2), L('lumbung', 0, 1.4), L('rumah-papan', 2)],
      },
      {
        name: 'Kampung Pinus',
        lots: [
          L('rumah-loteng', 0, 1.4),
          L('rumah-kayu', 3),
          L('warung', 2),
          L('rumah-panggung', 1, 1.2),
          L('menara-air', 0, 2),
          L('rumah-papan', 3),
          L('lumbung', 1, 1.4),
          L('rumah-kayu', 0),
          L('rumah-panggung', 2, 1.2),
        ],
      },
      {
        name: 'Kampung Jati',
        lots: [
          L('rumah-loteng', 1, 1.4),
          L('warung', 0),
          L('rumah-papan', 0),
          L('lumbung', 2, 1.4),
          L('rumah-kayu', 1),
          L('menara-air', 1, 2),
          L('rumah-panggung', 0, 1.2),
          L('rumah-loteng', 2, 1.4),
          L('warung', 1),
          L('rumah-papan', 1),
          L('lumbung', 0, 1.4),
          L('rumah-kayu', 2),
        ],
      },
    ],
    bands: [
      { tree: 94, rock: 6 },
      { treeGold: 70, tree: 18, rock: 12 },
      { treeRed: 50, treeGold: 20, rock: 20, crystal: 10 },
      { treeRed: 58, rock: 24, crystal: 18 },
    ],
    mapHalf: 16,
    seed: 1337,
    costScale: 1,
    completionBonus: 200,
  },
  {
    id: 'lembah-batu',
    name: 'Lembah Batu',
    theme: 'meadow',
    material: 'brick',
    ringStart: 4.25,
    ringStep: 2.5,
    cornerRadius: 1.5,
    districts: [
      { name: 'Alun-alun Batu', lots: [L('rumah-bata', 0), L('toko-roti', 0), L('ruko', 0), L('rumah-bata', 1)] },
      {
        name: 'Blok Granit',
        lots: [L('ruko', 1), L('rumah-bata-2', 0, 1.3), L('toko-roti', 1), L('rumah-bata', 2), L('apartemen', 0, 1.6), L('ruko', 2)],
      },
      {
        name: 'Blok Marmer',
        lots: [
          L('rumah-bata-2', 1, 1.3),
          L('toko-roti', 2),
          L('apartemen', 1, 1.6),
          L('rumah-bata', 3),
          L('menara-jam', 0, 2.2),
          L('ruko', 0),
          L('rumah-bata-2', 2, 1.3),
          L('toko-roti', 0),
          L('rumah-bata', 0),
        ],
      },
      {
        name: 'Blok Andesit',
        lots: [
          L('apartemen', 2, 1.6),
          L('ruko', 1),
          L('rumah-bata-2', 0, 1.3),
          L('toko-roti', 1),
          L('rumah-bata', 1),
          L('menara-jam', 1, 2.2),
          L('ruko', 2),
          L('apartemen', 0, 1.6),
          L('rumah-bata', 2),
          L('toko-roti', 2),
          L('rumah-bata-2', 1, 1.3),
          L('ruko', 0),
        ],
      },
    ],
    bands: [
      { rock: 55, tree: 45 },
      { rock: 55, treeGold: 38, crystal: 7 },
      { rock: 50, treeRed: 28, crystal: 22 },
      { rock: 45, treeRed: 30, crystal: 25 },
    ],
    mapHalf: 16,
    seed: 4242,
    costScale: 2.5,
    completionBonus: 500,
  },
];
