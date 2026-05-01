const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const modeLabel = document.getElementById('mode-label');
let W = 0, H = 0, aspect = 1;
let inPathTrace = false;

function resize() {
  if (inPathTrace) return; // PT controla seu próprio canvas
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
const cube = {
  verts: [
    [-1,-1,-1],[ 1,-1,-1],[ 1, 1,-1],[-1, 1,-1],
    [-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],
  ],
  edges: [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ],
  tris: [
    [0,3,2],[0,2,1],          // -z
    [4,5,6],[4,6,7],          // +z
    [0,1,5],[0,5,4],          // -y
    [3,7,6],[3,6,2],          // +y
    [0,4,7],[0,7,3],          // -x
    [1,2,6],[1,6,5],          // +x
  ],
};

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

const floor    = planeGrid([-3, -1, -3], [6, 0, 0], [0, 0, 5]);
const backWall = planeGrid([-3, -1, -3], [6, 0, 0], [0, 4, 0]);
const leftWall = planeGrid([-3, -1, -3], [0, 0, 5], [0, 4, 0]);

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

const lightVis = sphereGeom(lightSphere.c, lightSphere.r, 12, 16);

const scene = [
  { ...cube,     rgb: [120, 170, 255] },
  { ...floor,    rgb: [80, 180, 130]  },
  { ...backWall, rgb: [200, 90, 90]   },
  { ...leftWall, rgb: [200, 200, 80]  },
  { ...lightVis, rgb: [255, 230, 150], emissive: true },
];

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
import { startPathTracer, stopPathTracer, lightSphere } from './raytrace.js';

let mode = 'wireframe';      // wireframe | shaded | pathtrace
let prevMode = 'wireframe';  // pra voltar quando sair do PT
let rx = 0.2, ry = 0.5;
let dragging = false, lastX = 0, lastY = 0;
const samplesInfo = document.getElementById('samples-info');
const samplesEl   = document.getElementById('samples');

canvas.addEventListener('mousedown', e => {
  if (mode === 'pathtrace') return;
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  ry += (e.clientX - lastX) * 0.01;
  rx += (e.clientY - lastY) * 0.01;
  lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') {
    if (mode === 'pathtrace') return;
    mode = mode === 'wireframe' ? 'shaded' : 'wireframe';
    if (modeLabel) modeLabel.textContent = mode;
  } else if (e.key === 'r' || e.key === 'R') {
    if (mode === 'pathtrace') exitPathTrace();
    else enterPathTrace();
  }
});

// ---------- camera extraída da view do raster ----------
// view = T(-7) * Rx(rx) * Ry(ry)  →  view⁻¹ = Ry(-ry) * Rx(-rx) * T(+7)
// Aplicado em (0,0,0,1) dá camPos no mundo; em (0,0,-1,0) dá fwd; etc.
function buildCamera() {
  const inv = matMul(rotY(-ry), rotX(-rx));
  const pos   = matVec(inv, [0, 0, 7, 1]).slice(0, 3);
  const fwd   = matVec(inv, [0, 0, -1, 0]).slice(0, 3);
  const right = matVec(inv, [1, 0, 0, 0]).slice(0, 3);
  const up    = matVec(inv, [0, 1, 0, 0]).slice(0, 3);
  return { pos, fwd, right, up, fov };
}

// ---------- transição raster ↔ pathtrace ----------
function enterPathTrace() {
  prevMode = mode;
  mode = 'pathtrace';
  inPathTrace = true;
  cancelAnimationFrame(rafId);

  // resolução interna baixa pro PT rodar em CPU; CSS faz upscale
  const targetW = 480;
  const ar = window.innerWidth / window.innerHeight;
  canvas.width = targetW;
  canvas.height = Math.max(1, Math.round(targetW / ar));
  canvas.style.imageRendering = 'pixelated';
  imageData = null;

  if (modeLabel) modeLabel.textContent = 'path tracer';
  if (samplesInfo) samplesInfo.style.display = '';

  startPathTracer({
    canvas,
    ctx,
    sampleEl: samplesEl,
    camera: buildCamera(),
  });
}

function exitPathTrace() {
  stopPathTracer();
  mode = prevMode;
  inPathTrace = false;
  canvas.style.imageRendering = '';
  if (samplesInfo) samplesInfo.style.display = 'none';
  if (modeLabel) modeLabel.textContent = mode;
  resize();
  frame();
}

// ---------- loop ----------
let rafId = 0;
function frame() {
  if (mode === 'pathtrace') return;  // PT roda seu próprio loop
  const view = matMul(translate(0, 0, -7), matMul(rotX(rx), rotY(ry)));
  if (mode === 'wireframe') drawWireframe(view);
  else drawShaded(view);
  rafId = requestAnimationFrame(frame);
}
frame();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(rafId);
    stopPathTracer();
  });
}
