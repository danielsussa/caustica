import {
  loadScene, tracePhotonPath, rooms, setActiveRoomByPos, getActiveRoomId, getActiveRoomBounds, setUseBVH,
  resetIntersectCounters, getIntersectCounters,
  tickAnimation, addRuntimeBox, addRuntimeBoxFromVerts, pushRuntimeBoxFromVerts,
  addRuntimeQuadLight, addRuntimeSphereLight, addRuntimeQuad, rebuildRuntimeBVH,
  clearRuntimeBoxes, clearRuntimeLights,
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
// sceneOriginalLength = comprimento após buildVisualScene; usado pra
// truncar entries adicionados pelo editor sem afetar geometria da cena.
const scene = [];
let sceneOriginalLength = 0;
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

// near-plane clip de triângulo em view space. Retorna array de tris (1 ou 2)
// totalmente na frente do near plane, ou [] se inteiramente atrás.
// Sem isso, tris com 1+ vértice atrás da câmera somem (project retorna null
// e rasterTri descarta) → paredes "recortam" quando você encosta nelas.
const NEAR_PLANE = 0.05;
function clipEdgeNear(vIn, vOut) {
  const t = (-NEAR_PLANE - vIn[2]) / (vOut[2] - vIn[2]);
  return [
    vIn[0] + t * (vOut[0] - vIn[0]),
    vIn[1] + t * (vOut[1] - vIn[1]),
    -NEAR_PLANE, 1,
  ];
}
function clipTriNear(v0, v1, v2, out) {
  out.length = 0;
  const i0 = v0[2] < -NEAR_PLANE;
  const i1 = v1[2] < -NEAR_PLANE;
  const i2 = v2[2] < -NEAR_PLANE;
  const cnt = (i0?1:0) + (i1?1:0) + (i2?1:0);
  if (cnt === 0) return out;
  if (cnt === 3) { out.push([v0, v1, v2]); return out; }
  if (cnt === 2) {
    // 2 in, 1 out: emit quad → 2 tris
    let vb, vfa, vfb;
    if (!i0)      { vb = v0; vfa = v1; vfb = v2; }
    else if (!i1) { vb = v1; vfa = v2; vfb = v0; }
    else          { vb = v2; vfa = v0; vfb = v1; }
    const cA = clipEdgeNear(vfa, vb);
    const cB = clipEdgeNear(vfb, vb);
    out.push([vfa, vfb, cB]);
    out.push([vfa, cB, cA]);
  } else {
    // 1 in, 2 out: 1 tri
    let vf, vba, vbb;
    if (i0)      { vf = v0; vba = v1; vbb = v2; }
    else if (i1) { vf = v1; vba = v2; vbb = v0; }
    else         { vf = v2; vba = v0; vbb = v1; }
    const cA = clipEdgeNear(vf, vba);
    const cB = clipEdgeNear(vf, vbb);
    out.push([vf, cA, cB]);
  }
  return out;
}
const _clipBuf = []; // scratch

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
// staggered reveal: idade em frames (do append) e quantos splats já foram
// pintados pra esse slot. revealedSegs = floor(age/framesPerBounce) + 1
const photonAge        = new Uint16Array(MAX_PATHS);
const photonSplatStage = new Uint8Array(MAX_PATHS);
let photonHead = 0;
let photonCount = 0;

// parâmetros ajustáveis via sliders / toggles
let ltPathsPerFrame = 40;
let ltAlphaBase     = 0.08;
let ltAlphaDecay    = 0.6;
let ltMaxBounces    = 4;
let ltShowWireframe = false;
let ltSplats        = true;
let ltFog           = true;
let ltColorByBounce = true;
let ltLineFirstOnly = false;
let ltGaussian      = false;
let ltFramesPerBounce = 1; // 1 = instant, N = cada bounce demora N frames pra aparecer
let contourPower = 0; // 0..1, controlado dinamicamente
let ltPhysicalDecay = true;
let ltEmissionVar   = 0.7;   // 0 = todos fótons saem com energia 1; 1 = uniform [0, 2]
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
  photonAge[slot] = 0;
  photonSplatStage[slot] = 0;
  photonHead = (photonHead + 1) % MAX_PATHS;
  if (photonCount < MAX_PATHS) photonCount++;
}

// scratch pra projeção (alocado uma vez)
const projX = new Float32Array(MAX_PATHS * MAX_POINTS);
const projY = new Float32Array(MAX_PATHS * MAX_POINTS);
const projZ = new Float32Array(MAX_PATHS * MAX_POINTS); // view-space z, pra z-test contra zbuf das paredes
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
let splatLastEnabled = false;
let splatLastViewKey = null;
let splatFadeTimer = 0; // segundos restantes de fade ativo

function ensureSplatLayer() {
  if (splatLayerW !== W || splatLayerH !== H) {
    splatLayer.width = W;
    splatLayer.height = H;
    splatLayerCtx = splatLayer.getContext('2d');
    splatLayerW = W; splatLayerH = H;
    splatLastViewKey = null;
  }
}

function getSplatViewKey() {
  return `${camPos[0].toFixed(2)}|${camPos[1].toFixed(2)}|${camPos[2].toFixed(2)}|${yaw.toFixed(3)}|${pitch.toFixed(3)}|${W}|${H}`;
}

