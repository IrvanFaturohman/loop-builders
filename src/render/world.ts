import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { completedModuleCount } from '../game/building';
import { capacity, cargoTotal, isPlotComplete, isPlotUnlocked, plotProject, plotTarget, plotsOf, trainSpeed } from '../game/economy';
import type { GameEvent } from '../game/events';
import { islandBounds, type ResolvedPlot } from '../game/layout';
import { railMapping, railOf, type Rail } from '../game/rail';
import type { GameState, LevelDefinition, Runtime } from '../game/types';
import { fieldFor, KINDS } from '../game/worldgen';
import { fmt } from '../ui/format';
import { CameraRig, type SafeArea } from './cameraRig';
import { CityView } from './cityView';
import { Effects } from './effects';
import { buildEnvironment, type EnvironmentBuild } from './environment';
import { ForestView } from './forestView';
import { cbox, ccyl, mergeFlat } from './geom';
import type { ItemKind } from './items';
import { LabelLayer, type WorldLabel } from './labels';
import { SHARED, THEMES } from './palette';
import { PlotView } from './plotView';
import { TrackView } from './trackView';
import { TrainView } from './trainView';

export interface WorldHooks {
  onModulePop(index: number): void;
  onCut(kind: string): void;
}

interface Float {
  label: WorldLabel;
  t: number;
  key: string;
  amount: number;
}

/** Durasi morph rel setiap kali maju (kecil & sering). */
const RAIL_MORPH = 0.3;
const MAX_FLOATS = 16;
/** Leaf/serpihan per jenis blok saat tumbang. */
const CHIP_COLORS: Record<string, string> = { tree: '#6ccf58', treeGold: '#ffd24a', treeRed: '#f06a55', rock: '#b7bdc6', crystal: '#ff7a8f' };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Titik atap gudang stasiun (lokal) — tujuan muatan yang dibongkar & asal bahan ke kota. */
const DEPOT = new THREE.Vector3(0, 1.25, -1.5);

/**
 * Stasiun (lokal, alas di y=0, pusat di garis tengah rel, -z = ke dalam loop):
 * kanopi di atas rel yang dilewati kereta, dan gudang di sisi dalam dengan corong kuning.
 */
