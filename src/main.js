import {
  loadScene, tracePhotonPath, rooms, setActiveRoomByPos, getActiveRoomId, setUseBVH,
  resetIntersectCounters, getIntersectCounters,
  addAnimatedSphere, addAnimatedLight, tickAnimation,
  startPathTracer, stopPathTracer, setPathTracerCamera,
} from './raytrace.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const modeLabel = document.getElementById('mode-label');
let W = 0, H = 0, aspect = 1;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
  aspect = W / H;
  imageData = null; // força recriar buffer
}
let imageData = null, u32 = null, zbuf = null;
function ensureBuffers() {
  if (!imageData || imageData.width !== W || imageData.height !== H) {
    imageData = ctx.createImageData(W, H);
    u32 = new Uint32Array(imageData.data.buffer);
    zbuf = new Float32Array(W * H);
  }
}
resize();
window.addEventListener('resize', resize);

// ---------- vetor / matriz utils ----------
const matMul = (A, B) => {
  const R = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
    let s = 0;
    for (let k=0;k<4;k++) s += A[i][k]*B[k][j];
    R[i][j] = s;
  }
  return R;
};
const matVec = (M, v) => {
  const r = [0,0,0,0];
  for (let i=0;i<4;i++) r[i] = M[i][0]*v[0] + M[i][1]*v[1] + M[i][2]*v[2] + M[i][3]*v[3];
  return r;
};
const rotY = a => [
  [ Math.cos(a), 0, Math.sin(a), 0],
  [ 0,           1, 0,           0],
  [-Math.sin(a), 0, Math.cos(a), 0],
  [ 0,           0, 0,           1],
];
const rotX = a => [
  [1, 0,           0,            0],
  [0, Math.cos(a), -Math.sin(a), 0],
  [0, Math.sin(a),  Math.cos(a), 0],
  [0, 0,           0,            1],
];
const translate = (x, y, z) => [
  [1,0,0,x],
  [0,1,0,y],
  [0,0,1,z],
  [0,0,0,1],
];

// ---------- geometria ----------
function boxGeom(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return {
    verts: [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ],
    edges: [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7],
    ],
    tris: [
      [0,3,2],[0,2,1],
      [4,5,6],[4,6,7],
      [0,1,5],[0,5,4],
      [3,7,6],[3,6,2],
      [0,4,7],[0,7,3],
      [1,2,6],[1,6,5],
    ],
  };
}

// plano com 4 cantos (pra tris) + grade de linhas internas (pra wireframe)
function planeGrid(origin, uVec, vVec, divs = 6) {
  const verts = [];
  const edges = [];
  const tris = [];
  const corner = (u, v) => {
    verts.push([
      origin[0] + u*uVec[0] + v*vVec[0],
      origin[1] + u*uVec[1] + v*vVec[1],
      origin[2] + u*uVec[2] + v*vVec[2],
    ]);
    return verts.length - 1;
  };
  const c00 = corner(0, 0);
  const c10 = corner(1, 0);
  const c11 = corner(1, 1);
  const c01 = corner(0, 1);
  tris.push([c00, c10, c11]);
  tris.push([c00, c11, c01]);
  // perímetro
  edges.push([c00, c10], [c10, c11], [c11, c01], [c01, c00]);
  // grade interna
  for (let i = 1; i < divs; i++) {
    const t = i / divs;
    edges.push([corner(0, t), corner(1, t)]);
    edges.push([corner(t, 0), corner(t, 1)]);
  }
  return { verts, edges, tris };
}

// nada aqui — a cena é montada abaixo a partir de rooms[]

// esfera tesselada por lat/lon. tris cobrem a superfície; edges desenham
// alguns paralelos e meridianos pra dar a "globo" no wireframe.
function sphereGeom(center, radius, latSegs = 12, lonSegs = 16) {
  const verts = [];
  const tris = [];
  const edges = [];
  for (let i = 0; i <= latSegs; i++) {
    const lat = -Math.PI / 2 + (i * Math.PI) / latSegs;
    const cy = Math.sin(lat);
    const cr = Math.cos(lat);
    for (let j = 0; j < lonSegs; j++) {
      const lon = (j * 2 * Math.PI) / lonSegs;
      verts.push([
        center[0] + radius * cr * Math.cos(lon),
        center[1] + radius * cy,
        center[2] + radius * cr * Math.sin(lon),
      ]);
    }
  }
  for (let i = 0; i < latSegs; i++) {
    for (let j = 0; j < lonSegs; j++) {
      const j2 = (j + 1) % lonSegs;
      const a = i * lonSegs + j;
      const b = i * lonSegs + j2;
      const c = (i + 1) * lonSegs + j;
      const d = (i + 1) * lonSegs + j2;
      tris.push([a, b, d]);
      tris.push([a, d, c]);
    }
  }
  // wireframe: 1 paralelo a cada 3 anéis, 1 meridiano a cada 2 colunas
  for (let i = 3; i < latSegs; i += 3) {
    for (let j = 0; j < lonSegs; j++) {
      edges.push([i * lonSegs + j, i * lonSegs + ((j + 1) % lonSegs)]);
    }
  }
  for (let j = 0; j < lonSegs; j += 2) {
    for (let i = 0; i < latSegs; i++) {
      edges.push([i * lonSegs + j, (i + 1) * lonSegs + j]);
    }
  }
  return { verts, edges, tris };
}

// converte um quad (4 cantos) num scene entry (verts/edges/tris/rgb)
function quadEntry(q) {
  return {
    verts: [q.p0, q.p1, q.p2, q.p3],
    edges: [[0,1],[1,2],[2,3],[3,0]],
    tris:  [[0,1,2],[0,2,3]],
    rgb:   q.rgb,
  };
}

