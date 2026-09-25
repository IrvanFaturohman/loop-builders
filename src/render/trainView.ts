import * as THREE from 'three';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';
import { itemGeometry, type ItemKind } from './items';
import { RAIL_TOP } from './railView';
import { SHARED } from './palette';

/** Warna bodi pemotong per tingkat (Lv1..Lv8). */
export const WAGON_COLORS = ['#e0463a', '#3db8f5', '#9b6bff', '#ff8a3d', '#ff5a8a', '#18c79a', '#ffc93c', '#e8eef5'];

const DARK = '#3a3f4b';
const STEEL = '#8a929e';
/** Posisi gerinda di sisi kiri pemotong (lokal: +x maju, -z kiri = luar loop = arah hutan). */
const DISC_POS = new THREE.Vector3(0, 0.36, -0.58);
/** Geser maksimum gerinda ke arah blok yang sedang digerus (supaya terlihat menekan). */
const DISC_PUSH = 0.14;
const MAX_CARGO_ITEMS = 12;
/** Kereta diangkat supaya dasar roda (y 0.01) berdiri di atas batang rel. */
const WHEEL_LIFT = RAIL_TOP - 0.01;

let locoGeo: THREE.BufferGeometry | null = null;
let hopperGeo: THREE.BufferGeometry | null = null;
const cutterGeo = new Map<number, THREE.BufferGeometry>();
const discGeo = new Map<number, THREE.BufferGeometry>();
let wheelGeo: THREE.BufferGeometry | null = null;

function locomotive(): THREE.BufferGeometry {
  if (!locoGeo) {
    const red = '#e0463a';
    locoGeo = mergeFlat([
      cbox(1.0, 0.16, 0.6, DARK, 0, 0.24, 0, 0.04),
      ccyl(0.24, 0.62, red, 14, 0.18, 0.52, 0, 0, 0, Math.PI / 2, '#b8322a'),
      ccyl(0.26, 0.06, '#ffd23f', 14, -0.05, 0.52, 0, 0, 0, Math.PI / 2),
      ccyl(0.26, 0.06, '#ffd23f', 14, 0.4, 0.52, 0, 0, 0, Math.PI / 2),
      cbox(0.36, 0.5, 0.6, red, -0.3, 0.58, 0, 0.06),
      cbox(0.44, 0.07, 0.68, DARK, -0.3, 0.86, 0, 0.03),
      cbox(0.03, 0.18, 0.4, '#bfe6ff', -0.12, 0.64, 0, 0.01),
      ccyl(0.08, 0.28, DARK, 10, 0.34, 0.86, 0),
      ccyl(0.13, 0.08, DARK, 10, 0.34, 1.02, 0),
      ccyl(0.07, 0.04, '#fff3b0', 10, 0.5, 0.56, 0, 0, 0, Math.PI / 2),
      place(colored(new THREE.ConeGeometry(0.26, 0.22, 4), '#ffd23f'), 0.55, 0.22, 0, 0, Math.PI / 4, -Math.PI / 2),
    ]);
  }
  return locoGeo;
}

/** Gerbong muatan: bak terbuka lebar berwarna kayu dengan rangka baja. */
function hopper(): THREE.BufferGeometry {
  if (!hopperGeo) {
    const wood = '#c98b4f';
    const woodDark = '#a8703e';
    hopperGeo = mergeFlat([
      cbox(0.94, 0.14, 0.62, DARK, 0, 0.24, 0, 0.04),
      cbox(0.9, 0.06, 0.6, woodDark, 0, 0.34, 0, 0.02),
      cbox(0.9, 0.32, 0.05, wood, 0, 0.52, 0.3, 0.02),
      cbox(0.9, 0.32, 0.05, wood, 0, 0.52, -0.3, 0.02),
      cbox(0.05, 0.32, 0.6, wood, 0.44, 0.52, 0, 0.02),
      cbox(0.05, 0.32, 0.6, wood, -0.44, 0.52, 0, 0.02),
      // rangka baja di sudut & bibir bak
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cbox(0.07, 0.36, 0.07, STEEL, sx * 0.44, 0.52, sz * 0.3, 0.015))),
      cbox(0.94, 0.04, 0.07, STEEL, 0, 0.69, 0.3, 0.01),
      cbox(0.94, 0.04, 0.07, STEEL, 0, 0.69, -0.3, 0.01),
      cbox(0.07, 0.04, 0.64, STEEL, 0.44, 0.69, 0, 0.01),
      cbox(0.07, 0.04, 0.64, STEEL, -0.44, 0.69, 0, 0.01),
    ]);
  }
  return hopperGeo;
}

