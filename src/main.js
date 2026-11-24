import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import './style.css';
import {
  DIR_VECTORS,
  LangtonAnt,
  RULE_PRESETS,
  normalizeRule,
  randomRule,
} from './langton.js';

const GRID_SIZE = 451;
const VIEW_SIZE = 500;
const TILE_SIZE = 0.87;
const BASE = import.meta.env.BASE_URL;
const NEON = [
  '#7cf7d4',
  '#ffb86b',
  '#f472b6',
  '#a78bfa',
  '#60a5fa',
  '#facc15',
  '#fb7185',
  '#34d399',
];
const DIM_STATE = '#3c2a58';

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = new Intl.NumberFormat('en-US');

const el = {
  canvas: $('#scene'),
  panel: $('#panel'),
  panelToggle: $('#panel-toggle'),
  panelClose: $('#panel-close'),
  statsSteps: $('#stat-steps'),
  statsVisited: $('#stat-visited'),
  statsLoops: $('#stat-loops'),
  presets: $('#presets'),
  ruleForm: $('#rule-form'),
  ruleInput: $('#rule-input'),
  randomRule: $('#random-rule'),
  ruleLegend: $('#rule-legend'),
  play: $('#play'),
  playLabel: $('#play span'),
  step: $('#step'),
  reset: $('#reset'),
  simState: $('#sim-state'),
  speed: $('#speed'),
  speedValue: $('#speed-value'),
  loopLab: $('.loop-lab'),
  loopPill: $('#loop-pill'),
  loopTitle: $('#loop-title'),
  loopCopy: $('#loop-copy'),
  cyclePeriod: $('#cycle-period'),
  cycleDrift: $('#cycle-drift'),
  cycleStep: $('#cycle-step'),
  frameLoop: $('#frame-loop'),
  showLoop: $('#show-loop'),
  colorSpectrum: $('#color-spectrum'),
  colorStates: $('#color-states'),
  zoomIn: $('#zoom-in'),
  zoomOut: $('#zoom-out'),
  cameraHome: $('#camera-home'),
  toast: $('#toast'),
  about: $('#about'),
  aboutOpen: $('#about-open'),
  aboutClose: $('#about-close'),
  aboutStart: $('#about-start'),
  boot: $('#boot'),
};

const sim = new LangtonAnt({ size: GRID_SIZE, rule: 'RL' });

const state = {
  playing: false,
  speed: 726,
  colorMode: 'spectrum',
  showLoop: true,
  accumulator: 0,
  cycleSeen: false,
  edgeNotified: false,
  antAngle: 0,
  antSnap: true,
  booted: false,
  startedAt: 0,
  toastTimer: 0,
  lastStatsAt: 0,
  loopPoints: null,
  loopRing: null,
  loopMaterials: [],
  dragging: false,
  follow: true,
  followTimer: 0,
};

/* ————————————————— renderer and camera ————————————————— */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: el.canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch (error) {
  showFatal('This browser could not start WebGL. Try updating your graphics driver or another browser.');
  throw error;
}

renderer.setClearColor(0x04050a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
camera.position.set(0, 0, 500);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.34, 0.52);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

let viewportWidth = 1;
let viewportHeight = 1;
const cameraNow = { x: 0, y: 0, zoom: 1 };
const cameraTarget = { x: 0, y: 0, zoom: 1 };

/* ————————————————— background grid ————————————————— */