// monta a cena raster a partir de todos os cômodos. Cada entry é taggeada
// com roomId (filtragem) e kind + dados raw (silhouette mode usa).
// scene é populada por buildVisualScene() depois do loadScene.
const scene = [];
function buildVisualScene() {
  scene.length = 0;
  for (const room of rooms) {
    const rid = room.id;
    for (const q of room.visual.quads) {
      scene.push({ ...quadEntry(q), roomId: rid, kind: 'quad' });
    }
    for (const b of room.visual.boxes) {
      scene.push({
        ...boxGeom(b.min, b.max), rgb: b.rgb, roomId: rid,
        kind: 'box', boxMin: b.min, boxMax: b.max,
      });
    }
    for (const s of room.visual.spheres) {
      scene.push({
        ...sphereGeom(s.c, s.r, 12, 16), rgb: s.rgb, roomId: rid,
        kind: 'sphere', sphCenter: s.c, sphRadius: s.r,
      });
    }
    for (const l of room.visual.lights) {
      if (l.kind === 'quad') {
        scene.push({
          ...quadEntry(l), rgb: l.rgb, emissive: true, roomId: rid, kind: 'quad',
        });
      } else {
        scene.push({
          ...sphereGeom(l.c, l.r, 10, 14), rgb: l.rgb, emissive: true, roomId: rid,
          kind: 'sphere', sphCenter: l.c, sphRadius: l.r,
        });
      }
    }
  }
}

// luz fixa em view space (sente como uma luz no canto superior frontal)
const LIGHT = (() => {
  const v = [0.4, 0.7, 0.6];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0]/l, v[1]/l, v[2]/l];
})();

// ---------- projeção perspectiva ----------
const fov = Math.PI / 3;
const f = 1 / Math.tan(fov / 2);

function project(v) {
  const w = -v[2];
  if (w <= 0) return null;
  const ndcX = (f / aspect) * v[0] / w;
  const ndcY = f * v[1] / w;
  return [
    (ndcX * 0.5 + 0.5) * W,
    (1 - (ndcY * 0.5 + 0.5)) * H,
    v[2], // depth (z em camera space, negativo)
  ];
}

