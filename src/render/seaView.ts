import * as THREE from 'three';
import { islandBounds } from '../game/layout';
import type { LevelDefinition } from '../game/types';
import { cbox, mergeFlat, place } from './geom';
import { SHARED } from './palette';

/**
 * Pulau di tengah laut: lempeng pulau bersudut bulat (pantai pasir selebar BEACH di luar baris
 * hutan terakhir, tebing pasir ke air), laut beranimasi di sekelilingnya, cincin buih di garis
 * pantai, dan sedikit hiasan pantai (batu, pohon kelapa). Hanya tampilan.
 */

/** Lebar pantai pasir di luar baris hutan terakhir. */
const BEACH = 1.4;
const CORNER = 1.8;
const CLIFF = 0.9;
const WATER_Y = -0.28;
const SAND = '#f0d49a';
const CLIFF_COLOR = '#d6ab6c';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Persegi bersudut bulat berpusat di titik asal (bidang x-y). */
function roundedRect(half: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.absarc(half - r, -half + r, r, -Math.PI / 2, 0, false);
  s.lineTo(half, half - r);
  s.absarc(half - r, half - r, r, 0, Math.PI / 2, false);
  s.lineTo(-half + r, half);
  s.absarc(-half + r, half - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-half, -half + r);
  s.absarc(-half + r, -half + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function waterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#39b4e4';
  g.fillRect(0, 0, 128, 128);
  const r = rng(7);
  // Riak ombak: garis lengkung pendek yang lebih terang.
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = r() * 128;
    const y = r() * 128;
    const w = 10 + r() * 18;
    g.strokeStyle = r() < 0.7 ? 'rgba(140,220,250,0.55)' : 'rgba(255,255,255,0.45)';
    g.lineWidth = 2 + r() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y - 3, x + w, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(48, 48);
  t.anisotropy = 4;
  return t;
}

/** Pohon kelapa kecil: batang melengkung dari ruas-ruas, daun menjuntai. */
function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k < 6; k++) {
    const lean = 0.08 * k;
    parts.push(place(cbox(0.16, 0.34, 0.16, k % 2 ? '#a0703f' : '#8a5a36', 0, 0, 0, 0.03), x, y + 0.17, 0, 0, 0, -lean));
    x += Math.sin(lean) * 0.32;
    y += Math.cos(lean) * 0.32;
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const leaf = cbox(0.9, 0.05, 0.22, k % 2 ? '#3fae4a' : '#52c45a', 0.42, 0, 0, 0.02);
    leaf.rotateZ(-0.45);
    leaf.rotateY(a);
    leaf.translate(x, y + 0.05, 0);
    parts.push(leaf);
  }
  parts.push(place(cbox(0.14, 0.14, 0.14, '#7a4a26', 0, 0, 0, 0.04), x + 0.06, y - 0.08, 0.05));
  return mergeFlat(parts);
}

export class SeaView {
  readonly group = new THREE.Group();
  private readonly waterTex: THREE.CanvasTexture;
  private readonly foam: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;

  constructor(level: LevelDefinition) {
    const half = islandBounds(level).maxX + BEACH;

    // Lempeng pulau: tutup atas = pantai pasir (y = 0), sisi = tebing pasir ke dasar laut.
    const islandGeo = new THREE.ExtrudeGeometry(roundedRect(half, CORNER), { depth: CLIFF, bevelEnabled: false, curveSegments: 10 });
    islandGeo.rotateX(Math.PI / 2);
    const sand = new THREE.MeshStandardMaterial({ color: SAND, roughness: 1 });
    const cliff = new THREE.MeshStandardMaterial({ color: CLIFF_COLOR, roughness: 1 });
    const island = new THREE.Mesh(islandGeo, [sand, cliff]);
    island.receiveShadow = true;
    this.group.add(island);
    this.disposables.push(islandGeo, sand, cliff);

    // Laut.
    this.waterTex = waterTexture();
    const waterGeo = new THREE.PlaneGeometry(400, 400);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ map: this.waterTex, roughness: 0.35, metalness: 0.05 }));
    water.position.y = WATER_Y;
    this.group.add(water);
    this.disposables.push(this.waterTex, waterGeo, water.material as THREE.Material);

    // Buih di garis pantai.
    const ring = roundedRect(half + 0.5, CORNER + 0.5);
    ring.holes.push(roundedRect(half - 0.05, CORNER - 0.05));
    const foamGeo = new THREE.ShapeGeometry(ring, 10);
    foamGeo.rotateX(Math.PI / 2);
    this.foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    this.foam.position.y = WATER_Y + 0.02;
    this.group.add(this.foam);
    this.disposables.push(foamGeo, this.foam.material as THREE.Material);

    // Hiasan pantai: batu kecil di pasir & di air, pohon kelapa di dekat sudut.
    const r = rng(level.seed);
    const rocks: THREE.BufferGeometry[] = [];
    const edge = half - BEACH / 2;
    for (let k = 0; k < 14; k++) {
      const t = r() * 2 - 1;
      const side = Math.floor(r() * 4);
      const along = t * (half - CORNER);
      const [x, z] = side === 0 ? [along, edge] : side === 1 ? [along, -edge] : side === 2 ? [edge, along] : [-edge, along];
      const s = 0.18 + r() * 0.22;
      rocks.push(place(cbox(s * 1.3, s, s, r() < 0.5 ? '#aab4bf' : '#98a3b0', 0, 0, 0, s * 0.3), x, s / 2 - 0.02, z, 0, r() * 3, 0));
    }
    for (let k = 0; k < 10; k++) {
      const a = r() * Math.PI * 2;
      const d = half + 2.5 + r() * 9;
      const s = 0.4 + r() * 0.7;
      rocks.push(place(cbox(s * 1.4, s * 1.2, s, '#8d98a6', 0, 0, 0, s * 0.3), Math.cos(a) * d, WATER_Y + s * 0.35, Math.sin(a) * d, 0, r() * 3, 0));
    }
    const rockGeo = mergeFlat(rocks);
    const rockMesh = new THREE.Mesh(rockGeo, SHARED.vertexStd);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    this.group.add(rockMesh);
    this.disposables.push(rockGeo);

    const palmGeo = palmGeometry();
    this.disposables.push(palmGeo);
    // Dua pohon kelapa di dekat tiap sudut pulau, di pasir sepanjang dua sisinya.
    const c = half - BEACH / 2 - 0.2;
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      for (const [ax, az] of [
        [c, c - 2.2],
        [c - 2.2, c],
      ]) {
        const palm = new THREE.Mesh(palmGeo, SHARED.vertexStd);
        palm.castShadow = true;
        palm.position.set(sx * ax, 0, sz * az);
        // Condong ke arah laut.
        palm.rotation.y = Math.atan2(-sz, sx) + (r() - 0.5) * 0.8;
        palm.scale.setScalar(0.85 + r() * 0.3);
        this.group.add(palm);
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.waterTex.offset.set(this.time * 0.004, this.time * 0.0025);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.6);
    (this.foam.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * pulse;
    this.foam.scale.setScalar(1 + 0.004 * pulse);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
