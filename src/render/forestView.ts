import * as THREE from 'three';
import { LEVELS } from '../config/levels';
import { islandBounds } from '../game/layout';
import type { BlockKind, GameState } from '../game/types';
import { fieldFor, KINDS, maxHp, type Field } from '../game/worldgen';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';

/**
 * Hutan voxel: satu InstancedMesh per jenis blok. Tiap bentuk tersusun dari potongan yang
 * masing-masing tampil pada rentang tahap tertentu; blok yang tergerus berganti tahap lewat
 * atribut instance `instStage` di shader dan berkedip putih (`instFlash`) selama gerinda menempel.
 * Pohon: rimbun → tajuk tinggal separuh → batang gundul bercabang → tunggul. Tunggul masih blok
 * hidup (masih harus digerus), jadi rel baru maju setelah tunggulnya habis. Batu: lempeng batu
 * retak 2×2 yang pecah satu per satu sampai tinggal puing. Hanya sel yang berubah ditulis ulang.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Jumlah tahap tampilan blok hidup: 4 = utuh, 1 = tunggul/puing. */
const STAGES = 4;
const FALL_T = 0.25;
const HIT_T = 0.25;
const TRUNK = '#7a5230';
const WOOD_CHIP = '#b07a45';

/** Warna daun/pecahan yang rontok saat blok kehilangan satu tahap. */
const BLOCK_CHIP: Record<BlockKind, string> = {
  tree: '#6ccf58',
  treeGold: '#ffd24a',
  treeRed: '#f06a55',
  rock: '#b4c0cf',
  crystal: '#ff7a8f',
};

/** Warna serpihan saat blok turun ke `stage`: batang pohon (→ tunggul) & tunggul berserpih kayu. */
export function chipColor(kind: BlockKind, stage: number): string {
  return kind.startsWith('tree') && stage <= 1 ? WOOD_CHIP : BLOCK_CHIP[kind];
}

/** Potongan bentuk yang tampil pada tahap from..to. */
type Piece = [from: number, to: number, geo: THREE.BufferGeometry];

function shape(pieces: Piece[]): THREE.BufferGeometry {
  for (const [from, to, g] of pieces) {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      arr[i * 2] = from;
      arr[i * 2 + 1] = to;
    }
    g.setAttribute('part', new THREE.BufferAttribute(arr, 2));
  }
  return mergeFlat(
    pieces.map(([, , g]) => g),
    ['position', 'normal', 'color', 'part'],
  );
}

/** Batang kotak dimiringkan (cabang pohon), pangkal di (x, y, z). */
function branch(len: number, w: number, x: number, y: number, z: number, rz: number, rx: number): THREE.BufferGeometry {
  const g = cbox(w, len, w, TRUNK, 0, len / 2, 0, 0.015);
  return place(g, x, y, z, rx, 0, rz);
}

/**
 * Pohon: tajuk membulat sedikit lebih lebar dari sel (rapat, saling menutupi seperti karpet).
 * 4 utuh → 3 tajuk tinggal separuh → 2 batang gundul bercabang → 1 tunggul.
 */
function treeGeo(canopy: string, light: string): THREE.BufferGeometry {
  return shape([
    [2, 4, cbox(0.18, 0.78, 0.18, TRUNK, 0, 0.39, 0, 0.03)],
    [2, 4, branch(0.42, 0.09, -0.04, 0.6, 0, 0.62, 0)],
    [2, 4, branch(0.36, 0.08, 0.04, 0.55, 0.02, -0.58, 0.2)],
    [2, 4, branch(0.3, 0.07, 0, 0.66, -0.04, 0.1, -0.6)],
    [4, 4, cbox(1.12, 0.74, 1.12, canopy, 0, 0.98, 0, 0.16)],
    [4, 4, cbox(0.7, 0.42, 0.7, light, 0.06, 1.46, -0.05, 0.09)],
    [3, 3, cbox(1.08, 0.42, 1.08, canopy, 0, 0.82, 0, 0.14)],
    [1, 1, ccyl(0.17, 0.22, TRUNK, 9, 0, 0.11, 0, 0, 0, 0, '#d9b27a')],
  ]);
}