// ---------- rasterização (triângulo preenchido + z-buffer) ----------
function rasterTri(p0, p1, p2, r, g, b) {
  if (!p0 || !p1 || !p2) return;
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(W-1, Math.ceil (Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const maxY = Math.min(H-1, Math.ceil (Math.max(p0[1], p1[1], p2[1])));
  if (minX > maxX || minY > maxY) return;

  // edge function: e(a,b,p) = (p.x-a.x)*(b.y-a.y) - (p.y-a.y)*(b.x-a.x)
  // Linear: e = ax*p.x + ay*p.y + c
  const a12 = p2[1] - p1[1], b12 = p1[0] - p2[0], c12 = p1[1]*p2[0] - p1[0]*p2[1];
  const a20 = p0[1] - p2[1], b20 = p2[0] - p0[0], c20 = p2[1]*p0[0] - p2[0]*p0[1];
  const a01 = p1[1] - p0[1], b01 = p0[0] - p1[0], c01 = p0[1]*p1[0] - p0[0]*p1[1];

  // area = e(p1, p2, p0)
  const area = a12 * p0[0] + b12 * p0[1] + c12;
  if (Math.abs(area) < 1e-6) return;
  const invArea = 1 / area;
  const sign = area >= 0 ? 1 : -1;

  const dzdx = (a12 * p0[2] + a20 * p1[2] + a01 * p2[2]) * invArea;
  const pixel = 0xff000000 | (b << 16) | (g << 8) | r;

  for (let y = minY; y <= maxY; y++) {
    const cx = minX + 0.5, cy = y + 0.5;
    let w0 = a12 * cx + b12 * cy + c12;
    let w1 = a20 * cx + b20 * cy + c20;
    let w2 = a01 * cx + b01 * cy + c01;
    let z  = (w0 * p0[2] + w1 * p1[2] + w2 * p2[2]) * invArea;

    let idx = y * W + minX;
    for (let x = minX; x <= maxX; x++) {
      if ((w0 * sign) >= 0 && (w1 * sign) >= 0 && (w2 * sign) >= 0) {
        if (z > zbuf[idx]) {        // z é negativo em view space; maior = mais perto
          zbuf[idx] = z;
          u32[idx] = pixel;
        }
      }
      w0 += a12; w1 += a20; w2 += a01; z += dzdx;
      idx++;
    }
  }
}

// ---------- modos de render ----------
function drawWireframe(view) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1.5;
  for (const obj of scene) {
    const projected = obj.verts.map(p => {
      const v = matVec(view, [p[0], p[1], p[2], 1]);
      return project(v);
    });
    const [r, g, b] = obj.rgb;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    for (const [a, b2] of obj.edges) {
      const pa = projected[a], pb = projected[b2];
      if (!pa || !pb) continue;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
  }
}

// Ring buffer de caminhos de fóton em world space. Cada frame projeta tudo
// e desenha em 4 strokes batched (um por nível de bounce → 4 alphas distintos).
// Caminhos sobrevivem rotação porque ficam em world space — re-projetamos
// a cada frame com a view atual.
const MAX_PATHS = 8000;
const MAX_POINTS = 5;          // 1 ponto na luz + até 4 hits
const photonXYZ       = new Float32Array(MAX_PATHS * MAX_POINTS * 3);
const photonRGB       = new Float32Array(MAX_PATHS * MAX_POINTS * 3); // cor 0-1 por ponto
const photonIntensity = new Float32Array(MAX_PATHS * MAX_POINTS);     // energia carregada
const photonLen       = new Uint8Array(MAX_PATHS);
let photonHead = 0;
let photonCount = 0;

// parâmetros ajustáveis via sliders / toggles
let ltPathsPerFrame = 40;
let ltAlphaBase     = 0.05;
let ltAlphaDecay    = 0.45;
let ltMaxBounces    = 4;
let ltShowWireframe = false;
let ltSplats        = true;
let ltFog           = true;
let ltColorByBounce = false;
let ltLineFirstOnly = false;
let ltGaussian      = false;
let contourPower = 0; // 0..1, controlado dinamicamente
let ltPhysicalDecay = false;
let ltEmissionVar   = 0;     // 0 = todos fótons saem com energia 1; 1 = uniform [0, 2]
const FOG_STRENGTH        = 0.06;
const N_FOG_BUCKETS       = 4;
const N_INTENSITY_BUCKETS = 8;
// fog culling: pontos com w * FOG_STRENGTH > este limite têm fog < exp(-LIM)
// e são puramente invisíveis. Pula projection X/Y + draw. Só ativa com fog on.
const FOG_CULL_LIMIT      = 5;  // exp(-5) ≈ 0.007

function appendPhotonPath(pts, cols, intensities) {
  const slot = photonHead;
  const n = Math.min(pts.length, MAX_POINTS);
  const base = slot * MAX_POINTS * 3;
  const ibase = slot * MAX_POINTS;
  for (let i = 0; i < n; i++) {
    const o = base + i*3;
    photonXYZ[o]   = pts[i][0];   photonRGB[o]   = cols[i][0];
    photonXYZ[o+1] = pts[i][1];   photonRGB[o+1] = cols[i][1];
    photonXYZ[o+2] = pts[i][2];   photonRGB[o+2] = cols[i][2];
    photonIntensity[ibase + i] = intensities[i];
  }
  photonLen[slot] = n;
  photonHead = (photonHead + 1) % MAX_PATHS;
  if (photonCount < MAX_PATHS) photonCount++;
}

// scratch pra projeção (alocado uma vez)
const projX = new Float32Array(MAX_PATHS * MAX_POINTS);
const projY = new Float32Array(MAX_PATHS * MAX_POINTS);
const projFog = new Float32Array(MAX_PATHS * MAX_POINTS);
const projValid = new Uint8Array(MAX_PATHS * MAX_POINTS);

// reusado entre frames: mapa de bucket key → array de coords. Crescer mas
// nunca encolher. Em prática ~80 entries.
const segmentBuckets = new Map();

// ---------- splat layer ----------
// Splats acumulam no splatLayer. Fade SÓ é ativado quando câmera muda
// (timer de 1s). Steady camera = sem fade, splats saturam normalmente.
const splatLayer = document.createElement('canvas');
let splatLayerCtx = null;
let splatLayerW = 0, splatLayerH = 0;
let splatHeadAtLastDraw = 0;
let splatLastEnabled = false;
let splatLastViewKey = null;
let splatFadeTimer = 0; // segundos restantes de fade ativo

function ensureSplatLayer() {
  if (splatLayerW !== W || splatLayerH !== H) {
    splatLayer.width = W;
    splatLayer.height = H;
    splatLayerCtx = splatLayer.getContext('2d');
    splatLayerW = W; splatLayerH = H;
    splatHeadAtLastDraw = 0;
    splatLastViewKey = null;
  }
}

function getSplatViewKey() {
  return `${camPos[0].toFixed(2)}|${camPos[1].toFixed(2)}|${camPos[2].toFixed(2)}|${yaw.toFixed(3)}|${pitch.toFixed(3)}|${W}|${H}`;
}

function drawSplatsToLayer(startSlot, count, useIntensity) {
  splatLayerCtx.globalCompositeOperation = 'lighter';
  const splatBaseAlpha = 0.12;
  for (let i = 0; i < count; i++) {
    const slot = (startSlot + i) % MAX_PATHS;
    const slotBase = slot * MAX_POINTS;
    const len = photonLen[slot];
    for (let pi = 1; pi < len; pi++) {
      const idx = slotBase + pi;
      if (!projValid[idx]) continue;
      const energyMul = useIntensity ? photonIntensity[slotBase + pi - 1] : 1;
      const a = splatBaseAlpha * projFog[idx] * energyMul;
      const cidx = idx * 3;
      const r = (photonRGB[cidx]   * 255) | 0;
      const g = (photonRGB[cidx+1] * 255) | 0;
      const b = (photonRGB[cidx+2] * 255) | 0;
      const px = projX[idx] | 0;
      const py = projY[idx] | 0;
      if (ltGaussian) {
        splatLayerCtx.globalAlpha = a;
        splatLayerCtx.drawImage(gaussianSplatCanvas(r, g, b), px - 4, py - 4);
      } else {
        splatLayerCtx.fillStyle = `rgba(${r},${g},${b},${a})`;
        splatLayerCtx.fillRect(px - 1, py - 1, 3, 3);
      }
    }
  }
  splatLayerCtx.globalAlpha = 1;
  splatLayerCtx.globalCompositeOperation = 'source-over';
}

// silhouette de box: arestas entre face front-facing e back-facing.
// edgeFaces: cada entry [v0, v1, fa, fb] onde v0/v1 são índices de vértice
// (boxGeom convention) e fa/fb são índices de face: 0=-x, 1=+x, 2=-y, 3=+y, 4=-z, 5=+z
const BOX_EDGE_FACES = [
  [0, 1, 2, 4], [1, 5, 2, 1], [5, 4, 2, 5], [4, 0, 2, 0],
  [3, 2, 3, 4], [2, 6, 3, 1], [6, 7, 3, 5], [7, 3, 3, 0],
  [0, 3, 0, 4], [1, 2, 1, 4], [5, 6, 1, 5], [4, 7, 0, 5],
];

function drawBoxContour(view, boxMin, boxMax) {
  const verts = [
    [boxMin[0], boxMin[1], boxMin[2]], [boxMax[0], boxMin[1], boxMin[2]],
    [boxMax[0], boxMax[1], boxMin[2]], [boxMin[0], boxMax[1], boxMin[2]],
    [boxMin[0], boxMin[1], boxMax[2]], [boxMax[0], boxMin[1], boxMax[2]],
    [boxMax[0], boxMax[1], boxMax[2]], [boxMin[0], boxMax[1], boxMax[2]],
  ];
  const projected = verts.map(p => {
    const v = matVec(view, [p[0], p[1], p[2], 1]);
    return project(v);
  });
  const fc = [
    camPos[0] < boxMin[0], camPos[0] > boxMax[0],
    camPos[1] < boxMin[1], camPos[1] > boxMax[1],
    camPos[2] < boxMin[2], camPos[2] > boxMax[2],
  ];
  ctx.beginPath();
  for (const [v0, v1, fa, fb] of BOX_EDGE_FACES) {
    if (fc[fa] === fc[fb]) continue; // ambas visíveis ou ambas ocultas → não silhouette
    const pa = projected[v0], pb = projected[v1];
    if (!pa || !pb) continue;
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
  }
  ctx.stroke();
}

function drawSphereContour(view, center, radius) {
  const v = matVec(view, [center[0], center[1], center[2], 1]);
  const w = -v[2];
  if (w <= radius) return; // câmera dentro/atrás
  const sx = ((f / aspect) * v[0] / w * 0.5 + 0.5) * W;
  const sy = (1 - (f * v[1] / w * 0.5 + 0.5)) * H;
  const screenR = f * radius / w * H * 0.5;
  ctx.beginPath();
  ctx.arc(sx, sy, screenR, 0, 2 * Math.PI);
  ctx.stroke();
}

// cache de splat gaussiano por cor RGB. Calculado preguiçosamente.
const gaussianCache = new Map();
function gaussianSplatCanvas(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let canvas = gaussianCache.get(key);
  if (canvas) return canvas;
  const SIZE = 9;
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const cx = canvas.getContext('2d');
  const img = cx.createImageData(SIZE, SIZE);
  const data = img.data;
  const center = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const d2 = (dx*dx + dy*dy) / (center * center);
      const intensity = Math.exp(-d2 * 3.5);
      const i = (y * SIZE + x) * 4;
      data[i]     = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = (intensity * 255) | 0;
    }
  }
  cx.putImageData(img, 0, 0);
  gaussianCache.set(key, canvas);
  return canvas;
}