/** Gerbong pemotong: sasis, rumah mesin berwarna tingkat, dan dudukan lengan di sisi kiri. */
function cutterBody(level: number): THREE.BufferGeometry {
  let g = cutterGeo.get(level);
  if (!g) {
    const c = WAGON_COLORS[(level - 1) % WAGON_COLORS.length];
    const d = shade(c, -0.14);
    g = mergeFlat([
      cbox(0.86, 0.14, 0.56, DARK, 0, 0.24, 0, 0.04),
      cbox(0.72, 0.34, 0.5, c, 0, 0.48, 0.02, 0.08),
      cbox(0.76, 0.06, 0.54, d, 0, 0.67, 0.02, 0.03),
      // kisi mesin & knalpot
      cbox(0.3, 0.04, 0.3, DARK, -0.12, 0.71, 0.06, 0.01),
      ccyl(0.04, 0.2, DARK, 8, 0.24, 0.8, 0.14),
      // dudukan gerinda (sisi kiri)
      cbox(0.3, 0.12, 0.3, STEEL, 0, 0.42, -0.36, 0.03),
      ccyl(0.07, 0.16, d, 10, 0, 0.5, -0.58),
    ]);
    cutterGeo.set(level, g);
  }
  return g;
}

/** Gerinda horizontal (sumbu putar = y) bergerigi; makin besar tiap tingkat. */
function disc(level: number): THREE.BufferGeometry {
  let g = discGeo.get(level);
  if (!g) {
    const r = discRadius(level);
    const parts = [ccyl(r, 0.04, '#dfe6ee', 24), ccyl(r * 0.3, 0.1, '#f25a4a', 12, 0, 0.02, 0), ccyl(0.035, 0.22, STEEL, 8, 0, 0.12, 0)];
    const teeth = 14 + level * 2;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      parts.push(place(cbox(0.09, 0.03, 0.05, '#c8d0da', 0, 0, 0, 0.004), Math.cos(a) * r, 0, Math.sin(a) * r, 0, -a + 0.6, 0));
    }
    g = mergeFlat(parts);
    discGeo.set(level, g);
  }
  return g;
}

function discRadius(level: number): number {
  return 0.26 + 0.035 * (level - 1);
}

function wheels(): THREE.BufferGeometry {
  if (!wheelGeo) {
    wheelGeo = mergeFlat([ccyl(0.12, 0.08, '#2b313c', 12, 0, 0, 0.27, Math.PI / 2, 0, 0, '#9aa1ab'), ccyl(0.12, 0.08, '#2b313c', 12, 0, 0, -0.27, Math.PI / 2, 0, 0, '#9aa1ab')]);
  }
  return wheelGeo;
}