/** Lempeng batu retak: 2×2 batu yang pecah satu per satu, lalu tinggal puing. */
function stoneGeo(extra: Piece[]): THREE.BufferGeometry {
  const q = (x: number, z: number, h: number, color: string) => cbox(0.46, h, 0.46, color, x, h / 2, z, 0.06);
  return shape([
    [2, 4, q(-0.24, -0.24, 0.3, '#a9b5c4')],
    [2, 4, q(0.24, 0.24, 0.32, '#b3bfcd')],
    [3, 4, q(0.24, -0.24, 0.27, '#9fabbb')],
    [4, 4, q(-0.24, 0.24, 0.34, '#aebacb')],
    [1, 1, cbox(0.86, 0.08, 0.86, '#98a4b3', 0, 0.04, 0, 0.03)],
    [1, 1, cbox(0.22, 0.12, 0.2, '#aebacb', 0.18, 0.1, -0.16, 0.03)],
    [1, 1, cbox(0.18, 0.1, 0.2, '#a9b5c4', -0.2, 0.09, 0.14, 0.03)],
    ...extra,
  ]);
}

function kindGeometry(kind: BlockKind): THREE.BufferGeometry {
  switch (kind) {
    case 'tree':
      return treeGeo('#5cbf4a', '#6ccf58');
    case 'treeGold':
      return treeGeo('#f0bf2c', '#ffd24a');
    case 'treeRed':
      return treeGeo('#e0503f', '#f06a55');
    case 'rock':
      return stoneGeo([]);
    default:
      // Kristal mencuat dari lempeng batu: kristal kecil pecah dulu, lalu kristal utama.
      return stoneGeo([
        [2, 4, place(colored(new THREE.ConeGeometry(0.2, 0.9, 5), '#ff3f5f'), 0, 0.72, 0)],
        [3, 4, place(colored(new THREE.ConeGeometry(0.14, 0.62, 5), '#ff7a8f'), 0.24, 0.58, 0.1, 0, 0, -0.35)],
        [4, 4, place(colored(new THREE.ConeGeometry(0.13, 0.55, 5), '#e8284c'), -0.22, 0.55, -0.08, 0.3, 0, 0.35)],
      ]);
  }
}

/** Potongan di luar rentang tahapnya dilipat ke titik asal (segitiganya lenyap). */
const STAGE_VERT = /* glsl */ `#include <begin_vertex>
  if (instStage < part.x || instStage > part.y) transformed = vec3(0.0);`;

let forestMats: { color: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } | null = null;

function materials() {
  if (forestMats) return forestMats;
  const color = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  color.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'attribute vec2 part;\nattribute float instStage;\nattribute float instFlash;\nvarying float vFlash;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `${STAGE_VERT}\n  vFlash = instFlash;`);
    sh.fragmentShader =
      'varying float vFlash;\n' +
      sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFlash);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(0.6 * vFlash);');
  };
  color.customProgramCacheKey = () => 'forest-stage';
  // Bayangan juga harus kehilangan bagian yang sudah tergerus.
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 part;\nattribute float instStage;\n' + sh.vertexShader.replace('#include <begin_vertex>', STAGE_VERT);
  };
  depth.customProgramCacheKey = () => 'forest-stage-depth';
  forestMats = { color, depth };
  return forestMats;
}

/** Tahap tampilan untuk HP tertentu (blok tertahan di ambang tumbang = tinggal batang). */
function stageOf(hp: number, max: number): number {
  if (hp <= 0) return 1;
  return Math.max(1, Math.min(STAGES, Math.ceil((hp / max) * STAGES - 1e-6)));
}

