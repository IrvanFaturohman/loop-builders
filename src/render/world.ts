import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { completedModuleCount } from '../game/building';
import { capacity, cargoTotal, isPlotComplete, isPlotUnlocked, plotProject, plotTarget, plotsOf, trainSpeed } from '../game/economy';
import type { GameEvent } from '../game/events';
import { islandBounds, type ResolvedPlot } from '../game/layout';
import { railOf, type Rail } from '../game/rail';
import type { GameState, LevelDefinition, Runtime } from '../game/types';
import { fieldFor, KINDS } from '../game/worldgen';
import { fmt } from '../ui/format';
import { CameraRig, type SafeArea } from './cameraRig';
import { CityView } from './cityView';
import { Effects } from './effects';
import { SeaView } from './seaView';
import { TruckFleet } from './truckView';
import { chipColor, ForestView } from './forestView';
import { cbox, mergeFlat } from './geom';
import { itemGeometry, type ItemKind } from './items';
import { LabelLayer, type WorldLabel } from './labels';
import { SHARED, THEMES } from './palette';
import { PlotView } from './plotView';
import { DROP_FLY, RailItemsView } from './railItemsView';
import { RailView } from './railView';
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

/** Lama lompatan stasiun ke posisi rel yang baru. */
const STATION_HOP = 0.4;
const MAX_FLOATS = 16;
/** Leaf/serpihan per jenis blok saat tumbang. */
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Skala balok di tumpukan penyimpanan. */
const _sc = new THREE.Matrix4().makeScale(0.55, 0.55, 0.55);


/**
 * Stasiun (lokal, alas di y=0, pusat di garis tengah rel, -z = ke dalam loop):
 * kanopi di atas rel yang dilewati kereta, dan gudang di sisi dalam dengan corong kuning.
 */
/** Pusat palet penyimpanan (lokal stasiun): di kiri jalan raya, truk memuat di sebelahnya. */
const STORAGE = new THREE.Vector3(-1.1, 0.1, -1.45);
/** Poin bahan per balok yang terlihat di tumpukan penyimpanan & batas tumpukan. */
const PILE_POINTS = 10;
const PILE_COLS = 4;
const PILE_ROWS = 4;
const PILE_LAYERS = 4;

/**
 * Stasiun tanpa atap: peron di sisi dalam rel dan halaman penyimpanan terbuka (palet kayu,
 * pagar rendah, papan nama). Tumpukan bahan di atas palet digambar terpisah sesuai isi gudang.
 */