function drawOneSplat(slot, segIdx, useIntensity) {
  const slotBase = slot * MAX_POINTS;
  const idx = slotBase + segIdx;
  if (!projValid[idx]) return;
  const px = projX[idx] | 0;
  const py = projY[idx] | 0;
  // z-test contra zbuf das paredes: skip se splat tá atrás de uma parede mais próxima
  if (px >= 0 && px < W && py >= 0 && py < H) {
    if (projZ[idx] + 0.05 < zbuf[py * W + px]) return;
  }
  const energyMul = useIntensity ? photonIntensity[slotBase + segIdx - 1] : 1;
  const a = 0.12 * projFog[idx] * energyMul;
  const cidx = idx * 3;
  const r = (photonRGB[cidx]   * 255) | 0;
  const g = (photonRGB[cidx+1] * 255) | 0;
  const b = (photonRGB[cidx+2] * 255) | 0;
  if (ltGaussian) {
    splatLayerCtx.globalAlpha = a;
    splatLayerCtx.drawImage(gaussianSplatCanvas(r, g, b), px - 4, py - 4);
  } else {
    splatLayerCtx.fillStyle = `rgba(${r},${g},${b},${a})`;
    splatLayerCtx.fillRect(px - 1, py - 1, 3, 3);
  }
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
  // 1. paredes shaded escuras (z-buffered + near clip)
  ensureBuffers();
  u32.fill(0xff000000);
  zbuf.fill(-Infinity);
  for (const obj of scene) {
    if (!obj.tris) continue;
    const viewVerts = obj.verts.map(p => matVec(view, [p[0], p[1], p[2], 1]));
    const [br, bg, bb] = obj.rgb;
    const intensity = obj.emissive ? 1.0 : 0.10;
    const r = Math.min(255, br * intensity) | 0;
    const g = Math.min(255, bg * intensity) | 0;
    const b = Math.min(255, bb * intensity) | 0;
    for (const [i0, i1, i2] of obj.tris) {
      const v0 = viewVerts[i0], v1 = viewVerts[i1], v2 = viewVerts[i2];
      const tris = clipTriNear(v0, v1, v2, _clipBuf);
      for (const [c0, c1, c2] of tris) {
        rasterTri(project(c0), project(c1), project(c2), r, g, b);
      }
    }
  }
  // NÃO faz putImageData aqui — segments serão rasterizados no mesmo buffer

  // contornos dinâmicos timer (visual depois do putImageData lá embaixo)
  const contourTarget = splatFadeTimer > 0 ? 1 : 0;
  const contourRate = contourTarget > contourPower ? 2 : 0.5;
  contourPower += (contourTarget - contourPower) * Math.min(1, dt * contourRate);

  // envelhece todos os paths existentes em 1 frame (antes do append, pra que
  // novos paths fiquem em age=0 nesse frame). cap em 65535 pra evitar overflow.
  for (let pi = 0; pi < photonCount; pi++) {
    if (photonAge[pi] < 65535) photonAge[pi]++;
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
      projZ[idx] = cz; // view-space z negativo
      projFog[idx] = ltFog ? Math.exp(-w * FOG_STRENGTH) : 1;
      projValid[idx] = 1;
    }
  }

  // rasteriza segments per pixel com z-test + additive blend (no mesmo buffer
  // das paredes). Pedaço de raio atrás de parede some corretamente; pedaço
  // que sai por uma porta pra um corredor visível aparece. Substitui o old
  // segmentBuckets+ctx.stroke (que não tinha z-test).
  const lineMaxB = ltLineFirstOnly ? Math.min(2, ltMaxBounces) : ltMaxBounces;
  for (let pi = 0; pi < photonCount; pi++) {
    const len = photonLen[pi];
    const ibase = pi * MAX_POINTS;
    const revealedB = Math.min(lineMaxB, Math.floor(photonAge[pi] / ltFramesPerBounce) + 1);
    for (let b = 0; b < revealedB; b++) {
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
      let intensityMul = 1;
      if (useIntensity) intensityMul = photonIntensity[ibase + b];
      const alpha = Math.pow(ltAlphaDecay, b) * ltAlphaBase * fogAvg * intensityMul;
      if (alpha < 0.002) continue; // pula segments quase invisíveis (perf)
      rasterLineZBufBlend(
        [projX[i0], projY[i0], projZ[i0]],
        [projX[i1], projY[i1], projZ[i1]],
        r * alpha, g * alpha, bl * alpha,
      );
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // wireframe opcional (overlay ctx, sem z-test)
  ctx.lineWidth = 1;
  if (ltShowWireframe) {
    for (const obj of scene) {
      const projected = obj.verts.map(p => project(matVec(view, [p[0], p[1], p[2], 1])));
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
  // contornos dinâmicos (fade overlay quando câmera mexe)
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
        const projected = obj.verts.map(p => project(matVec(view, [p[0], p[1], p[2], 1])));
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
    }
    // detecta mudança de câmera. Se mudou: ativa fade timer pra 1s.
    const vk = getSplatViewKey();
    if (vk !== splatLastViewKey) {
      splatLastViewKey = vk;
      splatFadeTimer = 1;
    }
    if (splatFadeTimer > 0) {
      splatLayerCtx.globalCompositeOperation = 'destination-out';
      splatLayerCtx.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 4)})`;
      splatLayerCtx.fillRect(0, 0, W, H);
      splatLayerCtx.globalCompositeOperation = 'source-over';
      splatFadeTimer = Math.max(0, splatFadeTimer - dt);
    }
    // splats staggered: pra cada path, pinta os splats que acabaram de ser
    // revelados por revealedB this frame. splatStage = quantos pontos já
    // foram splatados (1..len-1; pula o ponto 0 da luz).
    splatLayerCtx.globalCompositeOperation = 'lighter';
    for (let pi = 0; pi < photonCount; pi++) {
      const len = photonLen[pi];
      const revealedB = Math.floor(photonAge[pi] / ltFramesPerBounce) + 1;
      const maxStage = Math.min(len - 1, revealedB);
      while (photonSplatStage[pi] < maxStage) {
        photonSplatStage[pi]++;
        drawOneSplat(pi, photonSplatStage[pi], useIntensity);
      }
    }
    splatLayerCtx.globalAlpha = 1;
    splatLayerCtx.globalCompositeOperation = 'source-over';
    // composite no main canvas
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
    const [br, bg, bb] = obj.rgb;

    for (const [i0, i1, i2] of obj.tris) {
      const v0 = viewVerts[i0], v1 = viewVerts[i1], v2 = viewVerts[i2];
      const e1x = v1[0]-v0[0], e1y = v1[1]-v0[1], e1z = v1[2]-v0[2];
      const e2x = v2[0]-v0[0], e2y = v2[1]-v0[1], e2z = v2[2]-v0[2];
      const nx = e1y*e2z - e1z*e2y;
      const ny = e1z*e2x - e1x*e2z;
      const nz = e1x*e2y - e1y*e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      let intensity;
      if (obj.emissive) intensity = 1;
      else {
        const ndotl = Math.abs((nx*LIGHT[0] + ny*LIGHT[1] + nz*LIGHT[2]) / len);
        intensity = 0.2 + 0.8 * ndotl;
      }
      const r = Math.min(255, br * intensity) | 0;
      const g = Math.min(255, bg * intensity) | 0;
      const b = Math.min(255, bb * intensity) | 0;
      // clip near plane → 1 ou 2 sub-tris totalmente à frente
      const tris = clipTriNear(v0, v1, v2, _clipBuf);
      for (const [c0, c1, c2] of tris) {
        rasterTri(project(c0), project(c1), project(c2), r, g, b);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---------- solid: paredes opacas + edges + grid, tudo z-buffered ----------
// Renderiza tudo (face fill, edges, grid) no buffer raster com z-test, então
// o que tá atrás da parede é REALMENTE escondido. ctx.lineTo (sem z) seria
// transparente: edges/grid de paredes distantes aparecem por cima da próxima.

// rasteriza linha já clipada/projetada + clipper de view-space → projeta
function rasterLineZBufView(va, vb, pixel) {
  // ambos atrás do near plane → skip
  const i0 = va[2] < -NEAR_PLANE;
  const i1 = vb[2] < -NEAR_PLANE;
  if (!i0 && !i1) return;
  let pa, pb;
  if (i0 && i1) { pa = project(va); pb = project(vb); }
  else if (i0)  { pa = project(va); pb = project(clipEdgeNear(va, vb)); }
  else          { pa = project(clipEdgeNear(vb, va)); pb = project(vb); }
  rasterLineZBuf(pa, pb, pixel);
}

// rasteriza linha com z-test + additive blend per pixel.
// Usado pros raios de fóton em lighttrace — só pixels visíveis (z válido)
// recebem cor; pedaço atrás de parede some corretamente.
function rasterLineZBufBlend(p0, p1, addR, addG, addB) {
  if (!p0 || !p1) return;
  const x0 = p0[0], y0 = p0[1], z0 = p0[2];
  const x1 = p1[0], y1 = p1[1], z1 = p1[2];
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1-x0), Math.abs(y1-y0))));
  const inv = 1 / steps;
  const BIAS = 0.05;
  for (let i = 0; i <= steps; i++) {
    const t = i * inv;
    const x = (x0 + (x1-x0) * t) | 0;
    const y = (y0 + (y1-y0) * t) | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const z = z0 + (z1 - z0) * t;
    const idx = y * W + x;
    if (z + BIAS < zbuf[idx]) continue;
    const cur = u32[idx];
    const cR = cur & 0xff;
    const cG = (cur >> 8) & 0xff;
    const cB = (cur >> 16) & 0xff;
    const nR = Math.min(255, cR + addR) | 0;
    const nG = Math.min(255, cG + addG) | 0;
    const nB = Math.min(255, cB + addB) | 0;
    u32[idx] = 0xff000000 | (nB << 16) | (nG << 8) | nR;
  }
}

function rasterLineZBufBlendView(va, vb, addR, addG, addB) {
  const i0 = va[2] < -NEAR_PLANE;
  const i1 = vb[2] < -NEAR_PLANE;
  if (!i0 && !i1) return;
  let pa, pb;
  if (i0 && i1) { pa = project(va); pb = project(vb); }
  else if (i0)  { pa = project(va); pb = project(clipEdgeNear(va, vb)); }
  else          { pa = project(clipEdgeNear(vb, va)); pb = project(vb); }
  rasterLineZBufBlend(pa, pb, addR, addG, addB);
}

// rasteriza linha 1px com z-test (interp linear de z)
function rasterLineZBuf(p0, p1, pixel) {
  if (!p0 || !p1) return;
  const x0 = p0[0], y0 = p0[1], z0 = p0[2];
  const x1 = p1[0], y1 = p1[1], z1 = p1[2];
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1-x0), Math.abs(y1-y0))));
  const inv = 1 / steps;
  // bias positivo (z negativo em view space; +bias = mais perto)
  const BIAS = 0.01;
  for (let i = 0; i <= steps; i++) {
    const t = i * inv;
    const x = (x0 + (x1-x0) * t) | 0;
    const y = (y0 + (y1-y0) * t) | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const z = z0 + (z1 - z0) * t + BIAS;
    const idx = y * W + x;
    if (z > zbuf[idx]) u32[idx] = pixel;
  }
}

function drawSolid(view) {
  ensureBuffers();
  u32.fill(0xff000000);
  zbuf.fill(-Infinity);

  // 1. faces (shaded fill, z-buffered, com near-plane clipping)
  for (const obj of scene) {
    if (!obj.tris) continue;
    const viewVerts = obj.verts.map(p => matVec(view, [p[0], p[1], p[2], 1]));
    const [br, bg, bb] = obj.rgb;
    for (const [i0, i1, i2] of obj.tris) {
      const v0 = viewVerts[i0], v1 = viewVerts[i1], v2 = viewVerts[i2];
      const e1x = v1[0]-v0[0], e1y = v1[1]-v0[1], e1z = v1[2]-v0[2];
      const e2x = v2[0]-v0[0], e2y = v2[1]-v0[1], e2z = v2[2]-v0[2];
      const nx = e1y*e2z - e1z*e2y;
      const ny = e1z*e2x - e1x*e2z;
      const nz = e1x*e2y - e1y*e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      let intensity;
      if (obj.emissive) intensity = 1;
      else {
        const ndotl = Math.abs((nx*LIGHT[0] + ny*LIGHT[1] + nz*LIGHT[2]) / len);
        intensity = 0.2 + 0.8 * ndotl;
      }
      const r = Math.min(255, br * intensity) | 0;
      const g = Math.min(255, bg * intensity) | 0;
      const b = Math.min(255, bb * intensity) | 0;
      const tris = clipTriNear(v0, v1, v2, _clipBuf);
      for (const [c0, c1, c2] of tris) {
        rasterTri(project(c0), project(c1), project(c2), r, g, b);
      }
    }
  }

  // 2. edges (z-buffered + near clip)
  for (const obj of scene) {
    const viewVerts = obj.verts.map(p => matVec(view, [p[0], p[1], p[2], 1]));
    const [r, g, b] = obj.rgb;
    const er = Math.min(255, r + 60), eg = Math.min(255, g + 60), eb = Math.min(255, b + 60);
    const pixel = 0xff000000 | (eb << 16) | (eg << 8) | er;
    for (const [a, b2] of obj.edges) {
      rasterLineZBufView(viewVerts[a], viewVerts[b2], pixel);
    }
  }

  // 3. cave wall grid (10cm subdiv, z-buffered + near clip)
  if (caveSceneEntries.length > 0) {
    const gridPixel = 0xff8090a0;
    const N = 10;
    for (const e of caveSceneEntries) {
      const [p0, p1, p2, p3] = e.verts;
      const ux = (p1[0]-p0[0])/N, uy = (p1[1]-p0[1])/N, uz = (p1[2]-p0[2])/N;
      const vx = (p3[0]-p0[0])/N, vy = (p3[1]-p0[1])/N, vz = (p3[2]-p0[2])/N;
      for (let i = 1; i < N; i++) {
        const a = matVec(view, [p0[0]+i*ux, p0[1]+i*uy, p0[2]+i*uz, 1]);
        const b = matVec(view, [p3[0]+i*ux, p3[1]+i*uy, p3[2]+i*uz, 1]);
        rasterLineZBufView(a, b, gridPixel);
        const c = matVec(view, [p0[0]+i*vx, p0[1]+i*vy, p0[2]+i*vz, 1]);
        const d = matVec(view, [p1[0]+i*vx, p1[1]+i*vy, p1[2]+i*vz, 1]);
        rasterLineZBufView(c, d, gridPixel);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---------- estado / interação ----------
let mode = 'wireframe';      // wireframe | shaded | lighttrace
let prevRasterMode = 'wireframe';
// câmera livre: posição em world space + euler angles
// Minecraft-like: player preso ao chão com colisão de paredes
const PLAYER_HEIGHT = 1.5;
const PLAYER_RADIUS = 0.3;
let camPos = [0, PLAYER_HEIGHT, 0];
let yaw = 0, pitch = 0;
let lastFrameTime = 0;
const keys = Object.create(null);
let dragging = false, lastX = 0, lastY = 0;
// touch state
let joystickX = 0, joystickY = 0;     // -1 a 1, atualizado pelo joystick virtual
let touchUp = false, touchDown = false;
let lookTouchId = null, joystickTouchId = null, placeTouchId = null;
let lookLastX = 0, lookLastY = 0;
const roomLabel = document.getElementById('room-label');

canvas.addEventListener('mousedown', e => {
  if (placeKind === 'box') {
    if (placePhase === 'idle')        placeStartXZ(e.clientX, e.clientY);
    else if (placePhase === 'height') placeCommit();
    return;
  }
  if (placeKind === 'quad-light')   { placeQuadStart(e.clientX, e.clientY); return; }
  if (placeKind === 'sphere-light') { placeSphereSingleClick(e.clientX, e.clientY); return; }
  if (placeKind === 'break')        { breakBlock(e.clientX, e.clientY); return; }
  // cursor mode
  if (transformMode === 'rotate' && selected) {
    // qualquer drag rotaciona Y (sem precisar acertar o círculo gizmo)
    const hit = pickAny(e.clientX, e.clientY);
    if (hit && hit.kind === selected.kind && hit.idx === selected.idx) {
      startRotateDrag(e.clientX);
      return;
    }
    // clicou em outro item ou vazio → deseleciona/seleciona normalmente
  }
  const axis = pickGizmoAxis(e.clientX, e.clientY);
  if (axis !== null) { startGizmoDrag(axis, e.clientX, e.clientY); return; }
  const hit = pickAny(e.clientX, e.clientY);
  if (hit !== null) { selected = hit; return; }
  selected = null;
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mouseup', e => {
  dragging = false;
  if (isRotating)             { endRotateDrag(); return; }
  if (gizmoDragAxis !== null) { endGizmoDrag(); return; }
  if (placeKind === 'box' && placePhase === 'xz')             placeFinalizeXZ(e.clientY);
  else if (placeKind === 'quad-light' && placePhase === 'xz') placeQuadCommit();
});
window.addEventListener('mousemove', e => {
  if (isRotating)              { updateRotateDrag(e.clientX); return; }
  if (gizmoDragAxis !== null)  { updateGizmoDrag(e.clientX, e.clientY); return; }
  if (placePhase === 'xz')     { placeMoveXZ(e.clientX, e.clientY); return; }
  if (placePhase === 'height') { placeUpdateHeight(e.clientY);      return; }
  if (!dragging) return;
  yaw   -= (e.clientX - lastX) * 0.005;
  pitch -= (e.clientY - lastY) * 0.005;
  const limit = Math.PI / 2 - 0.05;
  pitch = Math.max(-limit, Math.min(limit, pitch));
  lastX = e.clientX; lastY = e.clientY;
});

// ---------- caverna voxel-based (1×1×1m) ----------
// caveVoxels = Set de "i,j,k" representando voxels VAZIOS (espaço onde
// player anda). Tudo fora é sólido (caverna infinita).
// Voxel(i,j,k) ocupa world: [(i-0.5), j, (k-0.5)] .. [(i+0.5), j+1, (k+0.5)]
const caveVoxels = new Set();
const caveSceneEntries = []; // refs no scene[] pra cleanup
const CAVE_ALB = [0.32, 0.28, 0.22];
const CAVE_RGB = [82, 71, 56];
const VOXEL_FACES = [
  // d=offset do vizinho; corners = coord local (0..1)^3 ordered CCW pra normal apontar -d (pro vazio)
  { d: [-1, 0, 0], corners: [[0,0,0], [0,1,0], [0,1,1], [0,0,1]] },  // -x
  { d: [+1, 0, 0], corners: [[1,0,0], [1,0,1], [1,1,1], [1,1,0]] },  // +x
  { d: [0, -1, 0], corners: [[0,0,0], [0,0,1], [1,0,1], [1,0,0]] },  // -y (chão)
  { d: [0, +1, 0], corners: [[0,1,0], [1,1,0], [1,1,1], [0,1,1]] },  // +y (teto)
  { d: [0, 0, -1], corners: [[0,0,0], [1,0,0], [1,1,0], [0,1,0]] },  // -z
  { d: [0, 0, +1], corners: [[0,0,1], [0,1,1], [1,1,1], [1,0,1]] },  // +z
];
function voxelKey(i, j, k) { return `${i},${j},${k}`; }
function isEmptyVoxel(i, j, k) { return caveVoxels.has(voxelKey(i, j, k)); }
function worldToVoxel(p) {
  return [Math.round(p[0]), Math.floor(p[1]), Math.round(p[2])];
}

function initCaveVoxels() {
  caveVoxels.clear();
  for (let i = -1; i <= 1; i++)
    for (let j = 0; j <= 1; j++)
      for (let k = -1; k <= 1; k++)
        caveVoxels.add(voxelKey(i, j, k));
}

// regenera scene[] entries + tris no allTris pras paredes da cave.
// NÃO chama rebuildBVH — caller (rebuildAll) faz uma vez no fim.
function generateCaveGeometry() {
  for (const e of caveSceneEntries) {
    const idx = scene.indexOf(e);
    if (idx !== -1) scene.splice(idx, 1);
  }
  caveSceneEntries.length = 0;
  for (const key of caveVoxels) {
    const [i, j, k] = key.split(',').map(Number);
    const wx = i - 0.5, wy = j, wz = k - 0.5;
    for (const face of VOXEL_FACES) {
      const ni = i + face.d[0], nj = j + face.d[1], nk = k + face.d[2];
      if (isEmptyVoxel(ni, nj, nk)) continue; // vizinho vazio → não emite face
      const corners = face.corners.map(([lx, ly, lz]) => [wx+lx, wy+ly, wz+lz]);
      const entry = {
        verts: corners,
        edges: [[0,1],[1,2],[2,3],[3,0]],
        tris: [[0,1,2],[0,2,3]],
        rgb: CAVE_RGB,
        roomId: 'cave',
        kind: 'quad',
        voxelOrigin: [i, j, k], // pra pickCaveFace + breakBlock identificar vizinho sólido
        faceD: face.d,
      };
      scene.push(entry);
      caveSceneEntries.push(entry);
      addRuntimeQuad(corners[0], corners[1], corners[2], corners[3], CAVE_ALB);
    }
  }
}

// reconstrói TUDO em runtime: cave + placed objects. 1 rebuild de BVH no fim.
function rebuildAll() {
  clearRuntimeBoxes();
  clearRuntimeLights();
  generateCaveGeometry();
  for (const b of placedBoxes) {
    const verts = boxVertsFor(b.center, b.halfExtents, b.rotY);
    pushRuntimeBoxFromVerts(verts, b.albedo);
  }
  for (const q of placedQuadLights) {
    const c = quadCornersFor(q.center, q.hx, q.hz, q.rotY);
    addRuntimeQuadLight(c[0], c[1], c[2], c[3], q.emission);
  }
  for (const s of placedSphereLights) {
    addRuntimeSphereLight(s.center, s.r, s.emission);
  }
  rebuildRuntimeBVH();
}

// ---------- objetos placed (selecionáveis, movíveis, rotacionáveis) ----------
// Box: armazenado como {center, halfExtents, rotY} → 8 corners derivados.
// Quad light: {center, hx, hz, rotY} → 4 corners derivados, normal sempre -y.
// Sphere light: {center, r}, sem rotação (radial).
const placedBoxes        = []; // [{ entry, center, halfExtents, rotY, albedo }]
const placedQuadLights   = []; // [{ entry, center, hx, hz, rotY, emission }]
const placedSphereLights = []; // [{ entry, center, r, emission }]
let selected = null;
let transformMode = 'move';     // 'move' | 'rotate'
let gizmoDragAxis = null;
let gizmoDragInitialT = 0;
let gizmoDragOriginal = null;
let isRotating = false;
let rotateStartX = 0;
let rotateOriginalY = 0;
const AXIS_LENGTH = 1.0;
const GIZMO_PICK_PX = 14;
const ROT_SNAP = Math.PI / 36;  // 5° de snap
const ROT_SENS = 0.012;         // rad por pixel

const AXIS_DIRS = [[1,0,0], [0,1,0], [0,0,1]];
const AXIS_COLORS = ['rgb(255,80,80)', 'rgb(80,230,80)', 'rgb(80,150,255)'];

function getSelectedItem() {
  if (!selected) return null;
  if (selected.kind === 'box')          return placedBoxes[selected.idx];
  if (selected.kind === 'quad-light')   return placedQuadLights[selected.idx];
  if (selected.kind === 'sphere-light') return placedSphereLights[selected.idx];
  return null;
}
function getSelectedCenter() {
  const it = getSelectedItem();
  return it ? it.center.slice() : null;
}

// 8 corners de um box rotacionado (rotY) em torno de center
function boxVertsFor(c, h, rotY) {
  const cosA = Math.cos(rotY), sinA = Math.sin(rotY);
  const verts = [];
  const signs = [
    [-1,-1,-1], [+1,-1,-1], [+1,+1,-1], [-1,+1,-1],
    [-1,-1,+1], [+1,-1,+1], [+1,+1,+1], [-1,+1,+1],
  ];
  for (const [sx, sy, sz] of signs) {
    const lx = sx * h[0], ly = sy * h[1], lz = sz * h[2];
    const wx = lx * cosA + lz * sinA;
    const wz = -lx * sinA + lz * cosA;
    verts.push([c[0] + wx, c[1] + ly, c[2] + wz]);
  }
  return verts;
}

// 4 corners de um quad light rotacionado em torno de center.y
function quadCornersFor(c, hx, hz, rotY) {
  const cosA = Math.cos(rotY), sinA = Math.sin(rotY);
  const corners = [[-hx,-hz],[+hx,-hz],[+hx,+hz],[-hx,+hz]];
  return corners.map(([lx, lz]) => {
    const wx = lx * cosA + lz * sinA;
    const wz = -lx * sinA + lz * cosA;
    return [c[0] + wx, c[1], c[2] + wz];
  });
}

const BOX_GEOM_TEMPLATE = boxGeom([0,0,0], [1,1,1]); // edges/tris fixas
function vertsAABB(verts) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let i = 0; i < 3; i++) {
    if (v[i] < mn[i]) mn[i] = v[i];
    if (v[i] > mx[i]) mx[i] = v[i];
  }
  return [mn, mx];
}
function makeBoxEntryFromVerts(verts, albedo) {
  const [boxMin, boxMax] = vertsAABB(verts);
  return {
    verts,
    edges: BOX_GEOM_TEMPLATE.edges,
    tris:  BOX_GEOM_TEMPLATE.tris,
    rgb: [Math.round(albedo[0]*255), Math.round(albedo[1]*255), Math.round(albedo[2]*255)],
    roomId: 'editor', kind: 'box',
    boxMin, boxMax,
  };
}

// regenera entry visual + tris raytrace de um box
function refreshBoxEntry(b) {
  const verts = boxVertsFor(b.center, b.halfExtents, b.rotY);
  Object.assign(b.entry, makeBoxEntryFromVerts(verts, b.albedo));
}
function refreshQuadEntry(q) {
  const c = quadCornersFor(q.center, q.hx, q.hz, q.rotY);
  Object.assign(q.entry, makeQuadLightEntry(c[0], c[1], c[2], c[3]));
}
function refreshSphereEntry(s) {
  Object.assign(s.entry, makeSphereLightEntry(s.center, s.r));
}

function getWorldRay(mx, my) {
  const m = matMul(rotY(yaw), rotX(pitch));
  const fwd   = matVec(m, [0, 0, -1, 0]).slice(0, 3);
  const right = matVec(m, [1, 0,  0, 0]).slice(0, 3);
  const up    = matVec(m, [0, 1,  0, 0]).slice(0, 3);
  const t = Math.tan(fov/2);
  const ndcX = (2*mx/W - 1) * aspect * t;
  const ndcY = (1 - 2*my/H) * t;
  let dx = fwd[0] + ndcX*right[0] + ndcY*up[0];
  let dy = fwd[1] + ndcX*right[1] + ndcY*up[1];
  let dz = fwd[2] + ndcX*right[2] + ndcY*up[2];
  const dl = Math.hypot(dx, dy, dz);
  return [camPos.slice(), [dx/dl, dy/dl, dz/dl]];
}

function rayBoxT(ro, rd, boxMin, boxMax) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(rd[i]) < 1e-9) {
      if (ro[i] < boxMin[i] || ro[i] > boxMax[i]) return Infinity;
      continue;
    }
    const inv = 1/rd[i];
    let t1 = (boxMin[i] - ro[i]) * inv;
    let t2 = (boxMax[i] - ro[i]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin > 0 ? tmin : tmax;
}

// Möller-Trumbore: t da intersecção raio-tri (Infinity se miss)
function rayTriT(ro, rd, v0, v1, v2) {
  const e1x = v1[0]-v0[0], e1y = v1[1]-v0[1], e1z = v1[2]-v0[2];
  const e2x = v2[0]-v0[0], e2y = v2[1]-v0[1], e2z = v2[2]-v0[2];
  const hx = rd[1]*e2z - rd[2]*e2y;
  const hy = rd[2]*e2x - rd[0]*e2z;
  const hz = rd[0]*e2y - rd[1]*e2x;
  const a = e1x*hx + e1y*hy + e1z*hz;
  if (a > -1e-9 && a < 1e-9) return Infinity;
  const f = 1 / a;
  const sx = ro[0]-v0[0], sy = ro[1]-v0[1], sz = ro[2]-v0[2];
  const u = f * (sx*hx + sy*hy + sz*hz);
  if (u < 0 || u > 1) return Infinity;
  const qx = sy*e1z - sz*e1y;
  const qy = sz*e1x - sx*e1z;
  const qz = sx*e1y - sy*e1x;
  const v = f * (rd[0]*qx + rd[1]*qy + rd[2]*qz);
  if (v < 0 || u + v > 1) return Infinity;
  const t = f * (e2x*qx + e2y*qy + e2z*qz);
  return t > 1e-4 ? t : Infinity;
}

function pickCaveFace(mx, my) {
  const [O, R] = getWorldRay(mx, my);
  let bestT = Infinity, bestEntry = null;
  for (const e of caveSceneEntries) {
    const v = e.verts;
    const t = Math.min(rayTriT(O, R, v[0], v[1], v[2]), rayTriT(O, R, v[0], v[2], v[3]));
    if (t < bestT) { bestT = t; bestEntry = e; }
  }
  return bestEntry;
}

function breakBlock(mx, my) {
  const e = pickCaveFace(mx, my);
  if (!e) return;
  const [i, j, k] = e.voxelOrigin;
  const [dx, dy, dz] = e.faceD;
  const ni = i + dx, nj = j + dy, nk = k + dz;
  // não permita quebrar voxel abaixo do nível do chão atual
  if (nj < 0) return;
  caveVoxels.add(voxelKey(ni, nj, nk));
  rebuildAll();
}

function raySphereT(ro, rd, c, r) {
  const ox = ro[0]-c[0], oy = ro[1]-c[1], oz = ro[2]-c[2];
  const b = ox*rd[0] + oy*rd[1] + oz*rd[2];
  const k = ox*ox + oy*oy + oz*oz - r*r;
  const disc = b*b - k;
  if (disc < 0) return Infinity;
  const sd = Math.sqrt(disc);
  let t = -b - sd;
  if (t < 1e-4) t = -b + sd;
  return t > 1e-4 ? t : Infinity;
}

function pickAny(mx, my) {
  const [O, R] = getWorldRay(mx, my);
  let best = null, bestT = Infinity;
  for (let i = 0; i < placedBoxes.length; i++) {
    const e = placedBoxes[i].entry;
    const t = rayBoxT(O, R, e.boxMin, e.boxMax); // AABB derivado dos verts (loose pra rotacionados)
    if (t < bestT) { bestT = t; best = { kind: 'box', idx: i }; }
  }
  const PAD = 0.1;
  for (let i = 0; i < placedQuadLights.length; i++) {
    const q = placedQuadLights[i];
    const verts = q.entry.verts;
    const xs = [verts[0][0],verts[1][0],verts[2][0],verts[3][0]];
    const ys = [verts[0][1],verts[1][1],verts[2][1],verts[3][1]];
    const zs = [verts[0][2],verts[1][2],verts[2][2],verts[3][2]];
    const min = [Math.min(...xs)-PAD, Math.min(...ys)-PAD, Math.min(...zs)-PAD];
    const max = [Math.max(...xs)+PAD, Math.max(...ys)+PAD, Math.max(...zs)+PAD];
    const t = rayBoxT(O, R, min, max);
    if (t < bestT) { bestT = t; best = { kind: 'quad-light', idx: i }; }
  }
  for (let i = 0; i < placedSphereLights.length; i++) {
    const sl = placedSphereLights[i];
    const t = raySphereT(O, R, sl.center, Math.max(sl.r, 0.2));
    if (t < bestT) { bestT = t; best = { kind: 'sphere-light', idx: i }; }
  }
  return best;
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 < 1e-6) return Math.hypot(px-ax, py-ay);
  let t = ((px - ax)*dx + (py - ay)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t*dx, cy = ay + t*dy;
  return Math.hypot(px - cx, py - cy);
}

function currentViewMatrix() {
  return matMul(matMul(rotX(-pitch), rotY(-yaw)),
                translate(-camPos[0], -camPos[1], -camPos[2]));
}
function pickGizmoAxis(mx, my) {
  if (!selected) return null;
  const view = currentViewMatrix();
  const c = getSelectedCenter();
  if (!c) return null;
  const projC = project(matVec(view, [c[0], c[1], c[2], 1]));
  if (!projC) return null;
  let bestAxis = null, bestDist = GIZMO_PICK_PX;
  for (let i = 0; i < 3; i++) {
    const ep = [c[0] + AXIS_LENGTH*AXIS_DIRS[i][0],
                c[1] + AXIS_LENGTH*AXIS_DIRS[i][1],
                c[2] + AXIS_LENGTH*AXIS_DIRS[i][2]];
    const projE = project(matVec(view, [ep[0], ep[1], ep[2], 1]));
    if (!projE) continue;
    const d = pointToSegmentDist(mx, my, projC[0], projC[1], projE[0], projE[1]);
    if (d < bestDist) { bestDist = d; bestAxis = i; }
  }
  return bestAxis;
}

// closest point on line P+t*D to ray O+s*R, returns t (or null se paralelos)
function closestTOnLineToRay(P, D, O, R) {
  const w0x = P[0]-O[0], w0y = P[1]-O[1], w0z = P[2]-O[2];
  const b = D[0]*R[0] + D[1]*R[1] + D[2]*R[2];
  const d = D[0]*w0x + D[1]*w0y + D[2]*w0z;
  const e = R[0]*w0x + R[1]*w0y + R[2]*w0z;
  const denom = 1 - b*b;
  if (Math.abs(denom) < 1e-4) return null;
  return (b*e - d) / denom;
}

function startGizmoDrag(axis, mx, my) {
  if (!selected) return;
  gizmoDragAxis = axis;
  const center = getSelectedCenter();
  const [O, R] = getWorldRay(mx, my);
  const t = closestTOnLineToRay(center, AXIS_DIRS[axis], O, R);
  if (t === null) { gizmoDragAxis = null; return; }
  gizmoDragInitialT = t;
  const it = getSelectedItem();
  gizmoDragOriginal = { center: it.center.slice() };
}

function updateGizmoDrag(mx, my) {
  if (gizmoDragAxis === null || !selected) return;
  const D = AXIS_DIRS[gizmoDragAxis];
  const cOrig = gizmoDragOriginal.center;
  const [O, R] = getWorldRay(mx, my);
  const t = closestTOnLineToRay(cOrig, D, O, R);
  if (t === null) return;
  let delta = t - gizmoDragInitialT;
  delta = Math.round(delta / SNAP) * SNAP;
  const dx = D[0]*delta, dy = D[1]*delta, dz = D[2]*delta;
  const it = getSelectedItem();
  let newC = [cOrig[0]+dx, cOrig[1]+dy, cOrig[2]+dz];
  // clamp Y por tipo
  if (selected.kind === 'box') {
    if (newC[1] - it.halfExtents[1] < 0) newC[1] = it.halfExtents[1];
    it.center = newC;
    refreshBoxEntry(it);
  } else if (selected.kind === 'quad-light') {
    if (newC[1] < 0.05) newC[1] = 0.05;
    it.center = newC;
    refreshQuadEntry(it);
  } else if (selected.kind === 'sphere-light') {
    if (newC[1] < it.r) newC[1] = it.r;
    it.center = newC;
    refreshSphereEntry(it);
  }
}

function endGizmoDrag() {
  if (gizmoDragAxis === null) return;
  rebuildAll();
  gizmoDragAxis = null;
  gizmoDragOriginal = null;
}

// rotação Y (transformMode === 'rotate')
function startRotateDrag(mx) {
  if (!selected || selected.kind === 'sphere-light') return;
  const it = getSelectedItem();
  rotateStartX = mx;
  rotateOriginalY = it.rotY;
  isRotating = true;
}
function updateRotateDrag(mx) {
  if (!isRotating || !selected) return;
  const it = getSelectedItem();
  const dx = mx - rotateStartX;
  const target = rotateOriginalY + dx * ROT_SENS;
  it.rotY = Math.round(target / ROT_SNAP) * ROT_SNAP;
  if (selected.kind === 'box')        refreshBoxEntry(it);
  else if (selected.kind === 'quad-light') refreshQuadEntry(it);
}
function endRotateDrag() {
  if (!isRotating) return;
  rebuildAll();
  isRotating = false;
}

function drawArrow(view, from, to, color) {
  const pa = project(matVec(view, [from[0], from[1], from[2], 1]));
  const pb = project(matVec(view, [to[0], to[1], to[2], 1]));
  if (!pa || !pb) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pa[0], pa[1]);
  ctx.lineTo(pb[0], pb[1]);
  ctx.stroke();
  // ponta da seta (triângulo simples no end-point)
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx/len, uy = dy/len;
  const SIZE = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pb[0], pb[1]);
  ctx.lineTo(pb[0] - ux*SIZE - uy*SIZE*0.4, pb[1] - uy*SIZE + ux*SIZE*0.4);
  ctx.lineTo(pb[0] - ux*SIZE + uy*SIZE*0.4, pb[1] - uy*SIZE - ux*SIZE*0.4);
  ctx.closePath();
  ctx.fill();
}

function drawGizmo(view) {
  if (!selected) return;
  const it = getSelectedItem();
  if (!it) return;
  const c = getSelectedCenter();
  // outline do item selecionado (amarelo)
  const projVerts = it.entry.verts.map(p => project(matVec(view, [p[0], p[1], p[2], 1])));
  ctx.strokeStyle = 'rgba(255,210,80,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [a, c2] of it.entry.edges) {
    const pa = projVerts[a], pb = projVerts[c2];
    if (!pa || !pb) continue;
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
  }
  ctx.stroke();

  if (transformMode === 'move') {
    for (let i = 0; i < 3; i++) {
      const to = [c[0]+AXIS_LENGTH*AXIS_DIRS[i][0],
                  c[1]+AXIS_LENGTH*AXIS_DIRS[i][1],
                  c[2]+AXIS_LENGTH*AXIS_DIRS[i][2]];
      drawArrow(view, c, to, AXIS_COLORS[i]);
    }
  } else if (transformMode === 'rotate') {
    // círculo no plano XZ em torno do centro (raio 1m)
    if (selected.kind === 'sphere-light') return; // sphere não rotaciona
    ctx.strokeStyle = AXIS_COLORS[1]; // verde (eixo Y)
    ctx.lineWidth = 2;
    ctx.beginPath();
    const SEGS = 48, R = 1.0;
    let lastP = null;
    for (let i = 0; i <= SEGS; i++) {
      const ang = (i / SEGS) * 2 * Math.PI;
      const p = project(matVec(view, [c[0]+R*Math.cos(ang), c[1], c[2]+R*Math.sin(ang), 1]));
      if (p) {
        if (lastP) { ctx.moveTo(lastP[0], lastP[1]); ctx.lineTo(p[0], p[1]); }
      }
      lastP = p;
    }
    ctx.stroke();
  }
}

// ---------- editor: drag-and-drop de primitivas (box, quad-light, sphere-light) ----------
// Box (3 fases): xz drag → height drag → click commita
// Quad light (1 fase): xz drag → release commita (altura fixa 2.5m)
// Sphere light (0 fases): click commita imediato (1.5m altura, raio 0.15m)
let placeKind  = null;       // null | 'box' | 'quad-light' | 'sphere-light'
let placePhase = 'idle';     // 'idle' | 'xz' | 'height'
let placingBox = null;       // ref no scene[] enquanto desenha
// cornerA/B em ÍNDICES INTEIROS de célula (não em metros). Comparações
// exatas; converte pra coords via cellToCoord. Evita drift de float.
let cornerA = null, cornerB = null;
let placingCellsH = 1;       // altura em células (mín 1 = 10cm)
let heightStartY = 0;
let heightBaselineCells = 1;
const PLACE_RGB = [115, 178, 217];
const PLACE_ALB = [0.45, 0.70, 0.85];
const QUAD_LIGHT_Y = 2.5;
const QUAD_LIGHT_EMISSION = [16, 13, 8];
const QUAD_LIGHT_RGB = [255, 230, 180];
const SPHERE_LIGHT_Y = 1.5;
const SPHERE_LIGHT_R = 0.15;
const SPHERE_LIGHT_EMISSION = [12, 9, 5];
const SPHERE_LIGHT_RGB = [255, 220, 150];
const HEIGHT_PX_PER_M = 60;
const SNAP = 0.1;
const PX_PER_CELL = HEIGHT_PX_PER_M * SNAP; // 6 pixels = 1 célula vertical
const cellOf = v => Math.round(v / SNAP);
const coordOf = c => c * SNAP;

function rayToFloor(mouseX, mouseY) {
  const m = matMul(rotY(yaw), rotX(pitch));
  const fwd   = matVec(m, [0, 0, -1, 0]).slice(0, 3);
  const right = matVec(m, [1, 0,  0, 0]).slice(0, 3);
  const up    = matVec(m, [0, 1,  0, 0]).slice(0, 3);
  const tanHalfFov = Math.tan(fov/2);
  const ndcX = (2*mouseX/W - 1) * aspect * tanHalfFov;
  const ndcY = (1 - 2*mouseY/H) * tanHalfFov;
  let dx = fwd[0] + ndcX*right[0] + ndcY*up[0];
  let dy = fwd[1] + ndcX*right[1] + ndcY*up[1];
  let dz = fwd[2] + ndcX*right[2] + ndcY*up[2];
  const dl = Math.hypot(dx, dy, dz);
  dx /= dl; dy /= dl; dz /= dl;
  if (dy >= -1e-4) return null;
  const t = -camPos[1] / dy;
  if (t <= 0) return null;
  return [camPos[0] + t*dx, 0, camPos[2] + t*dz];
}

function makeBoxEntry(min, max) {
  return {
    ...boxGeom(min, max), rgb: PLACE_RGB, roomId: 'editor', kind: 'box',
    boxMin: min, boxMax: max,
  };
}

function makeQuadLightEntry(p0, p1, p2, p3) {
  const q = { p0, p1, p2, p3, rgb: QUAD_LIGHT_RGB };
  return { ...quadEntry(q), rgb: QUAD_LIGHT_RGB, emissive: true, roomId: 'editor', kind: 'quad' };
}

function makeSphereLightEntry(c, r) {
  return {
    ...sphereGeom(c, r, 10, 14), rgb: SPHERE_LIGHT_RGB, emissive: true,
    roomId: 'editor', kind: 'sphere', sphCenter: c, sphRadius: r,
  };
}

function rebuildGhost() {
  if (placeKind === 'box') {
    const x0 = coordOf(Math.min(cornerA[0], cornerB[0]));
    const x1 = coordOf(Math.max(cornerA[0], cornerB[0]));
    const z0 = coordOf(Math.min(cornerA[1], cornerB[1]));
    const z1 = coordOf(Math.max(cornerA[1], cornerB[1]));
    const yMax = coordOf(placingCellsH);
    Object.assign(placingBox, makeBoxEntry([x0, 0, z0], [x1, yMax, z1]));
  } else if (placeKind === 'quad-light') {
    const x0 = coordOf(Math.min(cornerA[0], cornerB[0]));
    const x1 = coordOf(Math.max(cornerA[0], cornerB[0]));
    const z0 = coordOf(Math.min(cornerA[1], cornerB[1]));
    const z1 = coordOf(Math.max(cornerA[1], cornerB[1]));
    const y = QUAD_LIGHT_Y;
    Object.assign(placingBox, makeQuadLightEntry(
      [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]));
  }
}

function clearGhost() {
  if (!placingBox) return;
  const idx = scene.indexOf(placingBox);
  if (idx !== -1) scene.splice(idx, 1);
  placingBox = null;
}

function placeStartXZ(mx, my) {
  const hit = rayToFloor(mx, my);
  if (!hit) return;
  const cx = cellOf(hit[0]), cz = cellOf(hit[2]);
  cornerA = [cx, cz];
  cornerB = [cx, cz];
  placingCellsH = 1;
  placingBox = makeBoxEntry([coordOf(cx), 0, coordOf(cz)],
                             [coordOf(cx), SNAP, coordOf(cz)]);
  scene.push(placingBox);
  placePhase = 'xz';
}

function placeMoveXZ(mx, my) {
  if (!placingBox) return;
  const hit = rayToFloor(mx, my);
  if (!hit) return;
  cornerB = [cellOf(hit[0]), cellOf(hit[2])];
  rebuildGhost();
}

function placeFinalizeXZ(my) {
  if (!placingBox) return;
  // diff em células (inteiros) — sem drift de float
  const dxCells = Math.abs(cornerB[0] - cornerA[0]);
  const dzCells = Math.abs(cornerB[1] - cornerA[1]);
  if (dxCells === 0 || dzCells === 0) { // arrasto sem área → cancela
    clearGhost();
    placePhase = 'idle';
    return;
  }
  heightStartY = my;
  placingCellsH = Math.max(1, Math.min(dxCells, dzCells)); // altura = lado mais curto
  heightBaselineCells = placingCellsH;
  rebuildGhost();
  placePhase = 'height';
}

function placeUpdateHeight(my) {
  if (!placingBox) return;
  const dy = heightStartY - my; // pixels (mouse pra cima = +)
  const deltaCells = Math.round(dy / PX_PER_CELL);
  placingCellsH = Math.max(1, heightBaselineCells + deltaCells);
  rebuildGhost();
}

function placeCommit() {
  if (!placingBox) return;
  const min = placingBox.boxMin.slice();
  const max = placingBox.boxMax.slice();
  const center = [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2];
  const halfExtents = [(max[0]-min[0])/2, (max[1]-min[1])/2, (max[2]-min[2])/2];
  const verts = boxVertsFor(center, halfExtents, 0);
  Object.assign(placingBox, makeBoxEntryFromVerts(verts, PLACE_ALB));
  placedBoxes.push({ entry: placingBox, center, halfExtents, rotY: 0, albedo: PLACE_ALB });
  addRuntimeBoxFromVerts(verts, PLACE_ALB);
  placingBox = null;
  placePhase = 'idle';
  cornerA = cornerB = null;
}

function placeCancel() {
  clearGhost();
  placePhase = 'idle';
  cornerA = cornerB = null;
}

// quad light: drag-and-drop XZ no chão, light vai pra y=2.5m
function placeQuadStart(mx, my) {
  const hit = rayToFloor(mx, my);
  if (!hit) return;
  const cx = cellOf(hit[0]), cz = cellOf(hit[2]);
  cornerA = [cx, cz];
  cornerB = [cx, cz];
  const x = coordOf(cx), z = coordOf(cz), y = QUAD_LIGHT_Y;
  placingBox = makeQuadLightEntry([x,y,z], [x,y,z], [x,y,z], [x,y,z]);
  scene.push(placingBox);
  placePhase = 'xz';
}

function placeQuadCommit() {
  if (!placingBox) return;
  const dxC = Math.abs(cornerB[0] - cornerA[0]);
  const dzC = Math.abs(cornerB[1] - cornerA[1]);
  if (dxC === 0 || dzC === 0) { clearGhost(); placePhase = 'idle'; return; }
  const x0 = coordOf(Math.min(cornerA[0], cornerB[0]));
  const x1 = coordOf(Math.max(cornerA[0], cornerB[0]));
  const z0 = coordOf(Math.min(cornerA[1], cornerB[1]));
  const z1 = coordOf(Math.max(cornerA[1], cornerB[1]));
  const center = [(x0+x1)/2, QUAD_LIGHT_Y, (z0+z1)/2];
  const hx = (x1-x0)/2, hz = (z1-z0)/2;
  const corners = quadCornersFor(center, hx, hz, 0);
  Object.assign(placingBox, makeQuadLightEntry(corners[0], corners[1], corners[2], corners[3]));
  addRuntimeQuadLight(corners[0], corners[1], corners[2], corners[3], QUAD_LIGHT_EMISSION);
  placedQuadLights.push({ entry: placingBox, center, hx, hz, rotY: 0, emission: QUAD_LIGHT_EMISSION });
  placingBox = null;
  placePhase = 'idle';
  cornerA = cornerB = null;
}

// sphere light: single-click commita
function placeSphereSingleClick(mx, my) {
  const hit = rayToFloor(mx, my);
  if (!hit) return;
  const c = [coordOf(cellOf(hit[0])), SPHERE_LIGHT_Y, coordOf(cellOf(hit[2]))];
  const entry = makeSphereLightEntry(c, SPHERE_LIGHT_R);
  scene.push(entry);
  addRuntimeSphereLight(c, SPHERE_LIGHT_R, SPHERE_LIGHT_EMISSION);
  placedSphereLights.push({ entry, center: c, r: SPHERE_LIGHT_R, emission: SPHERE_LIGHT_EMISSION });
}

// ESC cancela qualquer fase intermediária
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && placePhase !== 'idle') placeCancel();
});

// ---------- grid no chão (y=0): 10cm minor + 1m major ----------
// Renderiza só em wireframe/shaded. Linhas projetadas com near-plane clip
// pra não desaparecerem quando passam por trás da câmera.
const GRID_NEAR = 0.05;
function drawClippedLine(view, a, b) {
  const va = matVec(view, [a[0], a[1], a[2], 1]);
  const vb = matVec(view, [b[0], b[1], b[2], 1]);
  if (va[2] >= -GRID_NEAR && vb[2] >= -GRID_NEAR) return;
  let pa = va, pb = vb;
  if (va[2] >= -GRID_NEAR) {
    const t = (-GRID_NEAR - vb[2]) / (va[2] - vb[2]);
    pa = [vb[0] + t*(va[0]-vb[0]), vb[1] + t*(va[1]-vb[1]), -GRID_NEAR, 1];
  } else if (vb[2] >= -GRID_NEAR) {
    const t = (-GRID_NEAR - va[2]) / (vb[2] - va[2]);
    pb = [va[0] + t*(vb[0]-va[0]), va[1] + t*(vb[1]-va[1]), -GRID_NEAR, 1];
  }
  const sa = project(pa);
  const sb = project(pb);
  if (sa && sb) {
    ctx.moveTo(sa[0], sa[1]);
    ctx.lineTo(sb[0], sb[1]);
  }
}
function drawGridLines(view, radius, step, strokeColor) {
  const x0 = Math.floor((camPos[0] - radius) / step) * step;
  const x1 = Math.ceil ((camPos[0] + radius) / step) * step;
  const z0 = Math.floor((camPos[2] - radius) / step) * step;
  const z1 = Math.ceil ((camPos[2] + radius) / step) * step;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1 + step*0.5; x += step) drawClippedLine(view, [x, 0, z0], [x, 0, z1]);
  for (let z = z0; z <= z1 + step*0.5; z += step) drawClippedLine(view, [x0, 0, z], [x1, 0, z]);
  ctx.stroke();
}
function drawFloorGrid(view) {
  drawGridLines(view, 6,   0.1, 'rgba(180,200,220,0.18)');  // minor (10cm)
  drawGridLines(view, 12,  1.0, 'rgba(180,200,220,0.45)');  // major (1m)
}

// wall grid voxel-aware: pra cada cave wall face existente, desenha
// 10 subdivisões em cada direção (10cm). O perímetro 1m é o próprio
// edge do quad (já desenhado pelo wireframe se ativo).
function drawWallGrid(view) {
  if (caveSceneEntries.length > 0) {
    drawCaveWallGrid(view);
    return;
  }
  // fallback: cômodos com bounds finitos (gallery, hermitage)
  const bounds = getActiveRoomBounds();
  if (!bounds || Math.abs(bounds.max[0] - bounds.min[0]) > 50) return;
  drawWallGridLines(view, bounds, 0.1, 'rgba(180,200,220,0.13)');
  drawWallGridLines(view, bounds, 1.0, 'rgba(180,200,220,0.40)');
}
function drawCaveWallGrid(view) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(180,200,220,0.13)'; // 10cm minor
  ctx.beginPath();
  const N = 10;
  for (const e of caveSceneEntries) {
    const [p0, p1, p2, p3] = e.verts;
    // direções da grade no espaço da face
    const u = [(p1[0]-p0[0])/N, (p1[1]-p0[1])/N, (p1[2]-p0[2])/N];
    const v = [(p3[0]-p0[0])/N, (p3[1]-p0[1])/N, (p3[2]-p0[2])/N];
    for (let i = 1; i < N; i++) {
      const a = [p0[0]+i*u[0], p0[1]+i*u[1], p0[2]+i*u[2]];
      const b = [p3[0]+i*u[0], p3[1]+i*u[1], p3[2]+i*u[2]];
      drawClippedLine(view, a, b);
      const c = [p0[0]+i*v[0], p0[1]+i*v[1], p0[2]+i*v[2]];
      const d = [p1[0]+i*v[0], p1[1]+i*v[1], p1[2]+i*v[2]];
      drawClippedLine(view, c, d);
    }
  }
  ctx.stroke();
  // contorno 1m (perímetro de cada face) major
  ctx.strokeStyle = 'rgba(180,200,220,0.40)';
  ctx.beginPath();
  for (const e of caveSceneEntries) {
    const [p0, p1, p2, p3] = e.verts;
    drawClippedLine(view, p0, p1);
    drawClippedLine(view, p1, p2);
    drawClippedLine(view, p2, p3);
    drawClippedLine(view, p3, p0);
  }
  ctx.stroke();
}
function drawWallGridLines(view, bounds, step, color) {
  const x0 = bounds.min[0], x1 = bounds.max[0];
  const y0 = bounds.min[1], y1 = bounds.max[1];
  const z0 = bounds.min[2], z1 = bounds.max[2];
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // alinha o grid pela borda da sala (não pelo grid do mundo) — assim
  // uma parede de 3m fica 3 blocos de 1m, não 0.5+1+1+0.5
  const eps = step * 0.5;
  // linhas horizontais (constant y) — paredes
  for (let y = y0; y <= y1 + eps; y += step) {
    drawClippedLine(view, [x0, y, z0], [x0, y, z1]); // west
    drawClippedLine(view, [x1, y, z0], [x1, y, z1]); // east
    drawClippedLine(view, [x0, y, z0], [x1, y, z0]); // south
    drawClippedLine(view, [x0, y, z1], [x1, y, z1]); // north
  }
  // linhas em Z (constant x ou y, varying z) — paredes laterais + chão + teto
  for (let z = z0; z <= z1 + eps; z += step) {
    drawClippedLine(view, [x0, y0, z], [x0, y1, z]); // west
    drawClippedLine(view, [x1, y0, z], [x1, y1, z]); // east
    drawClippedLine(view, [x0, y0, z], [x1, y0, z]); // chão
    drawClippedLine(view, [x0, y1, z], [x1, y1, z]); // teto
  }
  // linhas em X (varying x) — paredes south/north + chão + teto
  for (let x = x0; x <= x1 + eps; x += step) {
    drawClippedLine(view, [x, y0, z0], [x, y1, z0]); // south
    drawClippedLine(view, [x, y0, z1], [x, y1, z1]); // north
    drawClippedLine(view, [x, y0, z0], [x, y0, z1]); // chão
    drawClippedLine(view, [x, y1, z0], [x, y1, z1]); // teto
  }
  ctx.stroke();
}

function clearAllPlaced() {
  if (placePhase !== 'idle') placeCancel();
  // remove visual entries placed (mantém entries da cave)
  scene.length = 0;
  for (const e of caveSceneEntries) scene.push(e);
  placedBoxes.length = 0;
  placedQuadLights.length = 0;
  placedSphereLights.length = 0;
  selected = null;
  rebuildAll();
  if (splatLayerCtx) splatLayerCtx.clearRect(0, 0, W, H);
}

const btnClearEl = document.getElementById('btn-clear');
if (btnClearEl) {
  btnClearEl.addEventListener('click', clearAllPlaced);
  btnClearEl.addEventListener('touchstart', e => { e.preventDefault(); clearAllPlaced(); }, { passive: false });
}

const btnCursorEl      = document.getElementById('btn-cursor');
const btnMoveEl        = document.getElementById('btn-move');
const btnRotateEl      = document.getElementById('btn-rotate');
const btnBreakEl       = document.getElementById('btn-break');
const btnPlaceEl       = document.getElementById('btn-place');
const btnQuadLightEl   = document.getElementById('btn-quad-light');
const btnSphereLightEl = document.getElementById('btn-sphere-light');

function setTransformMode(mode) {
  transformMode = mode;
  btnMoveEl?.classList.toggle('active',   mode === 'move');
  btnRotateEl?.classList.toggle('active', mode === 'rotate');
}
function bindTransformBtn(el, mode) {
  if (!el) return;
  el.addEventListener('click', () => setTransformMode(mode));
  el.addEventListener('touchstart', e => { e.preventDefault(); setTransformMode(mode); }, { passive: false });
}
bindTransformBtn(btnMoveEl,   'move');
bindTransformBtn(btnRotateEl, 'rotate');
btnMoveEl?.classList.add('active'); // default = move

function setPlaceKind(kind) {
  if (placePhase !== 'idle') placeCancel();
  placeKind = (placeKind === kind) ? null : kind;
  btnCursorEl?.classList.toggle('active',      placeKind === null);
  btnPlaceEl?.classList.toggle('active',       placeKind === 'box');
  btnQuadLightEl?.classList.toggle('active',   placeKind === 'quad-light');
  btnSphereLightEl?.classList.toggle('active', placeKind === 'sphere-light');
  btnBreakEl?.classList.toggle('active',       placeKind === 'break');
  document.body.style.cursor = placeKind ? 'crosshair' : '';
}
function bindKindBtn(el, kind) {
  if (!el) return;
  el.addEventListener('click', () => setPlaceKind(kind));
  el.addEventListener('touchstart', e => { e.preventDefault(); setPlaceKind(kind); }, { passive: false });
}
bindKindBtn(btnCursorEl,      null);
bindKindBtn(btnPlaceEl,       'box');
bindKindBtn(btnQuadLightEl,   'quad-light');
bindKindBtn(btnSphereLightEl, 'sphere-light');
bindKindBtn(btnBreakEl,       'break');

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
    } else if (t.identifier === placeTouchId) {
      placeMoveXZ(t.clientX, t.clientY);
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

function endTouch(t) {
  if (t.identifier === joystickTouchId) {
    joystickTouchId = null;
    joystickX = 0; joystickY = 0;
    joystickThumbEl.style.transform = 'translate(0,0)';
  } else if (t.identifier === placeTouchId) {
    placeTouchId = null;
    if (placePhase === 'xz' && placingBox) {
      if (placeKind === 'box') {
        // mobile: usa altura padrão 1m e commita
        const dxC = Math.abs(cornerB[0] - cornerA[0]);
        const dzC = Math.abs(cornerB[1] - cornerA[1]);
        if (dxC === 0 || dzC === 0) placeCancel();
        else { placingCellsH = 10; rebuildGhost(); placeCommit(); }
      } else if (placeKind === 'quad-light') {
        placeQuadCommit();
      }
    }
  } else if (t.identifier === lookTouchId) {
    lookTouchId = null;
  }
}
window.addEventListener('touchend',    e => { for (const t of e.changedTouches) endTouch(t); });
window.addEventListener('touchcancel', e => { for (const t of e.changedTouches) endTouch(t); });

// drag-pra-olhar (ou placement, se em placeKind): touches no canvas
canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystickTouchId) continue;
    if (placeKind === 'sphere-light') {
      placeSphereSingleClick(t.clientX, t.clientY);
      e.preventDefault();
      break;
    }
    if (placeKind === 'break') {
      breakBlock(t.clientX, t.clientY);
      e.preventDefault();
      break;
    }
    if (placeKind && placeTouchId === null) {
      placeTouchId = t.identifier;
      if (placeKind === 'box')          placeStartXZ(t.clientX, t.clientY);
      else if (placeKind === 'quad-light') placeQuadStart(t.clientX, t.clientY);
      e.preventDefault();
      break;
    }
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

// colisão voxel-aware: dado pos candidata XZ, retorna pos válida (slide).
// Player ocupa raio r. Verifica voxels nos 4 lados (X,Z separados pra slide).
function collideXZ(curX, curZ, newX, newZ) {
  const r = PLAYER_RADIUS;
  const j = Math.floor(camPos[1] / 1); // voxel de altura (eye level)
  const ground = Math.max(0, j - 1); // também checa voxel do "torso"
  function blockedAt(x, z) {
    // checa voxel(s) sob raio r: testa cantos do AABB do player
    for (const dx of [-r, +r]) for (const dz of [-r, +r]) {
      const vi = Math.round(x + dx);
      const vk = Math.round(z + dz);
      // checa nos voxels j (cabeça) e ground (corpo) — se algum sólido, bloqueia
      if (!isEmptyVoxel(vi, j, vk)) return true;
      if (j !== ground && !isEmptyVoxel(vi, ground, vk)) return true;
    }
    return false;
  }
  // tenta X primeiro (slide ao longo de Z)
  let okX = newX, okZ = curZ;
  if (blockedAt(newX, curZ)) okX = curX;
  // tenta Z (slide ao longo de X)
  if (!blockedAt(okX, newZ)) okZ = newZ;
  return [okX, okZ];
}

function applyMovement(dt) {
  let moved = false;
  const fast = keys.ShiftLeft || keys.ShiftRight;
  const speed = (fast ? 8 : 3) * dt;
  if (speed === 0) return false;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fx = -sy, fz = -cy;
  const rx = cy,  rz = -sy;
  let dx = 0, dz = 0;
  if (keys.KeyW) { dx += fx*speed; dz += fz*speed; moved = true; }
  if (keys.KeyS) { dx -= fx*speed; dz -= fz*speed; moved = true; }
  if (keys.KeyD) { dx += rx*speed; dz += rz*speed; moved = true; }
  if (keys.KeyA) { dx -= rx*speed; dz -= rz*speed; moved = true; }
  if (joystickX !== 0 || joystickY !== 0) {
    const fAmt = joystickY * speed;
    const rAmt = joystickX * speed;
    dx += fx*fAmt + rx*rAmt;
    dz += fz*fAmt + rz*rAmt;
    moved = true;
  }
  const [okX, okZ] = collideXZ(camPos[0], camPos[2], camPos[0]+dx, camPos[2]+dz);
  camPos[0] = okX;
  camPos[2] = okZ;
  camPos[1] = PLAYER_HEIGHT;
  return moved;
}
window.addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') {
    if (mode !== 'wireframe' && mode !== 'shaded' && mode !== 'solid') return;
    mode = mode === 'wireframe' ? 'shaded' : (mode === 'shaded' ? 'solid' : 'wireframe');
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
  const isLT = mode === 'lighttrace';
  document.getElementById('btn-params')?.classList.toggle('visible', isLT);
  // painel começa fechado a cada entrada; usuário abre via botão ≡
  if (!isLT) ltPanel.classList.remove('open');
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
  btnLEl?.classList.add('active');
}

function exitLightTrace() {
  mode = prevRasterMode;
  if (modeLabel) modeLabel.textContent = mode;
  syncLightTracePanel();
  btnLEl?.classList.remove('active');
}

const btnLEl = document.getElementById('btn-l');
function toggleLightTrace() {
  if (mode === 'pathtrace') return;
  if (mode === 'lighttrace') exitLightTrace();
  else enterLightTrace();
}
if (btnLEl) {
  btnLEl.addEventListener('click', toggleLightTrace);
  // touchstart com preventDefault evita o duplo-fire (touch + click sintético)
  btnLEl.addEventListener('touchstart', e => { e.preventDefault(); toggleLightTrace(); }, { passive: false });
}

const btnParamsEl = document.getElementById('btn-params');
function toggleParamsPanel() {
  if (!ltPanel || mode !== 'lighttrace') return;
  ltPanel.classList.toggle('open');
}
if (btnParamsEl) {
  btnParamsEl.addEventListener('click', toggleParamsPanel);
  btnParamsEl.addEventListener('touchstart', e => { e.preventDefault(); toggleParamsPanel(); }, { passive: false });
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
bindSlider('lt-fpb',      'lt-fpb-val',      v => ltFramesPerBounce = Math.max(1, v|0));

const ltResetBtn = document.getElementById('lt-reset');
if (ltResetBtn) ltResetBtn.addEventListener('click', () => {
  photonHead = 0;
  photonCount = 0;
  photonAge.fill(0);
  photonSplatStage.fill(0);
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
  else if (mode === 'solid')      drawSolid(view);
  else if (mode === 'lighttrace') drawLightTrace(view, dt);
  // wall grid via ctx só em wire/shaded; solid já desenha grid próprio z-buffered
  if (mode === 'wireframe' || mode === 'shaded') drawWallGrid(view);
  if (mode === 'wireframe' || mode === 'shaded' || mode === 'solid') drawGizmo(view);

  rafId = requestAnimationFrame(frame);
}

async function init() {
  // ?scene=<id> troca cena. default = cave; outras: empty, hermitage-enfilade, gallery
  const sceneId = new URLSearchParams(location.search).get('scene') || 'cave';
  await loadScene(`${import.meta.env.BASE_URL}scenes/${sceneId}/manifest.json`);
  buildVisualScene();
  if (sceneId === 'cave') {
    initCaveVoxels();
    rebuildAll();
  }
  sceneOriginalLength = scene.length;
  frame();
}
init();

if (import.meta.hot) {
  import.meta.hot.dispose(() => cancelAnimationFrame(rafId));
}