const backgroundMaterial = new THREE.ShaderMaterial({
  depthWrite: false,
  depthTest: false,
  vertexShader: /* glsl */ `
    varying vec2 vWorld;

    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xy;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vWorld;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float gridLine(vec2 p) {
      vec2 width = max(fwidth(p), vec2(0.00001));
      vec2 grid = abs(fract(p - 0.5) - 0.5) / width;
      return 1.0 - min(min(grid.x, grid.y), 1.0);
    }

    void main() {
      vec2 p = vWorld;
      float radius = length(p);

      vec3 color = vec3(0.006, 0.0075, 0.014);
      color += vec3(0.012, 0.034, 0.046) * exp(-radius * 0.0085);
      color += vec3(0.032, 0.010, 0.046) * exp(-length(p - vec2(-160.0, 170.0)) * 0.013);

      float footprint = max(fwidth(p.x), fwidth(p.y));
      float minorFade = 1.0 - smoothstep(0.1, 0.34, footprint);
      color += vec3(0.10, 0.15, 0.20) * gridLine(p) * minorFade * 0.45;
      color += vec3(0.10, 0.17, 0.21) * gridLine(p / 10.0) * 0.32;

      float stars = step(0.9975, hash21(floor(p * 0.62)));
      color += vec3(0.42, 0.65, 0.75) * stars * 0.2 * smoothstep(0.15, 0.6, footprint);

      color *= 1.0 - smoothstep(220.0, 1150.0, radius) * 0.62;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

const background = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), backgroundMaterial);
background.position.z = -100;
background.renderOrder = -100;
background.frustumCulled = false;
scene.add(background);

/* ————————————————— path tiles ————————————————— */

function makeTileTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(64, 54, 4, 64, 64, 86);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.97)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.62)');

  const radius = 22;
  const inset = 3;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
  ctx.fillStyle = gradient;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

const tileGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
const tileMaterial = new THREE.MeshBasicMaterial({
  map: makeTileTexture(),
  transparent: true,
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
});

const tileCount = sim.cellCount;
const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, tileCount);
tiles.frustumCulled = false;
tiles.renderOrder = 2;

const dummy = new THREE.Object3D();
for (let y = 0; y < sim.size; y += 1) {
  for (let x = 0; x < sim.size; x += 1) {
    const index = y * sim.size + x;
    dummy.position.set(x - sim.center, y - sim.center, 0);
    dummy.updateMatrix();
    tiles.setMatrixAt(index, dummy.matrix);
  }
}
tiles.instanceMatrix.setUsage(THREE.StaticDrawUsage);
tiles.instanceMatrix.needsUpdate = true;

const tileColors = new Float32Array(tileCount * 3);
const tileColorAttribute = new THREE.InstancedBufferAttribute(tileColors, 3);
tileColorAttribute.setUsage(THREE.DynamicDrawUsage);
tiles.instanceColor = tileColorAttribute;
scene.add(tiles);

const paintColor = new THREE.Color();

function paintTile(index) {
  const cellState = sim.cells[index];
  const hue = sim.hues[index];

  if (state.colorMode === 'states') {
    if (cellState === 0) {
      paintColor.setStyle(DIM_STATE);
      paintColor.multiplyScalar(0.72);
    } else {
      paintColor.setStyle(NEON[(cellState - 1) % NEON.length]);
    }
  } else if (cellState === 0) {
    paintColor.setHSL(hue, 0.82, 0.1, THREE.SRGBColorSpace);
  } else {
    const lightness = 0.52 + Math.min(sim.visits[index] * 0.006, 0.05);
    paintColor.setHSL(
      (hue + cellState * 0.07) % 1,
      0.98,
      lightness,
      THREE.SRGBColorSpace,
    );
  }

  const offset = index * 3;
  tileColors[offset] = paintColor.r;
  tileColors[offset + 1] = paintColor.g;
  tileColors[offset + 2] = paintColor.b;
}

function paintChanged(changed) {
  if (changed.size === 0) return;
  for (const index of changed) {
    paintTile(index);
    tileColorAttribute.addUpdateRange(index * 3, 3);
  }
  tileColorAttribute.needsUpdate = true;
}

function repaintAll() {
  for (let index = 0; index < tileCount; index += 1) {
    if (sim.cells[index] !== 0 || sim.visits[index] !== 0) {
      paintTile(index);
    } else {
      const offset = index * 3;
      tileColors[offset] = 0;
      tileColors[offset + 1] = 0;
      tileColors[offset + 2] = 0;
    }
  }
  tileColorAttribute.clearUpdateRanges();
  tileColorAttribute.needsUpdate = true;
}

function clearTiles() {
  tileColors.fill(0);
  tileColorAttribute.clearUpdateRanges();
  tileColorAttribute.needsUpdate = true;
}

/* ————————————————— ant ————————————————— */

const antGroup = new THREE.Group();
antGroup.position.z = 6;
scene.add(antGroup);

function makeGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 213, 138, 0.7)');
  gradient.addColorStop(0.24, 'rgba(255, 170, 82, 0.32)');
  gradient.addColorStop(0.58, 'rgba(255, 120, 50, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 100, 40, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const glow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
);
glow.scale.set(16, 16, 1);
glow.renderOrder = 19;
antGroup.add(glow);

let ant = null;
const antBaseWidth = 9.4;
const antBaseHeight = 12.3;

function makeFallbackAntTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 340;
  const ctx = canvas.getContext('2d');
  ctx.translate(128, 170);
  ctx.fillStyle = '#ffb347';
  ctx.strokeStyle = '#ffd88a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    const y = -40 + i * 42;
    ctx.beginPath();
    ctx.moveTo(-30, y);
    ctx.quadraticCurveTo(-70, y - 20, -96, y - 55 + i * 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.quadraticCurveTo(70, y - 20, 96, y - 55 + i * 24);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 70, 38, 54, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -66, 30, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function loadAnt() {
  let texture;
  try {
    texture = await new THREE.TextureLoader().loadAsync(`${BASE}ant.svg`);
  } catch {
    texture = makeFallbackAntTexture();
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  ant = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  ant.scale.set(antBaseWidth, antBaseHeight, 1);
  ant.renderOrder = 20;
  antGroup.add(ant);
}

/* ————————————————— loop trace ————————————————— */

const loopGroup = new THREE.Group();
loopGroup.visible = false;
scene.add(loopGroup);

function clearLoopTrace() {
  const geometries = new Set();
  const materials = new Set();
  for (const child of loopGroup.children) {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) materials.add(child.material);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  loopGroup.clear();
  loopGroup.visible = false;
  state.loopPoints = null;
  state.loopRing = null;
  state.loopMaterials = [];
}

function buildLoopTrace(cycle) {
  clearLoopTrace();
  if (!cycle.path || cycle.path.length < 2) return;

  const points = [];
  const flat = [];
  for (const packed of cycle.path) {
    const x = (packed % sim.size) - sim.center;
    const y = Math.floor(packed / sim.size) - sim.center;
    points.push({ x, y });
    flat.push(x, y, 3.2);
  }
  state.loopPoints = points;

  const coreGeometry = new LineGeometry();
  coreGeometry.setPositions(flat);
  const coreMaterial = new LineMaterial({
    color: 0x8fffe6,
    linewidth: 2,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  coreMaterial.resolution.set(viewportWidth, viewportHeight);

  const core = new Line2(coreGeometry, coreMaterial);
  core.renderOrder = 22;
  core.frustumCulled = false;

  const haloGeometry = new LineGeometry();
  haloGeometry.setPositions(flat);
  const haloMaterial = new LineMaterial({
    color: 0x03050a,
    linewidth: 6,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  haloMaterial.resolution.set(viewportWidth, viewportHeight);

  const halo = new Line2(haloGeometry, haloMaterial);
  halo.renderOrder = 21;
  halo.frustumCulled = false;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.55, 40),
    new THREE.MeshBasicMaterial({
      color: 0x8fffe6,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  ring.position.set(points[0].x, points[0].y, 3.25);
  ring.renderOrder = 23;

  const endMarker = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 4),
    new THREE.MeshBasicMaterial({
      color: 0x8fffe6,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const lastPoint = points[points.length - 1];
  endMarker.position.set(lastPoint.x, lastPoint.y, 3.25);
  endMarker.rotation.z = Math.PI / 4;
  endMarker.renderOrder = 23;

  state.loopMaterials = [coreMaterial, haloMaterial];
  state.loopRing = ring;

  loopGroup.add(halo, core, ring, endMarker);
  loopGroup.visible = state.showLoop;
}

/* ————————————————— UI helpers ————————————————— */

function formatSpeed(value) {
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatDrift(dx, dy) {
  const signed = (value) => (value > 0 ? `+${value}` : String(value));
  return `${signed(dx)}, ${signed(dy)}`;
}

function toast(message, warn = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('warn', warn);
  el.toast.classList.add('show');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    el.toast.classList.remove('show');
  }, 3800);
}

function showFatal(message) {
  if (!el.boot) return;
  el.boot.classList.remove('hide');
  el.boot.innerHTML = `
    <div style="max-width: 420px; text-align: center; line-height: 1.8; letter-spacing: .08em;">
      ${message}
    </div>
  `;
}

function setPlaying(playing) {
  if (playing && sim.edgeReached) {
    toast('The ant is at the edge. Reset to begin again.', true);
    playing = false;
  }
  state.playing = playing;
  el.play.dataset.playing = String(playing);
  el.play.setAttribute('aria-pressed', String(playing));
  el.play.setAttribute('aria-label', playing ? 'Pause simulation' : 'Resume simulation');
  el.playLabel.textContent = playing ? 'Pause' : 'Resume';
  el.simState.textContent = playing ? 'RUNNING' : 'PAUSED';
  el.simState.className = `tag ${playing ? 'live' : 'paused'}`;
  if (playing) state.accumulator = 0;
}

function stateSwatch(index) {
  if (index === 0) return DIM_STATE;
  return NEON[(index - 1) % NEON.length];
}

function renderLegend() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < sim.rule.length; index += 1) {
    const color = stateSwatch(index);
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('i');
    swatch.className = 'legend-swatch';
    swatch.style.background = color;
    swatch.style.color = color;
    item.append(swatch, document.createTextNode(`${index} ${sim.rule[index]}`));
    fragment.append(item);
  }
  el.ruleLegend.replaceChildren(fragment);
}

function syncRuleUI() {
  el.ruleInput.value = sim.rule;
  el.ruleInput.classList.remove('invalid');
  for (const chip of el.presets.querySelectorAll('.chip')) {
    chip.classList.toggle('active', chip.dataset.rule === sim.rule);
  }
  renderLegend();
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  for (const preset of RULE_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.rule = preset.rule;
    button.title = preset.note;
    const name = document.createElement('strong');
    name.textContent = preset.name;
    const meta = document.createElement('small');
    meta.textContent = `${preset.rule} · ${preset.rule.length} states`;
    button.append(name, meta);
    button.addEventListener('click', () => applyRule(preset.rule));
    fragment.append(button);
  }
  el.presets.replaceChildren(fragment);
  syncRuleUI();
}

function updateStats(now, force = false) {
  if (!force && now - state.lastStatsAt < 110) return;
  state.lastStatsAt = now;
  el.statsSteps.textContent = number.format(sim.steps);
  el.statsVisited.textContent = number.format(sim.visited);
  el.statsLoops.textContent = String(state.cycleSeen ? 1 : 0);
}

function resetLoopUI() {
  el.loopLab.classList.remove('is-found');
  el.loopPill.className = 'tag';
  el.loopPill.textContent = 'SCANNING';
  el.loopTitle.textContent = 'Listening for echoes';
  el.loopCopy.textContent = 'Fingerprinting the 21 × 21 patch around the ant.';
  el.cyclePeriod.textContent = '—';
  el.cycleDrift.textContent = '—';
  el.cycleStep.textContent = '—';
  el.frameLoop.disabled = true;
}

function updateLoopStatus() {
  if (state.cycleSeen) return;
  if (sim.edgeReached) {
    el.loopPill.className = 'tag found';
    el.loopPill.textContent = 'EDGE';
    el.loopTitle.textContent = 'The walk hit the edge';
    el.loopCopy.textContent = 'Reset to grow a fresh colony. Zoom out any time to see the whole grid.';
  } else if (sim.detectionStopped) {
    el.loopPill.className = 'tag';
    el.loopPill.textContent = 'NO LOCK';
    el.loopTitle.textContent = 'No loop yet';
    el.loopCopy.textContent = 'This rule has not repeated its local patch. Try another rule.';
  } else {
    el.loopPill.className = 'tag';
    el.loopPill.textContent = 'SCANNING';
    el.loopTitle.textContent = 'Listening for echoes';
    el.loopCopy.textContent = 'Fingerprinting the 21 × 21 patch around the ant.';
  }
}

function showCycle(cycle) {
  if (state.cycleSeen) return;
  state.cycleSeen = true;
  el.statsLoops.textContent = '1';
  el.loopLab.classList.add('is-found');
  el.loopPill.className = 'tag found';
  el.loopPill.textContent = 'LOOP FOUND';
  el.loopTitle.textContent = `${cycle.period}-step ${cycle.driftX === 0 && cycle.driftY === 0 ? 'orbit' : 'glide'}`;
  el.loopCopy.textContent = `The same ${cycle.radius * 2 + 1} × ${cycle.radius * 2 + 1} patch returned at step ${number.format(cycle.foundAt)}.`;
  el.cyclePeriod.textContent = String(cycle.period);
  el.cycleDrift.textContent = formatDrift(cycle.driftX, cycle.driftY);
  el.cycleStep.textContent = number.format(cycle.foundAt);

  buildLoopTrace(cycle);
  el.frameLoop.disabled = !state.loopPoints || state.loopPoints.length < 2;

  toast(`Loop found at step ${number.format(cycle.foundAt)} — ${cycle.period} steps, drift ${formatDrift(cycle.driftX, cycle.driftY)}. Press F to frame it.`);
}

function resetRuntime({ home = true } = {}) {
  state.accumulator = 0;
  state.cycleSeen = false;
  state.edgeNotified = false;
  state.antAngle = 0;
  state.antSnap = true;
  clearLoopTrace();
  clearTiles();
  resetLoopUI();
  el.statsSteps.textContent = '0';
  el.statsVisited.textContent = '0';
  el.statsLoops.textContent = '0';
  antGroup.position.x = 0;
  antGroup.position.y = 0;
  if (ant) ant.material.rotation = 0;
  if (home) homeView();
}

function applyRule(value, { quiet = false } = {}) {
  let rule;
  try {
    rule = normalizeRule(value);
  } catch (error) {
    el.ruleInput.classList.add('invalid');
    toast(error.message, true);
    return;
  }

  const wasPlaying = state.playing;
  sim.setRule(rule);
  resetRuntime();
  syncRuleUI();
  setPlaying(wasPlaying);
  if (!quiet) toast(`Rule ${rule} · ${rule.length} states`);
}

function stepOnce() {
  if (state.playing) setPlaying(false);
  if (sim.edgeReached) {
    toast('The ant is at the edge. Reset to begin again.', true);
    return;
  }
  if (sim.step()) {
    paintChanged(sim.drainChanged());
    if (sim.cycle) showCycle(sim.cycle);
    updateStats(performance.now(), true);
    updateLoopStatus();
  }
  if (sim.edgeReached) {
    setPlaying(false);
    updateLoopStatus();
    toast('The ant reached the edge of the grid. Reset to start a new walk.', true);
  }
}

function resetSimulation() {
  const wasAtEdge = sim.edgeReached;
  sim.reset();
  resetRuntime();
  setPlaying(wasAtEdge ? true : state.playing);
  toast('Colony reset.');
}

/* ————————————————— camera controls ————————————————— */

function applyCamera() {
  camera.position.x = cameraNow.x;
  camera.position.y = cameraNow.y;
  camera.zoom = cameraNow.zoom;
  camera.updateProjectionMatrix();
}

function homeView(animate = true) {
  state.follow = true;
  fitColonyCamera(!animate);
}

function fitColonyCamera(snap = false) {
  if (!sim.steps) {
    cameraTarget.x = 0;
    cameraTarget.y = 0;
    cameraTarget.zoom = 3.2;
    if (snap) {
      cameraNow.x = cameraTarget.x;
      cameraNow.y = cameraTarget.y;
      cameraNow.zoom = cameraTarget.zoom;
      applyCamera();
    }
    return;
  }

  const colonyWidth = sim.maxX - sim.minX + 1;
  const colonyHeight = sim.maxY - sim.minY + 1;
  const padding = Math.max(11, Math.round(Math.max(colonyWidth, colonyHeight) * 0.26));
  const boundsWidth = Math.max(colonyWidth + padding * 2, 88);
  const boundsHeight = Math.max(colonyHeight + padding * 2, 88);
  const aspect = viewportWidth / viewportHeight;
  const worldWidth = VIEW_SIZE * aspect;

  const desktop = window.innerWidth > 860;
  const panelWidth = desktop ? el.panel.getBoundingClientRect().width + 64 : 36;
  const availableWidth = Math.max(viewportWidth - panelWidth, 340);
  const availableHeight = Math.max(viewportHeight - 150, 300);

  const fitWidth = (worldWidth / boundsWidth) * (availableWidth / viewportWidth);
  const fitHeight = (VIEW_SIZE / boundsHeight) * (availableHeight / viewportHeight);
  const zoom = clamp(Math.min(fitWidth, fitHeight), 0.65, 4.2);
  const scale = (viewportHeight * zoom) / VIEW_SIZE;
  const offset = desktop ? panelWidth / 2 : 0;

  cameraTarget.x = (sim.minX + sim.maxX) / 2 - sim.center - offset / scale;
  cameraTarget.y = (sim.minY + sim.maxY) / 2 - sim.center;
  cameraTarget.zoom = zoom;

  if (snap) {
    cameraNow.x = cameraTarget.x;
    cameraNow.y = cameraTarget.y;
    cameraNow.zoom = cameraTarget.zoom;
    applyCamera();
  }
}

function screenToWorld(px, py) {
  const scale = (viewportHeight * cameraNow.zoom) / VIEW_SIZE;
  return {
    x: cameraNow.x + (px - viewportWidth / 2) / scale,
    y: cameraNow.y - (py - viewportHeight / 2) / scale,
  };
}

function zoomAtCenter(factor) {
  state.follow = false;
  cameraTarget.zoom = clamp(cameraTarget.zoom * factor, 0.45, 14);
}

function frameLoop() {
  if (!state.loopPoints || state.loopPoints.length === 0) return;
  state.follow = false;

  if (window.innerWidth <= 860) setPanelOpen(false);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of state.loopPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const boundsWidth = Math.max(maxX - minX + 18, 22);
  const boundsHeight = Math.max(maxY - minY + 18, 22);
  const aspect = viewportWidth / viewportHeight;
  const worldWidth = VIEW_SIZE * aspect;

  const desktop = window.innerWidth > 860;
  const panelWidth = desktop ? el.panel.getBoundingClientRect().width + 64 : 36;
  const availableWidth = Math.max(viewportWidth - panelWidth, 320);
  const availableHeight = Math.max(viewportHeight - 150, 280);

  const fitWidth = (worldWidth / boundsWidth) * (availableWidth / viewportWidth);
  const fitHeight = (VIEW_SIZE / boundsHeight) * (availableHeight / viewportHeight);
  const zoom = clamp(Math.min(fitWidth, fitHeight), 0.55, 10);
  const scale = (viewportHeight * zoom) / VIEW_SIZE;
  const offset = desktop ? panelWidth / 2 : 0;

  cameraTarget.x = (minX + maxX) / 2 - offset / scale;
  cameraTarget.y = (minY + maxY) / 2;
  cameraTarget.zoom = zoom;
}

function updateCamera(dt) {
  const ease = 1 - Math.exp(-9 * dt);
  let moved = false;
  const dx = cameraTarget.x - cameraNow.x;
  const dy = cameraTarget.y - cameraNow.y;
  const dz = cameraTarget.zoom - cameraNow.zoom;

  if (Math.abs(dx) > 0.001) {
    cameraNow.x += dx * ease;
    moved = true;
  }
  if (Math.abs(dy) > 0.001) {
    cameraNow.y += dy * ease;
    moved = true;
  }
  if (Math.abs(dz) > 0.0001) {
    cameraNow.zoom += dz * ease;
    moved = true;
  }
  if (moved) applyCamera();
}

/* ————————————————— pointer interaction ————————————————— */

let drag = null;

el.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (window.innerWidth <= 860 && document.body.classList.contains('panel-open')) {
    setPanelOpen(false);
  }
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    cameraX: cameraNow.x,
    cameraY: cameraNow.y,
  };
  state.dragging = true;
  el.canvas.classList.add('is-dragging');
  el.canvas.setPointerCapture(event.pointerId);
});

el.canvas.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const scale = (viewportHeight * cameraNow.zoom) / VIEW_SIZE;
  const x = drag.cameraX - (event.clientX - drag.x) / scale;
  const y = drag.cameraY + (event.clientY - drag.y) / scale;
  if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) {
    state.follow = false;
  }
  cameraNow.x = x;
  cameraNow.y = y;
  cameraTarget.x = x;
  cameraTarget.y = y;
  applyCamera();
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  drag = null;
  state.dragging = false;
  el.canvas.classList.remove('is-dragging');
}

el.canvas.addEventListener('pointerup', endDrag);
el.canvas.addEventListener('pointercancel', endDrag);
el.canvas.addEventListener('lostpointercapture', () => {
  drag = null;
  state.dragging = false;
  el.canvas.classList.remove('is-dragging');
});

el.canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    state.follow = false;
    const rect = el.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const before = screenToWorld(px, py);

    const factor = Math.exp(-event.deltaY * 0.00115);
    const zoom = clamp(cameraNow.zoom * factor, 0.45, 14);
    cameraNow.zoom = zoom;
    cameraTarget.zoom = zoom;
    applyCamera();

    const after = screenToWorld(px, py);
    cameraNow.x += before.x - after.x;
    cameraNow.y += before.y - after.y;
    cameraTarget.x = cameraNow.x;
    cameraTarget.y = cameraNow.y;
    applyCamera();
  },
  { passive: false },
);

el.canvas.addEventListener('dblclick', () => homeView());

/* ————————————————— UI wiring ————————————————— */

function setPanelOpen(open) {
  document.body.classList.toggle('panel-open', open);
  el.panelToggle.setAttribute('aria-expanded', String(open));
}

el.panelToggle.addEventListener('click', () => {
  setPanelOpen(!document.body.classList.contains('panel-open'));
});
el.panelClose.addEventListener('click', () => setPanelOpen(false));

el.play.addEventListener('click', () => setPlaying(!state.playing));
el.step.addEventListener('click', stepOnce);
el.reset.addEventListener('click', resetSimulation);

el.ruleForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyRule(el.ruleInput.value);
});
el.ruleInput.addEventListener('input', () => el.ruleInput.classList.remove('invalid'));
el.randomRule.addEventListener('click', () => applyRule(randomRule()));

el.speed.addEventListener('input', () => {
  const slider = Number(el.speed.value);
  state.speed = Math.round(20 * 1000 ** (slider / 100));
  el.speed.style.setProperty('--fill', `${slider}%`);
  el.speedValue.textContent = `${formatSpeed(state.speed)} /s`;
});

el.showLoop.addEventListener('change', () => {
  state.showLoop = el.showLoop.checked;
  loopGroup.visible = state.showLoop && loopGroup.children.length > 0;
});

el.colorSpectrum.addEventListener('click', () => setColorMode('spectrum'));
el.colorStates.addEventListener('click', () => setColorMode('states'));

function setColorMode(mode) {
  if (state.colorMode === mode) return;
  state.colorMode = mode;
  const spectrum = mode === 'spectrum';
  el.colorSpectrum.classList.toggle('active', spectrum);
  el.colorSpectrum.setAttribute('aria-pressed', String(spectrum));
  el.colorStates.classList.toggle('active', !spectrum);
  el.colorStates.setAttribute('aria-pressed', String(!spectrum));
  repaintAll();
}

el.frameLoop.addEventListener('click', frameLoop);
el.zoomIn.addEventListener('click', () => zoomAtCenter(1.35));
el.zoomOut.addEventListener('click', () => zoomAtCenter(1 / 1.35));
el.cameraHome.addEventListener('click', () => homeView());

el.aboutOpen.addEventListener('click', () => {
  if (typeof el.about.showModal === 'function') el.about.showModal();
});
el.aboutClose.addEventListener('click', () => el.about.close());
el.aboutStart.addEventListener('click', () => el.about.close());
el.about.addEventListener('click', (event) => {
  if (event.target === el.about) el.about.close();
});

window.addEventListener('keydown', (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    setPlaying(!state.playing);
  } else if (event.code === 'KeyR') {
    resetSimulation();
  } else if (event.code === 'KeyF') {
    frameLoop();
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    stepOnce();
  }
});

/* ————————————————— sizing ————————————————— */

function resize() {
  viewportWidth = Math.max(window.innerWidth, 1);
  viewportHeight = Math.max(window.innerHeight, 1);
  const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 860 ? 1.6 : 2);

  renderer.setPixelRatio(dpr);
  renderer.setSize(viewportWidth, viewportHeight, false);
  composer.setPixelRatio(dpr);
  composer.setSize(viewportWidth, viewportHeight);

  const aspect = viewportWidth / viewportHeight;
  camera.left = (-VIEW_SIZE * aspect) / 2;
  camera.right = (VIEW_SIZE * aspect) / 2;
  camera.top = VIEW_SIZE / 2;
  camera.bottom = -VIEW_SIZE / 2;
  camera.updateProjectionMatrix();

  for (const material of state.loopMaterials) {
    material.resolution.set(viewportWidth, viewportHeight);
  }
  applyCamera();
  if (state.follow) fitColonyCamera(true);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 120));

/* ————————————————— simulation loop ————————————————— */

function advanceSimulation(dt) {
  if (!state.playing) return;

  state.accumulator += dt * state.speed;
  let budget = Math.floor(state.accumulator);
  state.accumulator -= budget;
  if (budget <= 0) return;

  budget = Math.min(budget, 12_000);
  let moved = 0;

  for (let index = 0; index < budget; index += 1) {
    if (!sim.step()) {
      state.accumulator = 0;
      break;
    }
    moved += 1;
  }

  if (moved > 0) {
    paintChanged(sim.drainChanged());
    if (sim.cycle) showCycle(sim.cycle);
  }

  if (sim.edgeReached && !state.edgeNotified) {
    state.edgeNotified = true;
    setPlaying(false);
    updateLoopStatus();
    toast('The ant reached the edge of the grid. Reset to start a new walk.', true);
  }
}

function updateAnt(dt, now) {
  if (!ant) return;
  const targetX = sim.x - sim.center;
  const targetY = sim.y - sim.center;
  const distance = Math.hypot(targetX - antGroup.position.x, targetY - antGroup.position.y);

  if (state.antSnap || distance > 6) {
    antGroup.position.x = targetX;
    antGroup.position.y = targetY;
    state.antSnap = false;
  } else {
    const ease = 1 - Math.exp(-18 * dt);
    antGroup.position.x += (targetX - antGroup.position.x) * ease;
    antGroup.position.y += (targetY - antGroup.position.y) * ease;
  }

  const [dx, dy] = DIR_VECTORS[sim.dir];
  const targetAngle = Math.atan2(dy, dx) - Math.PI / 2;
  const delta = Math.atan2(
    Math.sin(targetAngle - state.antAngle),
    Math.cos(targetAngle - state.antAngle),
  );
  state.antAngle += delta * (1 - Math.exp(-14 * dt));
  ant.material.rotation = state.antAngle;

  const pulse = 1 + Math.sin(now * 0.0026) * 0.018;
  ant.scale.set(antBaseWidth * pulse, antBaseHeight * pulse, 1);
  glow.position.set(0, 0, -0.2);
  glow.material.opacity = 0.3 + Math.sin(now * 0.0022) * 0.06;
  const glowPulse = 1 + Math.sin(now * 0.0018 + 1.2) * 0.045;
  glow.scale.set(16 * glowPulse, 16 * glowPulse, 1);

  if (state.loopRing) {
    const ringPulse = 1 + Math.sin(now * 0.004) * 0.12;
    state.loopRing.scale.setScalar(ringPulse);
    state.loopRing.material.opacity = 0.62 + Math.sin(now * 0.004) * 0.25;
  }
}

let lastFrame = 0;

function animate(now) {
  requestAnimationFrame(animate);
  if (!lastFrame) lastFrame = now;
  const dt = Math.min((now - lastFrame) / 1000, 0.08);
  lastFrame = now;

  updateCamera(dt);
  advanceSimulation(dt);

  if (state.follow && sim.steps > 0) {
    state.followTimer += dt;
    if (state.followTimer > 0.32) {
      state.followTimer = 0;
      fitColonyCamera();
    }
  }

  updateAnt(dt, now);
  updateStats(now);
  if (!state.cycleSeen) updateLoopStatus();

  composer.render();

  if (!state.booted) {
    state.booted = true;
    window.setTimeout(() => {
      el.boot.classList.add('hide');
      window.setTimeout(() => el.boot.remove(), 900);
    }, 220);
  }
}

/* ————————————————— boot ————————————————— */

async function init() {
  resize();
  renderPresets();

  const slider = 52;
  el.speed.value = String(slider);
  el.speed.style.setProperty('--fill', `${slider}%`);
  state.speed = Math.round(20 * 1000 ** (slider / 100));
  el.speedValue.textContent = `${formatSpeed(state.speed)} /s`;

  const params = new URLSearchParams(window.location.search);
  const requestedRule = params.get('rule');
  if (requestedRule) {
    try {
      sim.setRule(normalizeRule(requestedRule));
    } catch {
      /* keep the default rule when a deep link is malformed */
    }
  }

  const requestedSteps = clamp(
    Number.parseInt(params.get('steps') ?? '0', 10) || 0,
    0,
    120_000,
  );
  if (requestedSteps > 0) {
    for (let index = 0; index < requestedSteps; index += 1) {
      if (!sim.step()) break;
    }
    paintChanged(sim.drainChanged());
    updateStats(0, true);
    if (sim.cycle) showCycle(sim.cycle);
    if (params.get('frame') === '1') {
      frameLoop();
      cameraNow.x = cameraTarget.x;
      cameraNow.y = cameraTarget.y;
      cameraNow.zoom = cameraTarget.zoom;
      applyCamera();
    }
  }

  if (params.get('frame') !== '1') fitColonyCamera(true);
  syncRuleUI();
  if (window.innerWidth <= 860) {
    setPanelOpen(params.get('panel') === '1');
  }

  await loadAnt();
  setPlaying(true);
  requestAnimationFrame(animate);
}

window.antLab = {
  sim,
  state,
  camera: cameraNow,
  cameraTarget,
  applyRule,
  frameLoop,
  fitColonyCamera,
  setPlaying,
  repaintAll,
  resetSimulation,
};

window.addEventListener('error', (event) => {
  if (!state.booted) return;
  toast(`Runtime error: ${event.message}`, true);
});

init().catch((error) => {
  console.error(error);
  showFatal('The colony failed to start. Open the developer console for details.');
});