interface CellAnim {
  /** Sisa waktu goyang karena gerinda (diperbarui tiap kali HP turun). */
  hit: number;
  /** Sisa waktu animasi tumbang. */
  fall: number;
  /** Kilat putih saat blok kehilangan satu tahap, meluruh cepat. */
  flash: number;
}

interface KindMesh {
  mesh: THREE.InstancedMesh;
  stage: THREE.InstancedBufferAttribute;
  flash: THREE.InstancedBufferAttribute;
}

/** Blok yang baru kehilangan satu tahap (untuk serpihan/daun rontok). */
export interface StageDrop {
  cell: number;
  kind: BlockKind;
  /** Tahap baru setelah turun. */
  stage: number;
  /** Tinggi bagian yang baru hilang (dunia). */
  y: number;
}

export class ForestView {
  readonly group = new THREE.Group();
  private readonly field: Field;
  private readonly kinds: KindMesh[] = [];
  /** sel → indeks instance di mesh jenisnya */
  private readonly slot: Int32Array;
  private readonly lastHp: Float64Array;
  private readonly lastStage: Int8Array;
  private readonly rot: Float32Array;
  private readonly size: Float32Array;
  private readonly anims = new Map<number, CellAnim>();
  private readonly dirty = new Set<number>();
  private first = true;
  private time = 0;

  constructor(levelIndex: number, soilColor: string) {
    const f = fieldFor(levelIndex);
    this.field = f;
    this.slot = new Int32Array(f.n).fill(-1);
    this.lastHp = new Float64Array(f.n).fill(NaN);
    this.lastStage = new Int8Array(f.n).fill(STAGES);
    this.rot = new Float32Array(f.n);
    this.size = new Float32Array(f.n);

    // Tanah hutan (cokelat) seluas daerah hutan — terlihat di sela pohon & bekas tebangan; di luarnya pantai.
    const land = islandBounds(LEVELS[levelIndex]).maxX * 2;
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(land, land), new THREE.MeshStandardMaterial({ color: soilColor, roughness: 1 }));
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.004;
    soil.receiveShadow = true;
    this.group.add(soil);

