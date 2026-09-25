import * as THREE from 'three';
import { cityPlanOf, type ParkSlot, type RoadPiece } from '../game/layout';
import { depthAt, type Rail } from '../game/rail';
import { fieldFor } from '../game/worldgen';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';
import { SHARED } from './palette';
import { grassPiece, tileToWorld, type P2 } from './railShape';

const PAVE = '#eadcc2';
const ROAD = '#b9b4aa';
const CURB = '#ece6d8';
const CURB_W = 0.06;
const LAWN = '#8fd16a';

/** Rumput di sisi kanan tiap jenis ubin rel (lurus, belok kanan, belok kiri) + triangulasinya. */
const RAIL_GRASS = [0, 1, -1].map((turn) => {
  const pts = grassPiece(turn);
  const tris = THREE.ShapeUtils.triangulateShape(
    pts.map((p) => new THREE.Vector2(p.x, p.z)),
    [],
  );
  return { turn, pts, tris };
});

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = LAWN;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#84c85f';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.repeat.set(0.5, 0.5);
  return t;
}

/** Potongan jalan: permukaan + dua tepi trotoar terang. Jalan raya sedikit lebih tinggi supaya persimpangan tidak berkedip. */
function roadGeometry(r: RoadPiece): THREE.BufferGeometry {
  const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
  const y = r.w > 0.6 ? 0.018 : 0.014;
  const g = mergeFlat([
    cbox(len + 0.02, 0.01, r.w - CURB_W * 2, ROAD, 0, 0, 0, 0),
    cbox(len + 0.02, 0.012, CURB_W, CURB, 0, 0.001, r.w / 2 - CURB_W / 2, 0),
    cbox(len + 0.02, 0.012, CURB_W, CURB, 0, 0.001, -r.w / 2 + CURB_W / 2, 0),
  ]);
  g.rotateY(Math.atan2(-(r.z1 - r.z0), r.x1 - r.x0));
  g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  return g;
}