function shade(hex: string, l: number): string {
  return '#' + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();

/** Satu mobil (lokomotif, gerbong muatan, atau pemotong) yang diposisikan di rel oleh TrainView. */
class Car {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly axles: THREE.Mesh[] = [];
  heading = 0;
  headingInit = false;
  bump = 0;

  constructor(geo: THREE.BufferGeometry, axles: number[]) {
    this.body = new THREE.Mesh(geo, SHARED.vertexStd);
    this.body.castShadow = true;
    this.group.add(this.body);
    for (const x of axles) {
      const a = new THREE.Mesh(wheels(), SHARED.vertexStd);
      a.position.set(x, 0.13, 0);
      this.axles.push(a);
      this.group.add(a);
    }
  }
}

/** Pemotong: gerinda horizontal menempel di sisi kirinya (anak mobil, ikut berbelok). */
class Cutter extends Car {
  readonly disc: THREE.Mesh;
  level = 1;
  /** 0 = diam di dudukan, 1 = menekan blok target. */
  engaged = 0;

  constructor() {
    super(cutterBody(1), [0.28, -0.28]);
    this.disc = new THREE.Mesh(disc(1), SHARED.vertexStd);
    this.disc.castShadow = true;
    this.disc.position.copy(DISC_POS);
    this.group.add(this.disc);
  }

  setLevel(level: number): void {
    this.level = level;
    this.body.geometry = cutterBody(level);
    this.disc.geometry = disc(level);
    const s = 1 + 0.05 * (level - 1);
    this.group.scale.setScalar(s);
  }
}

/**
 * Kereta: lokomotif → satu gerbong muatan → gerbong pemotong. Posisi tiap mobil dihitung dari
 * jarak lintasan (dari simulasi) sehingga seluruh rangkaian mengikuti tikungan dengan benar.
 * Indeks gerbong untuk World: 0 = gerbong muatan, i ≥ 1 = pemotong ke-(i-1).
 */
export class TrainView {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  private readonly loco: Car;
  private readonly cargoCar: Car;
  private readonly cargoItems: THREE.InstancedMesh;
  private cutters: Cutter[] = [];
  private levels: number[] = [];
  private wheelSpin = 0;
  private discSpin = 0;
  private time = 0;
  popIndex = -1;
  private popT = 0;

  constructor(cargoKind: ItemKind) {
    this.loco = new Car(locomotive(), [0.3, 0, -0.3]);
    this.cargoCar = new Car(hopper(), [0.3, -0.3]);
    this.cargoItems = new THREE.InstancedMesh(itemGeometry(cargoKind), SHARED.vertexStd, MAX_CARGO_ITEMS);
    this.cargoItems.count = 0;
    this.cargoItems.frustumCulled = false;
    this.cargoCar.group.add(this.cargoItems);
    this.group.add(this.loco.group, this.cargoCar.group);
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), SHARED.invisible);
    this.hit.userData = { type: 'train' };
    this.loco.group.add(this.hit);
  }

  /** Samakan jumlah & tingkat pemotong dengan state. */
  setCutters(levels: number[]): void {
    const same = levels.length === this.levels.length && levels.every((l, i) => l === this.levels[i]);
    if (same) return;
    while (this.cutters.length < levels.length) {
      const c = new Cutter();
      this.cutters.push(c);
      this.group.add(c.group);
    }
    while (this.cutters.length > levels.length) {
      const c = this.cutters.pop()!;
      this.group.remove(c.group);
    }
    levels.forEach((l, i) => this.cutters[i].setLevel(l));
    this.levels = [...levels];
  }

  /** Posisi dunia lokomotif (untuk kamera & label). */
  locoPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.loco.group.position);
  }

  /** 0 = gerbong muatan, i ≥ 1 = pemotong ke-(i-1). */
  wagonPosition(i: number, out: THREE.Vector3): THREE.Vector3 {
    const car = i <= 0 ? this.cargoCar : (this.cutters[Math.min(this.cutters.length - 1, i - 1)] ?? this.cargoCar);
    return out.copy(car.group.position).setY(0.6);
  }

  /** Titik sentuh gerinda pemotong k (dunia), atau null bila tidak sedang menggerus. */
  contactPoint(k: number, out: THREE.Vector3): THREE.Vector3 | null {
    const c = this.cutters[k];
    if (!c || c.engaged < 0.5) return null;
    return c.disc.getWorldPosition(out);
  }

  bumpWagon(i: number): void {
    const car = i <= 0 ? this.cargoCar : this.cutters[i - 1];
    if (car) car.bump = 1;
  }

  pop(i: number): void {
    this.popIndex = i;
    this.popT = 0;
  }

  /**
   * pointAt(d) & tangentAt(d) disuplai World (lintasan rel sekarang).
   * fill = 0..1 isi muatan; targets[k] = pusat blok yang digerus pemotong k (dunia) atau null.
   */
  update(
    dt: number,
    locoD: number,
    spacing: number,
    pointAt: (d: number, out: THREE.Vector3) => THREE.Vector3,
    tangentAt: (d: number, out: THREE.Vector3) => THREE.Vector3,
    speed: number,
    fill: number,
    targets: (THREE.Vector3 | null)[],
    boost: number,
  ): void {
    this.time += dt;
    this.wheelSpin -= speed * dt * 8;
    const cutting = targets.some((t) => t !== null);
    // Gerinda hanya berputar saat kereta jalan (sama seperti di simulasi).
    this.discSpin += (speed > 0.01 ? (cutting ? 24 : 12) : 0) * dt;
    const tan = new THREE.Vector3();
    const placeCar = (car: Car, d: number, idx: number) => {
      pointAt(d, car.group.position);
      tangentAt(d, tan);
      const h = Math.atan2(-tan.z, tan.x);
      if (!car.headingInit) {
        car.heading = h;
        car.headingInit = true;
      }
      let dh = h - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      car.heading += dh * (1 - Math.exp(-dt * 18));
      car.group.rotation.y = car.heading;
      for (const a of car.axles) a.rotation.z = this.wheelSpin;
      car.bump = Math.max(0, car.bump - dt * 5);
      const b = Math.sin(car.bump * Math.PI) * 0.12;
      let pop = 0;
      if (idx === this.popIndex) {
        this.popT += dt;
        pop = Math.sin(Math.min(1, this.popT / 0.45) * Math.PI) * 0.4;
        if (this.popT > 0.45) this.popIndex = -1;
      }
      car.body.scale.set(1 + b * 0.5 + pop, 1 - b + pop, 1 + b * 0.5 + pop);
      car.group.position.y = WHEEL_LIFT + Math.abs(Math.sin(this.time * 14 + idx)) * 0.02 * Math.min(1, speed) + pop * 0.6;
      car.group.updateMatrixWorld();
    };
    placeCar(this.loco, locoD, -1);
    this.loco.body.rotation.z = (boost - 1) * 0.1;

    placeCar(this.cargoCar, locoD - spacing, 0);
    const n = Math.round(Math.min(1, fill) * MAX_CARGO_ITEMS);
    for (let k = 0; k < n; k++) {
      const layer = Math.floor(k / 6);
      const j = k % 6;
      _p.set(((j % 3) - 1) * 0.26, 0.5 + layer * 0.17, j < 3 ? 0.12 : -0.12);
      _q.setFromAxisAngle(_s.set(0, 1, 0), Math.PI / 2 + (k % 2) * 0.15);
      _s.setScalar(0.95);
      _m.compose(_p, _q, _s);
      this.cargoItems.setMatrixAt(k, _m);
    }
    this.cargoItems.count = n;
    this.cargoItems.instanceMatrix.needsUpdate = true;

    this.cutters.forEach((c, i) => {
      placeCar(c, locoD - (i + 2) * spacing, i + 1);
      this.aimDisc(c, targets[i] ?? null, dt);
    });
  }

  /** Gerinda tetap di dudukannya, sedikit terdorong ke arah blok yang sedang digerus. */
  private aimDisc(c: Cutter, target: THREE.Vector3 | null, dt: number): void {
    c.engaged += ((target ? 1 : 0) - c.engaged) * (1 - Math.exp(-dt * 12));
    c.disc.position.copy(DISC_POS);
    if (target) {
      const local = c.group.worldToLocal(_a.copy(target)).setY(DISC_POS.y).sub(DISC_POS);
      const len = local.length();
      if (len > 1e-3) c.disc.position.addScaledVector(local, (Math.min(DISC_PUSH, len) / len) * c.engaged);
      c.disc.position.y += Math.sin(this.time * 60 + c.level) * 0.012;
    }
    c.disc.rotation.set(0, this.discSpin * (1 + 0.1 * c.level), 0);
  }

  /** Titik cerobong (dunia) untuk asap. */
  chimney(out: THREE.Vector3): THREE.Vector3 {
    return this.loco.group.localToWorld(out.set(0.34, 1.1, 0));
  }
}