function drawLightTrace(view, dt) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // wireframe (incluindo a esfera de luz) só quando ltShowWireframe.
  // Mostra TODOS os cômodos — fog culling esconde os longe naturalmente.
  ctx.lineWidth = 1;
  if (ltShowWireframe) {
    for (const obj of scene) {
      const projected = obj.verts.map(p => {
        const v = matVec(view, [p[0], p[1], p[2], 1]);
        return project(v);
      });
      const [r, g, b] = obj.rgb;
      ctx.strokeStyle = obj.emissive
        ? `rgba(${r},${g},${b},0.85)`
        : `rgba(${r},${g},${b},0.18)`;
      ctx.beginPath();
      for (const [a, b2] of obj.edges) {
        const pa = projected[a], pb = projected[b2];
        if (!pa || !pb) continue;
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.stroke();
    }
  }
  // contornos dinâmicos: fade-in rápido quando câmera mexe (splatFadeTimer > 0),
  // fade-out lento quando para (splats vão acumulando, contorno some)
  const contourTarget = splatFadeTimer > 0 ? 1 : 0;
  const contourRate = contourTarget > contourPower ? 2 : 0.5; // ~1.5s in, ~6s out
  contourPower += (contourTarget - contourPower) * Math.min(1, dt * contourRate);
  if (contourPower > 0.01) {
    ctx.lineWidth = 1.2;
    for (const obj of scene) {
      const [r, g, b] = obj.rgb;
      const a = 0.2 * contourPower;
      ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
      if (obj.kind === 'box') {
        drawBoxContour(view, obj.boxMin, obj.boxMax);
      } else if (obj.kind === 'sphere') {
        drawSphereContour(view, obj.sphCenter, obj.sphRadius);
      } else {
        // quad: já é um retângulo, perímetro = contorno
        const projected = obj.verts.map(p => {
          const v = matVec(view, [p[0], p[1], p[2], 1]);
          return project(v);
        });
        ctx.beginPath();
        for (const [a, b2] of obj.edges) {
          const pa = projected[a], pb = projected[b2];
          if (!pa || !pb) continue;
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
        }
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  }

  // adiciona N caminhos novos no ring buffer
  resetIntersectCounters();
  for (let i = 0; i < ltPathsPerFrame; i++) {
    const p = tracePhotonPath(ltMaxBounces, ltEmissionVar, ltPhysicalDecay);
    if (p.points.length >= 2) appendPhotonPath(p.points, p.colors, p.intensities);
  }
  if (intersectStatsEl) {
    const c = getIntersectCounters();
    intersectStatsEl.textContent = `prim ${c.prim} · aabb ${c.aabb}`;
  }
  const useIntensity = ltPhysicalDecay || ltEmissionVar > 0;
  if (ltBufferEl) ltBufferEl.textContent = `${photonCount} / ${MAX_PATHS}`;

  // projeta tudo do buffer (matVec + perspective divide inline)
  const m00 = view[0][0], m01 = view[0][1], m02 = view[0][2], m03 = view[0][3];
  const m10 = view[1][0], m11 = view[1][1], m12 = view[1][2], m13 = view[1][3];
  const m20 = view[2][0], m21 = view[2][1], m22 = view[2][2], m23 = view[2][3];
  const fxa = f / aspect;
  const halfW = W * 0.5;
  const halfH = H * 0.5;

  for (let pi = 0; pi < photonCount; pi++) {
    const len = photonLen[pi];
    const slotBase = pi * MAX_POINTS;
    let off = slotBase * 3;
    for (let i = 0; i < len; i++) {
      const wx = photonXYZ[off++];
      const wy = photonXYZ[off++];
      const wz = photonXYZ[off++];
      // calcula só cz primeiro pra culling barato
      const cz = m20*wx + m21*wy + m22*wz + m23;
      const w = -cz;
      const idx = slotBase + i;
      if (w <= 0) { projValid[idx] = 0; continue; }
      // fog culling: ponto invisível pelo fog → pula projeção e draw
      if (ltFog && w * FOG_STRENGTH > FOG_CULL_LIMIT) {
        projValid[idx] = 0;
        continue;
      }
      const cx = m00*wx + m01*wy + m02*wz + m03;
      const cy = m10*wx + m11*wy + m12*wz + m13;
      projX[idx] = (fxa * cx / w + 1) * halfW;
      projY[idx] = (1 - f * cy / w) * halfH;
      projFog[idx] = ltFog ? Math.exp(-w * FOG_STRENGTH) : 1;
      projValid[idx] = 1;
    }
  }

  // strokes batched por (cor, bounce, fog, intensity). Quando ltPhysicalDecay
  // é off, intensity bucket fica fixo em 0 — ainda batch-friendly. Quando on,
  // adiciona dim de discretização (8 buckets) → ~160-640 strokes. Rápido.
  for (const [, arr] of segmentBuckets) arr.length = 0;
  const lineMaxB = ltLineFirstOnly ? Math.min(2, ltMaxBounces) : ltMaxBounces;
  for (let pi = 0; pi < photonCount; pi++) {
    const len = photonLen[pi];
    const ibase = pi * MAX_POINTS;
    for (let b = 0; b < lineMaxB; b++) {
      if (b + 1 >= len) continue;
      const i0 = pi * MAX_POINTS + b;
      const i1 = i0 + 1;
      if (!projValid[i0] || !projValid[i1]) continue;
      let r, g, bl;
      if (ltColorByBounce) {
        const cidx = i0 * 3;
        r  = (photonRGB[cidx]   * 255) | 0;
        g  = (photonRGB[cidx+1] * 255) | 0;
        bl = (photonRGB[cidx+2] * 255) | 0;
      } else {
        r = 255; g = 220; bl = 140;
      }
      const fogAvg = (projFog[i0] + projFog[i1]) * 0.5;
      const fb = Math.min(N_FOG_BUCKETS - 1, (fogAvg * N_FOG_BUCKETS) | 0);
      let ib = 0;
      if (useIntensity) {
        // intensidade durante este segmento = energia deixando ponto i0.
        // clamp pra bucket válido (intensity pode ser > 1 com emission var)
        const intensity = photonIntensity[ibase + b];
        const ibIdx = (intensity * 0.5 * N_INTENSITY_BUCKETS) | 0; // mapeia [0,2] → [0,N)
        ib = Math.max(0, Math.min(N_INTENSITY_BUCKETS - 1, ibIdx));
      }
      const key = `${r},${g},${bl},${b},${fb},${ib}`;
      let arr = segmentBuckets.get(key);
      if (!arr) segmentBuckets.set(key, arr = []);
      arr.push(projX[i0], projY[i0], projX[i1], projY[i1]);
    }
  }
  ctx.lineWidth = 1;
  for (const [key, segs] of segmentBuckets) {
    if (segs.length === 0) continue;
    const [r, g, bl, b, fb, ib] = key.split(',');
    const baseAlpha = Math.pow(ltAlphaDecay, +b) * ltAlphaBase;
    const fogMul = (+fb + 0.5) / N_FOG_BUCKETS;
    const intensityMul = useIntensity ? (+ib + 0.5) * 2 / N_INTENSITY_BUCKETS : 1;
    ctx.strokeStyle = `rgba(${r},${g},${bl},${baseAlpha * fogMul * intensityMul})`;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(segs[i], segs[i+1]);
      ctx.lineTo(segs[i+2], segs[i+3]);
    }
    ctx.stroke();
  }

  // splats: layer persistente que acumula até a câmera mover. Em vez de
  // re-desenhar todos os splats no main canvas a cada frame, mantemos eles
  // num canvas off-screen e só adicionamos os novos. Visual: tipo path
  // tracer convergindo — pixels onde fótons batem ficam mais brilhantes
  // ao longo do tempo.
  if (ltSplats) {
    ensureSplatLayer();
    const justEnabled = !splatLastEnabled;
    splatLastEnabled = true;
    if (justEnabled) {
      splatLayerCtx.clearRect(0, 0, W, H);
      splatHeadAtLastDraw = photonHead;
    }
    // detecta mudança de câmera. Se mudou: ativa fade timer pra 1s.
    const vk = getSplatViewKey();
    if (vk !== splatLastViewKey) {
      splatLastViewKey = vk;
      splatFadeTimer = 1; // 1 segundo de fade ativo
    }
    // fade SÓ enquanto timer ativo. Aggressive fade rate pra apagar em ~1s.
    if (splatFadeTimer > 0) {
      splatLayerCtx.globalCompositeOperation = 'destination-out';
      splatLayerCtx.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 4)})`;
      splatLayerCtx.fillRect(0, 0, W, H);
      splatLayerCtx.globalCompositeOperation = 'source-over';
      splatFadeTimer = Math.max(0, splatFadeTimer - dt);
    }
    // adiciona splats das paths novas
    const newCount = (photonHead - splatHeadAtLastDraw + MAX_PATHS) % MAX_PATHS;
    if (newCount > 0) {
      const startSlot = (photonHead - newCount + MAX_PATHS) % MAX_PATHS;
      drawSplatsToLayer(startSlot, newCount, useIntensity);
      splatHeadAtLastDraw = photonHead;
    }
    // composite simples: 1 layer só, sem soma dupla
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(splatLayer, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    splatLastEnabled = false;
  }
}

function drawShaded(view) {
  ensureBuffers();
  u32.fill(0xff111111);    // background um pouco acima do preto
  zbuf.fill(-Infinity);

  for (const obj of scene) {
    if (!obj.tris) continue;
    const viewVerts = obj.verts.map(p => matVec(view, [p[0], p[1], p[2], 1]));
    const projVerts = viewVerts.map(v => project(v));
    const [br, bg, bb] = obj.rgb;

    for (const [i0, i1, i2] of obj.tris) {
      const v0 = viewVerts[i0], v1 = viewVerts[i1], v2 = viewVerts[i2];

      // normal em view space
      const e1x = v1[0]-v0[0], e1y = v1[1]-v0[1], e1z = v1[2]-v0[2];
      const e2x = v2[0]-v0[0], e2y = v2[1]-v0[1], e2z = v2[2]-v0[2];
      const nx = e1y*e2z - e1z*e2y;
      const ny = e1z*e2x - e1x*e2z;
      const nz = e1x*e2y - e1y*e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      let intensity;
      if (obj.emissive) {
        intensity = 1;
      } else {
        const ndotl = Math.abs((nx*LIGHT[0] + ny*LIGHT[1] + nz*LIGHT[2]) / len);
        intensity = 0.2 + 0.8 * ndotl;
      }

      const r = Math.min(255, br * intensity) | 0;
      const g = Math.min(255, bg * intensity) | 0;
      const b = Math.min(255, bb * intensity) | 0;

      rasterTri(projVerts[i0], projVerts[i1], projVerts[i2], r, g, b);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---------- estado / interação ----------
let mode = 'wireframe';      // wireframe | shaded | lighttrace
let prevRasterMode = 'wireframe';
// câmera livre: posição em world space + euler angles
let camPos = [0, 1.7, 6];    // perto da entrada da galeria, olhando pra alcova
let yaw = 0, pitch = 0;
let lastFrameTime = 0;
const keys = Object.create(null);
let dragging = false, lastX = 0, lastY = 0;
// touch state
let joystickX = 0, joystickY = 0;     // -1 a 1, atualizado pelo joystick virtual
let touchUp = false, touchDown = false;
let lookTouchId = null, joystickTouchId = null;
let lookLastX = 0, lookLastY = 0;
const roomLabel = document.getElementById('room-label');

canvas.addEventListener('mousedown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  yaw   -= (e.clientX - lastX) * 0.005;
  pitch -= (e.clientY - lastY) * 0.005;
  const limit = Math.PI / 2 - 0.05;
  pitch = Math.max(-limit, Math.min(limit, pitch));
  lastX = e.clientX; lastY = e.clientY;
});

// teclas de movimento (estado segurado, aplicado em frame() com dt)
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  // bloqueia scroll do espaço
  if (e.code === 'Space') e.preventDefault();
}, { passive: false });
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- touch controls (joystick + drag pra olhar + up/down) ----------
const joystickEl = document.getElementById('joystick');
const joystickThumbEl = document.getElementById('joystick-thumb');
const btnUpEl = document.getElementById('btn-up');
const btnDownEl = document.getElementById('btn-down');

function updateJoystick(touch) {
  const rect = joystickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = touch.clientX - cx;
  let dy = touch.clientY - cy;
  const max = rect.width / 2;
  const dist = Math.hypot(dx, dy);
  if (dist > max) { dx = dx * max / dist; dy = dy * max / dist; }
  joystickX =  dx / max;
  joystickY = -dy / max; // tela tem y pra baixo; queremos pra cima = forward
  joystickThumbEl.style.transform = `translate(${dx}px, ${dy}px)`;
}

if (joystickEl) {
  joystickEl.addEventListener('touchstart', e => {
    if (joystickTouchId !== null) return;
    const t = e.changedTouches[0];
    joystickTouchId = t.identifier;
    updateJoystick(t);
    e.preventDefault();
  }, { passive: false });
}

window.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystickTouchId) {
      updateJoystick(t);
      e.preventDefault();
    } else if (t.identifier === lookTouchId) {
      const dx = t.clientX - lookLastX;
      const dy = t.clientY - lookLastY;
      yaw   -= dx * 0.005;
      pitch -= dy * 0.005;
      const limit = Math.PI / 2 - 0.05;
      pitch = Math.max(-limit, Math.min(limit, pitch));
      lookLastX = t.clientX;
      lookLastY = t.clientY;
      e.preventDefault();
    }
  }
}, { passive: false });

window.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystickTouchId) {
      joystickTouchId = null;
      joystickX = 0; joystickY = 0;
      joystickThumbEl.style.transform = 'translate(0,0)';
    } else if (t.identifier === lookTouchId) {
      lookTouchId = null;
    }
  }
});
window.addEventListener('touchcancel', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystickTouchId) {
      joystickTouchId = null;
      joystickX = 0; joystickY = 0;
      joystickThumbEl.style.transform = 'translate(0,0)';
    } else if (t.identifier === lookTouchId) {
      lookTouchId = null;
    }
  }
});

// drag-pra-olhar: pega touches no canvas que NÃO sejam do joystick/botões
canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystickTouchId) continue;
    if (lookTouchId === null) {
      lookTouchId = t.identifier;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
      e.preventDefault();
      break;
    }
  }
}, { passive: false });

// up / down botões
function bindHoldBtn(el, onDown, onUp) {
  if (!el) return;
  const start = e => { onDown(); el.classList.add('pressed'); e.preventDefault(); };
  const end   = () => { onUp();   el.classList.remove('pressed'); };
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend',   end);
  el.addEventListener('touchcancel', end);
  el.addEventListener('mousedown',  start);
  el.addEventListener('mouseup',    end);
  el.addEventListener('mouseleave', end);
}
bindHoldBtn(btnUpEl,   () => touchUp = true,   () => touchUp = false);
bindHoldBtn(btnDownEl, () => touchDown = true, () => touchDown = false);

function applyMovement(dt) {
  let moved = false;
  const fast = keys.ShiftLeft || keys.ShiftRight;
  const speed = (fast ? 12 : 4) * dt;
  if (speed === 0) return false;
  // forward/right horizontais (ignoram pitch)
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fx = -sy, fz = -cy;  // forward
  const rx = cy,  rz = -sy;  // right
  if (keys.KeyW) { camPos[0] += fx*speed; camPos[2] += fz*speed; moved = true; }
  if (keys.KeyS) { camPos[0] -= fx*speed; camPos[2] -= fz*speed; moved = true; }
  if (keys.KeyD) { camPos[0] += rx*speed; camPos[2] += rz*speed; moved = true; }
  if (keys.KeyA) { camPos[0] -= rx*speed; camPos[2] -= rz*speed; moved = true; }
  if (keys.KeyE || keys.Space) { camPos[1] += speed; moved = true; }
  if (keys.KeyQ) { camPos[1] -= speed; moved = true; }
  // joystick virtual: y = forward/back, x = strafe
  if (joystickX !== 0 || joystickY !== 0) {
    const fAmt = joystickY * speed;
    const rAmt = joystickX * speed;
    camPos[0] += fx*fAmt + rx*rAmt;
    camPos[2] += fz*fAmt + rz*rAmt;
    moved = true;
  }
  if (touchUp)   { camPos[1] += speed; moved = true; }
  if (touchDown) { camPos[1] -= speed; moved = true; }
  return moved;
}
window.addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') {
    if (mode !== 'wireframe' && mode !== 'shaded') return;
    mode = mode === 'wireframe' ? 'shaded' : 'wireframe';
    if (modeLabel) modeLabel.textContent = mode;
  } else if (e.key === 'l' || e.key === 'L') {
    if (mode === 'pathtrace') return;
    if (mode === 'lighttrace') exitLightTrace();
    else enterLightTrace();
  } else if (e.key === 'r' || e.key === 'R') {
    if (mode === 'pathtrace') exitPathTrace();
    else enterPathTrace();
  }
});

// ---------- camera helpers (pra path tracer) ----------
// view = Rx(-pitch) · Ry(-yaw) · T(-camPos)
// Pra extrair basis world: M = Ry(yaw) · Rx(pitch); right=M·x, up=M·y, fwd=M·-z
function buildCamera() {
  const m = matMul(rotY(yaw), rotX(pitch));
  const fwd   = matVec(m, [0, 0, -1, 0]).slice(0, 3);
  const right = matVec(m, [1, 0,  0, 0]).slice(0, 3);
  const up    = matVec(m, [0, 1,  0, 0]).slice(0, 3);
  return { pos: camPos.slice(), fwd, right, up, fov };
}

// ---------- transição lighttrace ----------
const ltPanel = document.getElementById('lt-panel');
const samplesInfo = document.getElementById('samples-info');
const samplesEl   = document.getElementById('samples');
let prevModeBeforePT = 'wireframe';
let inPathTrace = false;
let lastPTCamHash = null;

function syncLightTracePanel() {
  if (!ltPanel) return;
  ltPanel.classList.toggle('open', mode === 'lighttrace');
}

// ---------- transição path tracer ----------
function enterPathTrace() {
  prevModeBeforePT = mode;
  mode = 'pathtrace';
  inPathTrace = true;
  syncLightTracePanel();

  // canvas baixa-resolução pra PT rodar em CPU; CSS upscala pixelated
  const targetW = 480;
  const ar = window.innerWidth / window.innerHeight;
  canvas.width = targetW;
  canvas.height = Math.max(1, Math.round(targetW / ar));
  canvas.style.imageRendering = 'pixelated';
  imageData = null;
  if (modeLabel) modeLabel.textContent = 'path tracer';
  if (samplesInfo) samplesInfo.style.display = '';

  fpsLastTime = 0;
  startPathTracer({
    canvas, ctx,
    sampleEl: samplesEl,
    camera: buildCamera(),
    onTick: tickFPS,
  });
  lastPTCamHash = null;
}

function exitPathTrace() {
  stopPathTracer();
  mode = prevModeBeforePT;
  inPathTrace = false;
  canvas.style.imageRendering = '';
  if (samplesInfo) samplesInfo.style.display = 'none';
  if (modeLabel) modeLabel.textContent = mode;
  syncLightTracePanel();
  fpsLastTime = 0;
  resize();
}

function enterLightTrace() {
  prevRasterMode = (mode === 'wireframe' || mode === 'shaded') ? mode : 'wireframe';
  mode = 'lighttrace';
  if (modeLabel) modeLabel.textContent = mode;
  syncLightTracePanel();
}

function exitLightTrace() {
  mode = prevRasterMode;
  if (modeLabel) modeLabel.textContent = mode;
  syncLightTracePanel();
}

// ---------- bind dos sliders ----------
function bindSlider(id, valId, onChange) {
  const input = document.getElementById(id);
  const valEl = document.getElementById(valId);
  if (!input) return;
  input.addEventListener('input', () => {
    onChange(parseFloat(input.value));
    if (valEl) valEl.textContent = input.value;
  });
}
bindSlider('lt-n',       'lt-n-val',       v => ltPathsPerFrame = v|0);
bindSlider('lt-alpha',   'lt-alpha-val',   v => ltAlphaBase     = v);
bindSlider('lt-decay',   'lt-decay-val',   v => ltAlphaDecay    = v);
bindSlider('lt-bounces', 'lt-bounces-val', v => ltMaxBounces    = v|0);

function bindCheckbox(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => onChange(el.checked));
}
bindCheckbox('lt-splats',      v => ltSplats        = v);
bindCheckbox('lt-fog',         v => ltFog           = v);
bindCheckbox('lt-gaussian',    v => ltGaussian      = v);
bindCheckbox('lt-colorbounce', v => ltColorByBounce = v);
bindCheckbox('lt-linefirst',   v => ltLineFirstOnly = v);
bindCheckbox('lt-physdecay',   v => ltPhysicalDecay = v);
bindCheckbox('lt-bvh',         v => setUseBVH(v));
bindCheckbox('lt-wireframe',   v => ltShowWireframe = v);
bindSlider('lt-emission', 'lt-emission-val', v => ltEmissionVar = v);

const ltResetBtn = document.getElementById('lt-reset');
if (ltResetBtn) ltResetBtn.addEventListener('click', () => {
  photonHead = 0;
  photonCount = 0;
  splatHeadAtLastDraw = 0;
  if (splatLayerCtx) splatLayerCtx.clearRect(0, 0, W, H);
});

const ltBufferEl = document.getElementById('lt-buffer-val');
const intersectStatsEl = document.getElementById('lt-intersect-stats');

// ---------- FPS counter (EMA + throttle de DOM) ----------
const fpsEl = document.getElementById('fps');
let fpsEMA = 60, fpsLastTime = 0, fpsLastDom = 0;
function tickFPS() {
  const now = performance.now();
  if (fpsLastTime > 0) {
    const dt = now - fpsLastTime;
    if (dt > 0) fpsEMA = fpsEMA * 0.9 + (1000 / dt) * 0.1;
  }
  fpsLastTime = now;
  if (fpsEl && now - fpsLastDom > 250) {
    fpsEl.textContent = fpsEMA.toFixed(0);
    fpsLastDom = now;
  }
}

// ---------- loop ----------
// rAF principal continua rodando mesmo em PT pra processar WASD/mouse e
// avisar o PT pra resetar samples quando câmera muda. PT roda seu próprio rAF
// independente pra renderizar com budget; ambos coexistem.
let rafId = 0;
let lastRoomId = null;
function frame() {
  const now = performance.now();
  const dt = lastFrameTime > 0 ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
  lastFrameTime = now;

  applyMovement(dt);
  // animação pausa em PT pra accum convergir; senão cada frame tem cena diferente
  if (!inPathTrace) tickAnimation(now * 0.001);
  const newRoomId = setActiveRoomByPos(camPos);

  if (inPathTrace) {
    const camHash = `${camPos[0].toFixed(3)},${camPos[1].toFixed(3)},${camPos[2].toFixed(3)},${yaw.toFixed(4)},${pitch.toFixed(4)}`;
    if (camHash !== lastPTCamHash) {
      setPathTracerCamera(buildCamera());
      lastPTCamHash = camHash;
    }
    rafId = requestAnimationFrame(frame);
    return;
  }
  if (newRoomId !== lastRoomId) {
    // mudou de cômodo: só atualiza HUD. Buffer persiste — fótons de todas
    // luzes acumulam, fog culling esconde os distantes.
    lastRoomId = newRoomId;
    if (roomLabel) roomLabel.textContent = newRoomId;
  }

  tickFPS();
  const view = matMul(
    matMul(rotX(-pitch), rotY(-yaw)),
    translate(-camPos[0], -camPos[1], -camPos[2])
  );
  if (mode === 'wireframe')       drawWireframe(view);
  else if (mode === 'shaded')     drawShaded(view);
  else if (mode === 'lighttrace') drawLightTrace(view, dt);

  rafId = requestAnimationFrame(frame);
}

async function init() {
  await loadScene(`${import.meta.env.BASE_URL}scenes/gallery/manifest.json`);
  buildVisualScene();
  // objetos animados específicos da galeria — vivem fora do JSON da cena
  // por enquanto (parametricos, não data-only).
  addAnimatedSphere(
    [-2, 0.5, -5], 0.4,
    [0.95, 0.50, 0.18],
    t => [-2, 0.5 + Math.abs(Math.sin(t * 1.6)) * 1.6, -5],
  );
  addAnimatedLight(
    [1.8, 3.0, 0], 0.16,
    [10, 18, 30], [160, 200, 255],
    t => [1.8 * Math.cos(t * 0.6), 3.0, 1.8 * Math.sin(t * 0.6)],
  );
  frame();
}
init();

if (import.meta.hot) {
  import.meta.hot.dispose(() => cancelAnimationFrame(rafId));
}