function hash(x: number, z: number): number {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function tree(x: number, z: number, s: number, leaf: string): THREE.BufferGeometry[] {
  return [cbox(0.1 * s, 0.4 * s, 0.1 * s, '#7a5230', x, 0.2 * s, z, 0.02), place(colored(new THREE.IcosahedronGeometry(0.3 * s, 0), leaf), x, 0.55 * s, z)];
}

function bench(x: number, z: number, rotY: number): THREE.BufferGeometry {
  const g = mergeFlat([cbox(0.4, 0.04, 0.12, '#b98246', 0, 0.14, 0, 0.01), cbox(0.4, 0.1, 0.03, '#b98246', 0, 0.22, -0.06, 0.01), cbox(0.04, 0.14, 0.1, '#5b6474', -0.16, 0.07, 0, 0), cbox(0.04, 0.14, 0.1, '#5b6474', 0.16, 0.07, 0, 0)]);
  g.rotateY(rotY);
  g.translate(x, 0, z);
  return g;
}

/**
 * Hiasan satu slot taman (lokal: +z menghadap jalan, lalu diputar & dipindah ke posisinya):
 * kebun (pohon, bunga, bangku), taman bermain, kolam, atau taman sudut dengan pohon besar.
 */
function parkGeometry(p: ParkSlot): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [cbox(p.w - 0.1, 0.03, p.d - 0.1, '#86c95f', 0, 0.015, 0, 0.1)];
  const kind = p.corner ? 3 : Math.floor(hash(p.pos.x, p.pos.z) * 3);
  if (kind === 0) {
    parts.push(...tree(-0.55, -0.35, 1.1, '#4fae4a'), ...tree(0.6, -0.4, 0.9, '#62c057'));
    for (const [x, c] of [
      [-0.5, '#ff7aa2'],
      [-0.2, '#ffd24a'],
      [0.25, '#ffffff'],
      [0.55, '#b388ff'],
    ] as const)
      parts.push(place(colored(new THREE.IcosahedronGeometry(0.09, 0), c), x, 0.1, 0.45));
    parts.push(bench(0.05, 0.1, 0));
  } else if (kind === 1) {
    // Taman bermain: pasir, perosotan, ayunan.
    parts.push(cbox(1.2, 0.02, 0.9, '#f0d49a', 0.1, 0.035, 0.05, 0.1));
    parts.push(cbox(0.08, 0.5, 0.08, '#ff5a5f', -0.3, 0.25, -0.2, 0.01), cbox(0.08, 0.5, 0.08, '#ff5a5f', -0.1, 0.25, -0.2, 0.01), cbox(0.3, 0.04, 0.3, '#ff5a5f', -0.2, 0.5, -0.2, 0.01));
    const slide = cbox(0.22, 0.03, 0.62, '#3d9bff', 0, 0, 0, 0.01);
    slide.rotateX(0.75);
    slide.translate(-0.2, 0.27, 0.12);
    parts.push(slide);
    for (const x of [0.35, 0.75]) parts.push(cbox(0.05, 0.6, 0.05, '#ffcf3a', x, 0.3, -0.1, 0.01));
    parts.push(cbox(0.5, 0.05, 0.05, '#ffcf3a', 0.55, 0.6, -0.1, 0.01), cbox(0.16, 0.03, 0.1, '#6c7bd6', 0.55, 0.22, -0.1, 0.01));
    parts.push(...tree(0.75, 0.5, 0.8, '#4fae4a'));
  } else if (kind === 2) {
    // Kolam kecil dengan bebek, bangku, dan pohon.
    parts.push(ccyl(0.55, 0.03, '#b9c0c9', 18, -0.15, 0.04, -0.05), ccyl(0.48, 0.035, '#6fc8ff', 18, -0.15, 0.05, -0.05));
    parts.push(bench(0.6, 0.45, -Math.PI / 2), ...tree(0.65, -0.45, 0.9, '#62c057'));
    parts.push(cbox(0.14, 0.08, 0.1, '#ffffff', -0.2, 0.1, -0.1, 0.03), cbox(0.05, 0.05, 0.05, '#ffb300', -0.12, 0.12, -0.1, 0.01));
  } else {
    // Taman sudut: lingkaran paving, pohon besar, dua bangku.
    parts.push(ccyl(0.62, 0.03, PAVE, 16, 0, 0.04, 0));
    parts.push(...tree(0, 0, 1.6, '#3f9b45'));
    parts.push(bench(-0.55, 0, Math.PI / 2), bench(0.55, 0, -Math.PI / 2));
  }
  const g = mergeFlat(parts);
  g.rotateY(Math.atan2(p.facing.x, p.facing.z));
  g.translate(p.pos.x, 0, p.pos.z);
  return g;
}

/**
 * Tanah kota: rumput di semua lahan di belakang rel (ikut tumbuh setiap rel maju), jaringan
 * jalan grid yang muncul sepotong demi sepotong saat lahannya sudah di dalam rel, taman di slot
 * kosong, alun-alun dan air mancur di tengah. Hanya tampilan — rencana kota dari layout.ts.
 */
export class CityView {
  readonly group = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly roads: THREE.Mesh;
  private readonly parks: THREE.Mesh;
  private readonly roadGeos: THREE.BufferGeometry[];
  private readonly parkGeos: THREE.BufferGeometry[];
  private readonly plan: ReturnType<typeof cityPlanOf>;
  private roadMask = '';
  private parkMask = '';
  private readonly water: THREE.Mesh;
  private time = 0;