function stationGeometry(): THREE.BufferGeometry {
  const x = STORAGE.x;
  const z = STORAGE.z;
  const parts: THREE.BufferGeometry[] = [
    // peron di sisi dalam rel
    cbox(2.2, 0.12, 0.5, '#d9d4c8', 0, 0.06, -0.72, 0.03),
    // palet penyimpanan
    cbox(1.4, 0.06, 1.1, '#8a5a36', x, 0.03, z, 0.02),
    ...[-0.42, -0.14, 0.14, 0.42].map((dz) => cbox(1.36, 0.04, 0.2, '#b98246', x, 0.08, z + dz, 0.01)),
    // papan nama gudang
    cbox(0.06, 0.6, 0.06, '#6b4a2b', x - 0.72, 0.3, z + 0.58, 0.01),
    cbox(0.5, 0.2, 0.04, '#2f7d5b', x - 0.52, 0.56, z + 0.58, 0.02),
  ];
  // pagar rendah di tiga sisi (sisi jalan raya terbuka untuk truk)
  for (const [px, pz, w, d] of [
    [x - 0.72, z, 0.04, 1.14],
    [x, z - 0.57, 1.44, 0.04],
    [x, z + 0.57, 1.44, 0.04],
  ]) {
    parts.push(cbox(w, 0.04, d, '#c89660', px, 0.22, pz, 0.005), cbox(w, 0.04, d, '#c89660', px, 0.12, pz, 0.005));
  }
  for (const [px, pz] of [
    [x - 0.72, z - 0.57],
    [x - 0.72, z + 0.57],
    [x + 0.72, z - 0.57],
    [x + 0.72, z + 0.57],
  ])
    parts.push(cbox(0.06, 0.3, 0.06, '#8a5a36', px, 0.15, pz, 0.01));
  return mergeFlat(parts);
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
  private track!: RailView;
  private stationHop: { x: number; z: number; rot: number; t: number } | null = null;
  private pile!: THREE.InstancedMesh;
  private pileShown = -1;
  private forest!: ForestView;
  private train!: TrainView;
  private station!: THREE.Group;
  private stationBounce = 0;
  private plots: PlotView[] = [];
  private plotLabels: WorldLabel[] = [];
  private cargoLabel!: WorldLabel;
  private wagonLabels: WorldLabel[] = [];
  private sea: SeaView | null = null;
  private trucks: TruckFleet | null = null;
  private railItems: RailItemsView | null = null;
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
    // Kabut sewarna langit: laut memudar ke cakrawala.
    this.scene.fog = new THREE.Fog(palette.sky, 40, 110);

    // Rel (alasnya sewarna tanah hutan)
    const soil = this.level.theme === 'meadow' ? '#caa672' : '#c79a62';
    this.rail = railOf(state);
    this.track = new RailView(this.rail, soil);
    this.track.onLand = (x, z) => this.effects.puff(_v.set(x, 0.1, z), { count: 2, size: 0.22, spread: 0.8, up: 0.5, life: 0.4, color: '#d9cfbf' });
    this.levelRoot.add(this.track.group);

    // Hutan
    this.forest = new ForestView(state.levelIndex, soil);
    this.levelRoot.add(this.forest.group);

    // Tanah kota di dalam rel (tumbuh tiap rel melebar) & stasiun di rel
    this.city = new CityView(this.rail);
    this.levelRoot.add(this.city.group);
    this.openDistricts.clear();
    this.plotsDef.forEach((p, i) => isPlotUnlocked(state, i) && this.openDistricts.add(p.district));
    this.station = new THREE.Group();
    const sm = new THREE.Mesh(stationGeometry(), SHARED.vertexStd);
    sm.castShadow = true;
    sm.receiveShadow = true;
    this.station.add(sm);
    this.pile = new THREE.InstancedMesh(itemGeometry(this.itemKind), SHARED.vertexStd, PILE_COLS * PILE_ROWS * PILE_LAYERS);
    this.pile.castShadow = true;
    this.pile.frustumCulled = false;
    this.pile.count = 0;
    this.pileShown = -1;
    this.station.add(this.pile);
    this.stationHop = null;
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

    // Tumpukan bahan di rel (jatuh saat gerbong muatan penuh)
    this.railItems = new RailItemsView();
    this.levelRoot.add(this.railItems.group);

    // Truk pengantar bahan dari stasiun ke bangunan
    this.trucks = new TruckFleet(state.levelIndex, this.itemKind);
    this.levelRoot.add(this.trucks.group);
    this.cargoLabel = this.labels.create('cargo-label');

    // Pulau di tengah laut
    const half = fieldFor(state.levelIndex).half + 0.5;
    this.sea = new SeaView(this.level);
    this.levelRoot.add(this.sea.group);

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

  private completePlot(plot: number, bonus: number): void {
    const pv = this.plots[plot];
    pv.markComplete();
    pv.building.stageBounce(1.4);
    const top = pv.topWorld(new THREE.Vector3());
    this.effects.sparkle(top, 14);
    this.effects.confettiBurst(top, 26);
    this.float(`b${plot}`, bonus, 'float-sell', top.clone().setY(top.y + 0.6));
  }

  /** Stasiun di titik rel jarak 0 (tengah sisi bawah); saat rel maju ia melompat ke posisi barunya. */
  private placeStation(dt = 0): void {
    this.track.pointAt(0, _v);
    this.track.tangentAt(0, _v2);
    const rot = Math.atan2(-_v2.z, _v2.x) - Math.PI;
    const hop = this.stationHop;
    if (!hop) {
      this.station.position.set(_v.x, 0, _v.z);
      this.station.rotation.y = rot;
      return;
    }
    hop.t = Math.min(1, hop.t + dt / STATION_HOP);
    const e = hop.t < 0.5 ? 2 * hop.t * hop.t : 1 - Math.pow(-2 * hop.t + 2, 2) / 2;
    this.station.position.set(hop.x + (_v.x - hop.x) * e, Math.sin(hop.t * Math.PI) * 0.7, hop.z + (_v.z - hop.z) * e);
    this.station.rotation.y = hop.rot + (rot - hop.rot) * e;
    if (hop.t >= 1) this.stationHop = null;
  }

  /** Mulai lompatan stasiun bila titik rel jarak 0 berpindah. */
  private hopStation(): void {
    this.track.pointAt(0, _v);
    const p = this.station.position;
    if (Math.hypot(_v.x - p.x, _v.z - p.z) < 0.01) return;
    this.stationHop = { x: p.x, z: p.z, rot: this.station.rotation.y, t: 0 };
  }

  /** Puncak tumpukan penyimpanan stasiun (tujuan muatan yang dibongkar). */
  private depot(out: THREE.Vector3): THREE.Vector3 {
    this.station.updateMatrixWorld();
    return this.station.localToWorld(out.set(STORAGE.x, STORAGE.y + 0.5, STORAGE.z));
  }

  /** Tumpukan balok di palet penyimpanan sesuai isi gudang (state.stock). */
  private updatePile(stock: number): void {
    const max = PILE_COLS * PILE_ROWS * PILE_LAYERS;
    const n = Math.min(max, Math.ceil(stock / PILE_POINTS));
    if (n === this.pileShown) return;
    this.pileShown = n;
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / (PILE_COLS * PILE_ROWS));
      const k = i % (PILE_COLS * PILE_ROWS);
      const cx = (k % PILE_COLS) - (PILE_COLS - 1) / 2;
      const cz = Math.floor(k / PILE_COLS) - (PILE_ROWS - 1) / 2;
      // Lapisan berselang-seling arah balok, seperti tumpukan kayu sungguhan.
      const across = layer % 2 === 1;
      _m.makeRotationY(across ? Math.PI / 2 : 0);
      _m.setPosition(STORAGE.x + (across ? cz * 0.3 : cx * 0.3), STORAGE.y + 0.07 + layer * 0.11, STORAGE.z + (across ? cx * 0.22 : cz * 0.22));
      this.pile.setMatrixAt(i, _m.multiply(_sc));
    }
    this.pile.count = n;
    this.pile.instanceMatrix.needsUpdate = true;
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
    this.sea?.dispose();
    this.sea = null;
    this.trucks?.dispose();
    this.trucks = null;
    this.railItems?.dispose();
    this.railItems = null;
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
    let pickups = 0;
    let chips = 0;
    for (const e of events) {
      switch (e.type) {
        case 'cut': {
          // Bahan keluar dari blok (sedikit demi sedikit selama digerus) dan terbang ke gerbong muatan.
          const kind = KINDS[fieldFor(state.levelIndex).kind[e.cell]];
          if (e.felled) this.hooks.onCut(kind);
          if (chips++ > 10) break; // batas keras partikel per frame
          const pos = this.forest.cellPos(e.cell, new THREE.Vector3());
          this.effects.puff(pos, { count: e.felled ? 3 : 1, size: e.felled ? 0.2 : 0.14, spread: 1.4, up: 1.2, color: chipColor(kind, 0), life: 0.5 });
          const item: ItemKind = e.res === 'wood' ? 'wood' : e.res === 'stone' ? 'stone' : 'gem';
          this.effects.fly(item, pos, this.train.wagonPosition(0, new THREE.Vector3()), { dur: 0.32, height: 0.9, scale: e.felled ? 0.8 : 0.6, getTo: () => this.train.wagonPosition(0, _v2), onLand: () => this.train.bumpWagon(0) });
          break;
        }
        case 'drop': {
          // Gerbong penuh: balok kecil terbang dari pohon lalu jatuh menumpuk di rel.
          const kind = KINDS[fieldFor(state.levelIndex).kind[e.cell]];
          if (e.felled) this.hooks.onCut(kind);
          if (chips++ > 10) break;
          const pos = this.forest.cellPos(e.cell, new THREE.Vector3());
          this.effects.puff(pos, { count: e.felled ? 3 : 1, size: e.felled ? 0.2 : 0.14, spread: 1.4, up: 1.2, color: chipColor(kind, 0), life: 0.5 });
          const to = this.railItems!.landing(e.item, this.track, new THREE.Vector3());
          this.effects.fly(e.item.res, pos, to, { dur: DROP_FLY, height: 0.8, scale: 0.6, onLand: () => this.effects.puff(to, { count: 2, size: 0.14, spread: 0.6, up: 0.4, life: 0.3, color: '#d9cfbf' }) });
          this.railItems!.dropped(e.item);
          break;
        }
        case 'pickup': {
          if (pickups++ > 8) break;
          const from = this.railItems!.landing(e.item, this.track, new THREE.Vector3());
          this.effects.fly(e.item.res, from, this.train.wagonPosition(0, new THREE.Vector3()), { dur: 0.28, height: 0.6, scale: 0.6, getTo: () => this.train.wagonPosition(0, _v2), onLand: () => this.train.bumpWagon(0) });
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
          // Truk tiba di depan kavling: bahan terbang dari baknya ke modul yang tumbuh, koin muncul.
          const pv = this.plots[e.plot];
          const targets = pv.building.scheduleModules(e.fromModule, e.toModule, 0.26);
          const f = this.plotsDef[e.plot].front;
          const from = new THREE.Vector3(f.x, 0.35, f.z);
          const n = Math.min(e.amount, 6);
          for (let i = 0; i < n && targets.length; i++) {
            const target = targets[i % targets.length].clone();
            this.effects.fly(this.itemKind, from, target, {
              delay: i * 0.05,
              dur: 0.4,
              height: 1.2,
              onLand: i === 0 ? () => this.effects.puff(target, { count: 3, size: 0.2, spread: 1.2 }) : undefined,
            });
          }
          this.float(`d${e.plot}`, e.money, 'float-rent', pv.topWorld(new THREE.Vector3()));
          break;
        }
        case 'plotComplete':
          this.completePlot(e.plot, e.bonus);
          break;
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
          this.track.setRail(to);
          this.hopStation();
          this.rail = to;
          this.city.setRail(to);
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
    // Pucuk/tajuk/pecahan batu yang terlepas saat blok turun satu tahap.
    const drops = this.forest.update(dt, state);
    for (let i = 0; i < drops.length && i < 6; i++) {
      const d = drops[i];
      this.forest.cellPos(d.cell, _v).setY(d.y);
      this.effects.puff(_v, { count: 5, size: 0.17, spread: 1.6, up: 1.7, life: 0.55, color: chipColor(d.kind, d.stage) });
    }
    this.city.update(dt);
    this.sea?.update(dt);
    this.trucks?.update(dt, state.trucks);
    this.railItems?.update(dt, state.railItems, this.track);

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

    // Stasiun ikut maju bersama rel; bergoyang saat menerima muatan; tumpukan gudang ikut isinya
    this.placeStation(dt);
    this.updatePile(state.stock);
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