function stationGeometry(): THREE.BufferGeometry {
  const post = '#5b6a80';
  return mergeFlat([
    // kanopi dari sisi dalam, menjorok di atas rel (tidak menutupi baris hutan di sisi luar)
    ...[-0.95, 0.95].map((x) => ccyl(0.06, 1.4, post, 8, x, 0.7, -0.78)),
    cbox(2.3, 0.1, 1.35, '#e0463a', 0, 1.45, -0.2, 0.04),
    cbox(2.1, 0.06, 1.2, '#f6e7c8', 0, 1.38, -0.2, 0.03),
    cbox(0.9, 0.34, 0.06, '#2f8f8c', 0, 1.7, -0.3, 0.04),
    // peron & gudang di sisi dalam
    cbox(2.2, 0.12, 0.5, '#d9d4c8', 0, 0.06, -0.72, 0.03),
    cbox(1.9, 0.12, 1.3, '#d9d4c8', 0, 0.06, -1.5, 0.05),
    cbox(1.5, 0.8, 1.0, '#7f8ea3', 0, 0.52, -1.5, 0.1),
    cbox(1.62, 0.1, 1.12, '#6b7a8f', 0, 0.96, -1.5, 0.04),
    cbox(1.1, 0.3, 0.8, '#ffc93c', 0, 1.14, -1.5, 0.08),
    cbox(0.7, 0.08, 0.5, '#3a3f4b', 0, 1.3, -1.5, 0.03),
    cbox(0.5, 0.5, 0.05, '#5b6a80', 0, 0.37, -0.99, 0.04),
  ]);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly labels: LabelLayer;
  readonly effects = new Effects();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private levelRoot = new THREE.Group();
  private level!: LevelDefinition;
  private plotsDef: ResolvedPlot[] = [];
  private track!: TrackView;
  private forest!: ForestView;
  private train!: TrainView;
  private station!: THREE.Group;
  private stationBounce = 0;
  private plots: PlotView[] = [];
  private plotLabels: WorldLabel[] = [];
  private cargoLabel!: WorldLabel;
  private wagonLabels: WorldLabel[] = [];
  private env: EnvironmentBuild | null = null;
  private floats: Float[] = [];
  private smokeTimer = 0;
  private city!: CityView;
  private rail!: Rail;
  private readonly openDistricts = new Set<number>();
  private sparkTimer = 0;
  private readonly aimPool: THREE.Vector3[] = [];
  private width = 1;
  private height = 1;
  private safe: SafeArea = { xL: -0.92, xR: 0.92, yB: -0.6, yT: 0.7 };
  private raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private followDist = 18;
  /** Detik sejak pemain terakhir menggeser/zoom; kamera kembali mengikuti kereta setelah jeda. */
  private manualIdle = 99;
  overviewMode = false;
  private itemKind: ItemKind = 'wood';

  constructor(
    canvas: HTMLCanvasElement,
    labelRoot: HTMLElement,
    private readonly hooks: WorldHooks,
  ) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.rig = new CameraRig(1);
    this.labels = new LabelLayer(labelRoot);

    this.hemi = new THREE.HemisphereLight('#dff2ff', '#8a9a6a', 1.35);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.levelRoot, this.effects.group);
  }

  // ---------------------------------------------------------------------------
  // Level
  // ---------------------------------------------------------------------------

  loadLevel(state: GameState): void {
    this.disposeLevel();
    this.level = LEVELS[state.levelIndex];
    this.plotsDef = plotsOf(state.levelIndex);
    this.itemKind = this.level.material === 'brick' ? 'stone' : 'wood';
    const palette = THEMES[this.level.theme];
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.fog, 40, 110);

    // Rel
    this.rail = railOf(state);
    this.track = new TrackView(palette, this.rail.track, [], { gate: false, style: 'rail' });
    this.levelRoot.add(this.track.group);

    // Hutan
    this.forest = new ForestView(state.levelIndex, this.level.theme === 'meadow' ? '#caa672' : '#c79a62');
    this.levelRoot.add(this.forest.group);

    // Tanah kota di dalam rel (tumbuh tiap rel melebar) & stasiun di rel
    this.city = new CityView(this.level, this.rail);
    this.levelRoot.add(this.city.group);
    this.forest.setRail(this.rail);
    this.openDistricts.clear();
    this.plotsDef.forEach((p, i) => isPlotUnlocked(state, i) && this.openDistricts.add(p.district));
    this.station = new THREE.Group();
    const sm = new THREE.Mesh(stationGeometry(), SHARED.vertexStd);
    sm.castShadow = true;
    sm.receiveShadow = true;
    this.station.add(sm);
    this.placeStation();
    this.levelRoot.add(this.station);

    // Kavling (muncul saat distriknya terbuka)
    this.plotsDef.forEach((p, i) => {
      const proj = plotProject(state, i);
      const pv = new PlotView(p, proj, completedModuleCount(proj, state.plots[i]), palette.site, '#8fd16a');
      pv.building.onModulePop = (pos, index) => {
        this.effects.puff(pos, { count: 3, size: 0.16, spread: 1.1, color: '#f7efdf' });
        this.hooks.onModulePop(index);
      };
      pv.setVisible(isPlotUnlocked(state, i), false);
      this.plots.push(pv);
      this.levelRoot.add(pv.group);
      this.plotLabels.push(this.labels.create('plot-label'));
    });

    // Kereta
    this.train = new TrainView(this.itemKind);
    this.levelRoot.add(this.train.group);
    this.cargoLabel = this.labels.create('cargo-label');

    // Lingkungan di luar hutan
    const half = fieldFor(state.levelIndex).half + 0.5;
    this.env = buildEnvironment(this.level.theme, palette, [{ minX: -half, maxX: half, minZ: -half, maxZ: half }], { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 }, null);
    this.levelRoot.add(this.env.group);

    const ext = half + 2;
    this.sun.position.set(-10, 24, 13);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();

    // Jarak ikut kamera: cukup untuk melihat stasiun + sebagian cabang di layar portrait.
    this.rig.fit(this.regionPoints(-4.6, 4.6, -4.6, 4.6), this.safe, { immediate: true });
    this.followDist = this.rig.goalDist;
    this.overviewMode = false;
    this.manualIdle = 99;
    this.syncTrain(state, 0, 0, 1);
    this.train.locoPosition(_v);
    this.rig.follow(_v.x, _v.z, this.followDist);
    this.rig.update(10);
  }

  /** Stasiun di titik rel jarak 0 (tengah sisi bawah); ikut maju & miring bersama rel (termasuk morph). */
  private placeStation(): void {
    this.track.pointAt(0, _v);
    this.station.position.set(_v.x, 0, _v.z);
    this.track.tangentAt(0, _v2);
    this.station.rotation.y = Math.atan2(-_v2.z, _v2.x) - Math.PI;
  }

  private depot(out: THREE.Vector3): THREE.Vector3 {
    this.station.updateMatrixWorld();
    return this.station.localToWorld(out.copy(DEPOT));
  }

  private disposeLevel(): void {
    this.labels.clear();
    this.plotLabels = [];
    this.wagonLabels = [];
    this.floats = [];
    this.track?.dispose();
    this.forest?.dispose();
    this.city?.dispose();
    for (const p of this.plots) p.dispose();
    this.plots = [];
    this.env?.dispose();
    this.env = null;
    this.effects.clear();
    this.scene.remove(this.levelRoot);
    this.levelRoot = new THREE.Group();
    this.scene.add(this.levelRoot);
  }

  // ---------------------------------------------------------------------------
  // Kamera
  // ---------------------------------------------------------------------------

  private regionPoints(minX: number, maxX: number, minZ: number, maxZ: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) for (const y of [0, 1.5]) pts.push(new THREE.Vector3(x, y, z));
    return pts;
  }

  resize(width: number, height: number, safeTopPx: number, safeBottomPx: number, safeRightPx: number, state: GameState | null): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.rig.setAspect(this.width / this.height);
    const top = 1 - (2 * safeTopPx) / this.height;
    const bottom = -1 + (2 * safeBottomPx) / this.height;
    const right = 0.94 - (2 * safeRightPx) / this.width;
    this.safe = { xL: -0.92, xR: Math.max(-0.4, right - 0.02), yB: Math.min(bottom, top - 0.3), yT: top };
    if (state && this.level) {
      this.rig.fit(this.regionPoints(-4.6, 4.6, -4.6, 4.6), this.safe, { immediate: false });
      this.followDist = this.rig.goalDist;
      if (this.overviewMode) this.frameOverview(state);
    }
  }

  private frameOverview(state: GameState): void {
    const b = this.rail.track.bounds();
    void state;
    this.rig.fit(this.regionPoints(b.minX - 1.5, b.maxX + 1.5, b.minZ - 1.5, b.maxZ + 1.5), this.safe, { ease: 2 });
  }

  /** Tombol peta: lihat seluruh jalur ↔ kembali mengikuti kereta. */
  toggleOverview(state: GameState): boolean {
    this.overviewMode = !this.overviewMode;
    if (this.overviewMode) this.frameOverview(state);
    else this.manualIdle = 99;
    return this.overviewMode;
  }

  pan(dxPx: number, dyPx: number, rect: DOMRect): void {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const a = this.groundAt(cx, cy, rect);
    const b = this.groundAt(cx + dxPx, cy + dyPx, rect);
    if (!a || !b) return;
    this.manualIdle = 0;
    this.rig.shift(a.x - b.x, a.z - b.z);
  }

  zoom(f: number): void {
    this.manualIdle = 0;
    this.rig.zoom(f);
    if (!this.overviewMode) this.followDist = THREE.MathUtils.clamp(this.followDist * f, 7, 60);
  }

  private groundAt(clientX: number, clientY: number, rect: DOMRect): THREE.Vector3 | null {
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.rig.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  // ---------------------------------------------------------------------------
  // Event → efek
  // ---------------------------------------------------------------------------

  handleEvents(events: GameEvent[], state: GameState): void {
    let chips = 0;
    for (const e of events) {
      switch (e.type) {
        case 'cut': {
          if (chips++ > 10) break; // batas keras partikel per frame
          const kind = KINDS[fieldFor(state.levelIndex).kind[e.cell]];
          const pos = this.forest.cellPos(e.cell, new THREE.Vector3());
          this.effects.puff(pos, { count: 3, size: 0.2, spread: 1.4, up: 1.2, color: CHIP_COLORS[kind] ?? '#6ccf58', life: 0.5 });
          const item: ItemKind = e.res === 'wood' ? 'wood' : e.res === 'stone' ? 'stone' : 'gem';
          this.effects.fly(item, pos, this.train.wagonPosition(0, new THREE.Vector3()), { dur: 0.32, height: 0.9, scale: 0.8, getTo: () => this.train.wagonPosition(0, _v2), onLand: () => this.train.bumpWagon(0) });
          this.hooks.onCut(kind);
          break;
        }
        case 'unload': {
          const st = this.depot(new THREE.Vector3());
          const n = Math.min(10, 3 + Math.floor(e.points / 10));
          for (let i = 0; i < n; i++) {
            this.effects.fly(this.itemKind, this.train.wagonPosition(0, new THREE.Vector3()), st.clone().add(_v.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), {
              delay: i * 0.04,
              dur: 0.36,
              height: 1.4,
              onLand: i === n - 1 ? () => (this.stationBounce = 1) : undefined,
            });
          }
          this.rig.bump(0.1 + Math.min(0.3, Math.log10(1 + e.points) * 0.1));
          break;
        }
        case 'deliver': {
          const pv = this.plots[e.plot];
          const targets = pv.building.scheduleModules(e.fromModule, e.toModule, 0.26);
          const n = Math.min(e.amount, 8);
          const from = this.depot(new THREE.Vector3());
          for (let i = 0; i < n; i++) {
            const to = targets[i % targets.length].clone();
            this.effects.fly(this.itemKind, from, to, {
              delay: 0.3 + i * 0.05,
              dur: 0.5,
              height: 2.2,
              onLand: i === 0 ? () => this.effects.puff(to, { count: 3, size: 0.2, spread: 1.2 }) : undefined,
            });
          }
          this.float(`d${e.plot}`, e.money, 'float-rent', pv.topWorld(new THREE.Vector3()));
          break;
        }
        case 'plotComplete': {
          const pv = this.plots[e.plot];
          pv.markComplete();
          pv.building.stageBounce(1.4);
          const top = pv.topWorld(new THREE.Vector3());
          this.effects.sparkle(top, 14);
          this.effects.confettiBurst(top, 26);
          this.float(`b${e.plot}`, e.bonus, 'float-sell', top.clone().setY(top.y + 0.6));
          break;
        }
        case 'projectComplete': {
          const b = islandBounds(this.level);
          for (let i = 0; i < 4; i++) {
            const p = new THREE.Vector3(THREE.MathUtils.lerp(b.minX, b.maxX, Math.random()), 3, THREE.MathUtils.lerp(b.minZ, b.maxZ, Math.random()));
            setTimeout(() => this.effects.confettiBurst(p, 70), i * 250);
          }
          this.overviewMode = true;
          this.frameOverview(state);
          break;
        }
        case 'add':
          this.train.pop(e.index + 1);
          break;
        case 'merge':
          this.train.pop(1);
          this.effects.sparkle(this.train.wagonPosition(1, new THREE.Vector3()), 16);
          break;
        case 'speed':
        case 'capacity':
          this.effects.sparkle(this.train.locoPosition(new THREE.Vector3()).setY(1), 14, ['#7cf0b8', '#ffffff', '#ffd34a']);
          break;
        case 'railGrow': {
          const to = railOf(state);
          this.track.startMorph(this.rail.track, to.track, railMapping(to, this.rail), RAIL_MORPH);
          this.rail = to;
          this.city.setRail(to);
          this.forest.setRail(to);
          break;
        }
        case 'harvest': {
          // Blok terkurung dibongkar pekerja kota: debu + bahan terbang ke gudang stasiun.
          const pos = this.forest.cellPos(e.cell, new THREE.Vector3());
          this.effects.puff(pos, { count: 5, size: 0.28, spread: 1.4, up: 1.4, color: '#d9d4c8' });
          this.effects.fly(this.itemKind, pos, this.depot(new THREE.Vector3()), { dur: 0.6, height: 2 });
          break;
        }
        case 'plotOpen': {
          const pv = this.plots[e.plot];
          pv.setVisible(true, true);
          const p = this.plotsDef[e.plot];
          this.effects.sparkle(new THREE.Vector3(p.pos.x, 0.8, p.pos.z), 12, ['#fff6c2', '#ffffff', '#9be8ff']);
          this.effects.puff(new THREE.Vector3(p.pos.x, 0.2, p.pos.z), { count: 6, size: 0.28, spread: 1.3 });
          if (!this.openDistricts.has(p.district)) {
            this.openDistricts.add(p.district);
            this.floatText(`${this.level.districts[p.district].name} terbuka!`, new THREE.Vector3(p.pos.x, 2.4, p.pos.z), 'float-stage');
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private float(key: string, amount: number, cls: string, pos: THREE.Vector3): void {
    const same = this.floats.find((f) => f.key === key && f.t < 0.3);
    if (same) {
      same.amount += amount;
      same.label.set(`+${fmt(same.amount)}`);
      return;
    }
    if (this.floats.length >= MAX_FLOATS) return;
    const label = this.labels.create(cls, `+${fmt(amount)}`);
    label.pos.copy(pos);
    this.floats.push({ label, t: 0, key, amount });
  }

  private floatText(text: string, pos: THREE.Vector3, cls: string): void {
    const label = this.labels.create(cls, text);
    label.pos.copy(pos);
    this.floats.push({ label, t: -0.8, key: text, amount: 0 });
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  private syncTrain(state: GameState, dt: number, speed: number, boost: number, targets: readonly number[] = []): void {
    this.train.setCutters(state.train.cutters);
    const fill = cargoTotal(state.train.cargo) / Math.max(1, capacity(state));
    const aims = state.train.cutters.map((_, k) => {
      const c = targets[k] ?? -1;
      if (c < 0 || state.blocks[c] <= 0) return null;
      return this.forest.cellPos(c, this.aimPool[k] ??= new THREE.Vector3());
    });
    this.train.update(
      dt,
      state.train.distance,
      BALANCE.wagonSpacing,
      (d, out) => this.track.pointAt(d, out),
      (d, out) => this.track.tangentAt(d, out),
      speed,
      fill,
      aims,
      boost,
    );
  }

  /** Serpihan kecil terus-menerus di titik sentuh gerinda selama memotong. */
  private cutSparks(state: GameState, rt: Runtime, dt: number): void {
    this.sparkTimer -= dt;
    if (this.sparkTimer > 0) return;
    this.sparkTimer = 0.09;
    const f = fieldFor(state.levelIndex);
    rt.targets.forEach((c, k) => {
      if (c < 0 || !this.train.contactPoint(k, _v)) return;
      const kind = KINDS[f.kind[c]];
      this.effects.puff(_v, { count: 1, size: 0.12, spread: 0.9, up: 1.4, life: 0.35, color: kind === 'rock' || kind === 'crystal' ? '#fff2b0' : '#c98b4f' });
    });
  }

  update(dt: number, state: GameState, rt: Runtime): void {
    this.track.update(dt);
    const moving = !state.completed && rt.drive.v > 0.05;
    const speed = moving ? trainSpeed(state) * rt.drive.v * 0.3 : 0;
    this.syncTrain(state, dt, speed, 1 + rt.drive.v * 0.3, rt.targets);
    if (moving) this.cutSparks(state, rt, dt);
    this.forest.update(dt, state);
    this.city.update(dt);

    // Asap lokomotif
    this.smokeTimer -= dt;
    if (moving && this.smokeTimer <= 0) {
      this.smokeTimer = 0.18;
      this.effects.puff(this.train.chimney(_v), { count: 1, size: 0.2, spread: 0.2, up: 1.3, life: 0.9, color: '#f4f4f4' });
    }

    // Label muatan di atas kereta (seperti angka muatan di game kereta tambang)
    const total = cargoTotal(state.train.cargo);
    const cap = capacity(state);
    this.train.locoPosition(this.cargoLabel.pos).setY(0.7);
    this.cargoLabel.away ??= new THREE.Vector3();
    this.train.wagonPosition(0, this.cargoLabel.away).setY(0.7);
    this.cargoLabel.awayPx = 62;
    this.cargoLabel.visible = !state.completed;
    this.cargoLabel.set(`<i class="res-${this.itemKind}"></i>${total}${total >= cap ? '<b>PENUH</b>' : ''}`);
    this.cargoLabel.setClass('full', total >= cap);
    // Lencana tingkat tiap pemotong (gerbong 0 = gerbong muatan)
    const cutters = state.train.cutters;
    while (this.wagonLabels.length < cutters.length) this.wagonLabels.push(this.labels.create('wagon-label'));
    while (this.wagonLabels.length > cutters.length) this.labels.remove(this.wagonLabels.pop()!);
    cutters.forEach((lv, i) => {
      const l = this.wagonLabels[i];
      this.train.wagonPosition(i + 1, l.pos).setY(1.05);
      l.set(String(lv));
      for (let k = 1; k <= 8; k++) l.setClass(`lv${k}`, k === lv);
    });

    // Stasiun ikut maju bersama rel; bergoyang saat menerima muatan
    this.placeStation();
    this.stationBounce = Math.max(0, this.stationBounce - dt * 3);
    const sb = Math.sin(this.stationBounce * Math.PI) * 0.08;
    this.station.scale.set(1 + sb * 0.5, 1 - sb + sb * 1.4, 1 + sb * 0.5);

    // Kavling
    this.plots.forEach((pv, i) => {
      const open = isPlotUnlocked(state, i);
      pv.setVisible(open, true);
      pv.update(dt);
      const lbl = this.plotLabels[i];
      lbl.visible = open && !state.completed && !isPlotComplete(state, i) && state.plots[i] > 0;
      if (lbl.visible) {
        pv.topWorld(lbl.pos);
        const target = plotTarget(state, i);
        lbl.set(`${state.plots[i]}/${target}<i style="width:${Math.round((state.plots[i] / target) * 100)}%"></i>`);
        lbl.setClass('clearing', false);
      }
    });

    for (const f of this.floats) {
      f.t += dt;
      if (f.t > 1.1) this.labels.remove(f.label);
    }
    this.floats = this.floats.filter((f) => f.t <= 1.1);

    // Kamera: ikuti kereta kecuali pemain sedang melihat-lihat / mode peta.
    this.manualIdle += dt;
    if (!this.overviewMode && this.manualIdle > 3.5) {
      this.train.locoPosition(_v);
      this.rig.follow(_v.x, _v.z, this.followDist);
    }

    this.effects.update(dt);
    this.rig.update(dt);
    if (this.scene.fog instanceof THREE.Fog) {
      const d = this.rig.currentDist;
      this.scene.fog.near = d * 1.3;
      this.scene.fog.far = d * 3.2;
    }
    this.labels.update(this.rig.camera, this.width, this.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