  constructor(rail: Rail) {
    this.plan = cityPlanOf(rail.levelIndex);
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
    this.ground.receiveShadow = true;
    this.ground.position.y = 0.008;
    this.roadGeos = this.plan.roads.map(roadGeometry);
    this.parkGeos = this.plan.parks.map(parkGeometry);
    this.roads = new THREE.Mesh(new THREE.BufferGeometry(), SHARED.vertexStd);
    this.roads.receiveShadow = true;
    this.parks = new THREE.Mesh(new THREE.BufferGeometry(), SHARED.vertexStd);
    this.parks.receiveShadow = true;
    this.parks.castShadow = true;

    const fountain = new THREE.Mesh(
      mergeFlat([ccyl(0.62, 0.16, '#b9c0c9', 20, 0, 0.08, 0), ccyl(0.16, 0.5, '#d7dde4', 10, 0, 0.3, 0), ccyl(0.3, 0.06, '#b9c0c9', 14, 0, 0.5, 0)]),
      SHARED.vertexStd,
    );
    fountain.castShadow = true;
    this.water = new THREE.Mesh(new THREE.CircleGeometry(0.54, 20), new THREE.MeshStandardMaterial({ color: '#6fc8ff', roughness: 0.2, metalness: 0.1 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.15;
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), new THREE.MeshStandardMaterial({ color: PAVE, roughness: 1 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;

    this.group.add(this.ground, this.roads, this.parks, plaza, fountain, this.water);
    this.setRail(rail);
  }

  /** Bangun ulang tanah, jalan, dan taman mengikuti rel sekarang (dipanggil tiap rel maju). */
  setRail(rail: Rail): void {
    // Tanah: satu kotak per sel di belakang rel, ditambah rumput di sisi kanan tiap ubin rel
    // sehingga kota selalu menempel ke rel dan melengkung mengikuti belokannya.
    const f = fieldFor(rail.levelIndex);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const t of rail.tiles) {
      const piece = RAIL_GRASS.find((g) => g.turn === t.turn)!;
      const v = pos.length / 3;
      for (const p of piece.pts) {
        const w: P2 = tileToWorld(p, t.x, t.z, t.dir);
        pos.push(w.x, 0, w.z);
        uv.push(w.x * 0.5, w.z * 0.5);
      }
      for (const [a, b, c] of piece.tris) {
        const pa = piece.pts[a];
        const pb = piece.pts[b];
        const pc = piece.pts[c];
        // Hadap ke atas (+y): di bidang x-z berarti urutan searah jarum jam dilihat dari atas.
        const up = (pb.x - pa.x) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.x - pa.x) < 0;
        idx.push(v + a, up ? v + b : v + c, up ? v + c : v + b);
      }
    }
    for (let c = 0; c < f.n; c++) {
      if (rail.depth[c] < 2) continue;
      const x0 = f.x[c] - 0.5;
      const z0 = f.z[c] - 0.5;
      const v = pos.length / 3;
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        pos.push(x0 + dx, 0, z0 + dz);
        uv.push((x0 + dx) * 0.5, (z0 + dz) * 0.5);
      }
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.ground.geometry.dispose();
    this.ground.geometry = geo;

    // Jalan: potongan yang ujung & tengahnya sudah di dalam rel.
    const inside = (x: number, z: number) => depthAt(rail, x, z) >= 2;
    const roadOn = this.plan.roads.map((r) => inside(r.x0, r.z0) && inside(r.x1, r.z1) && inside((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2));
    const roadMask = roadOn.map((v) => (v ? 1 : 0)).join('');
    if (roadMask !== this.roadMask) {
      this.roadMask = roadMask;
      this.roads.geometry.dispose();
      const on = this.roadGeos.filter((_, i) => roadOn[i]);
      this.roads.geometry = on.length ? mergeFlat(on) : new THREE.BufferGeometry();
    }

    // Taman: slot yang keempat sudutnya sudah jauh di dalam rel (sama seperti kavling terbuka).
    const deep = (x: number, z: number) => depthAt(rail, x, z) >= 3;
    const parkOn = this.plan.parks.map((p) => {
      const hx = (Math.abs(p.facing.x) > 0 ? p.d : p.w) / 2 - 0.05;
      const hz = (Math.abs(p.facing.x) > 0 ? p.w : p.d) / 2 - 0.05;
      return deep(p.pos.x - hx, p.pos.z - hz) && deep(p.pos.x + hx, p.pos.z - hz) && deep(p.pos.x - hx, p.pos.z + hz) && deep(p.pos.x + hx, p.pos.z + hz);
    });
    const parkMask = parkOn.map((v) => (v ? 1 : 0)).join('');
    if (parkMask !== this.parkMask) {
      this.parkMask = parkMask;
      this.parks.geometry.dispose();
      const on = this.parkGeos.filter((_, i) => parkOn[i]);
      this.parks.geometry = on.length ? mergeFlat(on) : new THREE.BufferGeometry();
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.water.position.y = 0.15 + Math.sin(this.time * 3) * 0.01;
  }

  dispose(): void {
    this.ground.geometry.dispose();
    this.roads.geometry.dispose();
    this.parks.geometry.dispose();
    for (const g of this.roadGeos) g.dispose();
    for (const g of this.parkGeos) g.dispose();
  }
}