    const counts = KINDS.map(() => 0);
    for (let c = 0; c < f.n; c++) {
      if (f.kind[c] < 0) continue;
      this.slot[c] = counts[f.kind[c]]++;
      // Blok tersusun rapi dalam baris: tanpa geser, rotasi kelipatan 90°, variasi skala kecil.
      const h = Math.sin(c * 12.9898) * 43758.5453;
      const r = h - Math.floor(h);
      this.rot[c] = Math.floor(r * 4) * (Math.PI / 2);
      this.size[c] = 0.92 + ((r * 7.3) % 1) * 0.12;
    }
    const mats = materials();
    KINDS.forEach((k, i) => {
      const geo = kindGeometry(k);
      const n = Math.max(1, counts[i]);
      const stage = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(STAGES), 1);
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      stage.setUsage(THREE.DynamicDrawUsage);
      flash.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('instStage', stage);
      geo.setAttribute('instFlash', flash);
      const mesh = new THREE.InstancedMesh(geo, mats.color, n);
      mesh.customDepthMaterial = mats.depth;
      mesh.count = counts[i];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.kinds.push({ mesh, stage, flash });
      this.group.add(mesh);
    });

    // Warna: variasi kecerahan per blok.
    for (let c = 0; c < f.n; c++) {
      if (f.kind[c] < 0) continue;
      const v = 0.88 + ((this.size[c] - 0.9) / 0.2) * 0.24;
      this.kinds[f.kind[c]].mesh.setColorAt(this.slot[c], _c.setRGB(v, v, v));
    }
  }

  /** Posisi dunia pusat sebuah sel (untuk efek). */
  cellPos(c: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.field.x[c], 0.6, this.field.z[c]);
  }

  private writeCell(c: number, state: GameState): void {
    const f = this.field;
    const k = f.kind[c];
    if (k < 0) return;
    const vm = this.kinds[k];
    const i = this.slot[c];
    const hp = state.blocks[c];
    const max = maxHp(f, c);
    const a = this.anims.get(c);
    const rot = this.rot[c];
    let scale = 0;
    let tilt = 0;
    let sink = 0;
    let flash = a ? a.flash : 0;
    if (hp > 0) {
      scale = this.size[c];
      if (a && a.hit > 0) {
        tilt = Math.sin(a.hit * 40) * a.hit * 0.35;
        scale *= 1 - a.hit * 0.08;
        // Selama gerinda menempel: kedip putih.
        flash = Math.max(flash, 0.32 + 0.26 * Math.sin(this.time * 38));
      }
    } else if (hp === 0 && a && a.fall > 0) {
      // Tunggul/puing terakhir tergerus habis: mengecil & amblas.
      const k2 = a.fall / FALL_T; // 1 → 0
      scale = this.size[c] * k2;
      sink = (1 - k2) * 0.12;
    }
    _p.set(f.x[c], -sink, f.z[c]);
    _e.set(tilt * 0.6, rot, tilt);
    _q.setFromEuler(_e);
    _s.setScalar(Math.max(0.0001, scale));
    _m.compose(_p, _q, _s);
    vm.mesh.setMatrixAt(i, _m);
    vm.mesh.instanceMatrix.needsUpdate = true;
    const st = stageOf(hp, max);
    if (vm.stage.getX(i) !== st) {
      vm.stage.setX(i, st);
      vm.stage.needsUpdate = true;
    }
    if (vm.flash.getX(i) !== flash) {
      vm.flash.setX(i, flash);
      vm.flash.needsUpdate = true;
    }
  }

  private anim(c: number): CellAnim {
    let a = this.anims.get(c);
    if (!a) {
      a = { hit: 0, fall: 0, flash: 0 };
      this.anims.set(c, a);
    }
    return a;
  }

  /**
   * Sinkron dengan state: bandingkan HP tiap sel dengan frame lalu, mulai animasi kena
   * gerinda / tumbang, dan tulis ulang hanya sel yang berubah. Mengembalikan blok yang baru
   * kehilangan satu tahap (pucuk/tajuk/batu terlepas).
   */
  update(dt: number, state: GameState): StageDrop[] {
    const f = this.field;
    const drops: StageDrop[] = [];
    this.time += dt;
    for (let c = 0; c < f.n; c++) {
      const k = f.kind[c];
      if (k < 0) continue;
      const hp = state.blocks[c];
      const prev = this.lastHp[c];
      if (this.first) {
        this.lastHp[c] = hp;
        this.lastStage[c] = stageOf(hp, maxHp(f, c));
        this.dirty.add(c);
        continue;
      }
      if (hp === prev) continue;
      const st = stageOf(hp, maxHp(f, c));
      if (hp > 0 && prev > hp) this.anim(c).hit = HIT_T;
      else if (hp === 0 && prev > 0) {
        const a = this.anim(c);
        a.fall = FALL_T;
        a.hit = 0;
        a.flash = 1;
      }
      if (hp > 0 && st < this.lastStage[c]) {
        this.anim(c).flash = 1;
        drops.push({ cell: c, kind: KINDS[k], stage: st, y: 0.25 + st * 0.3 });
      }
      this.lastStage[c] = st;
      this.lastHp[c] = hp;
      this.dirty.add(c);
    }
    this.first = false;
    for (const [c, a] of this.anims) {
      a.hit = Math.max(0, a.hit - dt);
      a.fall = Math.max(0, a.fall - dt);
      a.flash = Math.max(0, a.flash - dt * 5);
      this.dirty.add(c);
      if (a.hit <= 0 && a.fall <= 0 && a.flash <= 0) this.anims.delete(c);
    }
    for (const c of this.dirty) this.writeCell(c, state);
    this.dirty.clear();
    return drops;
  }

  dispose(): void {
    for (const v of this.kinds) v.mesh.geometry.dispose();
  }
}
