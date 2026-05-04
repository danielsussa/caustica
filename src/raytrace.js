// ======================================================
// Path tracer + photon tracing.
// Cena é carregada async via loadScene(manifestUrl) — não construída aqui.
// BVH e arrays planos (allTris/allSphs/allLights) são reconstruídos
// a cada loadScene.
// ======================================================

// ---------- vec3 ----------
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [
  a[1]*b[2] - a[2]*b[1],
  a[2]*b[0] - a[0]*b[2],
  a[0]*b[1] - a[1]*b[0],
];
const norm = a => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0]/l, a[1]/l, a[2]/l];
};

const M_DIFFUSE = 0;
const M_LIGHT   = 1;

function albToRgb(albedo) {
  return [Math.round(albedo[0]*255), Math.round(albedo[1]*255), Math.round(albedo[2]*255)];
}

// ---------- estado (mutável; populado por loadScene) ----------
export const rooms = [];
let activeRoom = null;
let manifestData = null;
const allTris = [];
const allSphs = [];
const allLights = [];
// snapshots dos tamanhos de arrays após loadScene — pra clearRuntime
// truncar de volta sem mexer na geometria da cena original.
let sceneTriCount = 0;
let sceneLightCount = 0;

// ---------- scene loader ----------
export async function loadScene(manifestUrl) {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`loadScene: ${manifestUrl} → ${res.status}`);
  manifestData = await res.json();
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);

  rooms.length = 0;
  allTris.length = 0;
  allSphs.length = 0;
  allLights.length = 0;

  const loaded = await Promise.all(manifestData.rooms.map(async (meta) => {
    const r = await fetch(baseUrl + meta.file);
    if (!r.ok) throw new Error(`loadScene: ${meta.file} → ${r.status}`);
    return r.json();
  }));
  for (const room of loaded) {
    rooms.push(room);
    for (const t of room.tris)   allTris.push(t);
    for (const s of room.sphs)   allSphs.push(s);
    for (const l of room.lights) allLights.push(l);
  }
  sceneTriCount = allTris.length;
  sceneLightCount = allLights.length;
  rebuildBVH();
  activeRoom = rooms[0] || null;
  return manifestData;
}

// boxes em runtime (truncados a partir de sceneTriCount).
export function clearRuntimeBoxes() {
  if (allTris.length > sceneTriCount) {
    allTris.length = sceneTriCount;
    rebuildBVH();
  }
}
// lights em runtime (truncados a partir de sceneLightCount).
export function clearRuntimeLights() {
  if (allLights.length > sceneLightCount) {
    allLights.length = sceneLightCount;
  }
}

export function getManifest() { return manifestData; }
export function getPortals()  { return manifestData?.portals || []; }

// ---------- objetos animados ----------
// Listas separadas (não entram no BVH). Intersect brute force, são poucos.
// Posições são atualizadas em tickAnimation(t) toda frame.
const dynamicSphs = [];
const dynamicEntries = [];
const dynamicVisual = [];

export function addAnimatedSphere(initC, r, albedo, animFn) {
  const c = initC.slice();
  const item = { c, r, mat: { kind: M_DIFFUSE, albedo } };
  dynamicSphs.push(item);
  dynamicVisual.push({ kind: 'sphere', c, r, rgb: albToRgb(albedo) });
  dynamicEntries.push({ update(t) {
    const nc = animFn(t);
    c[0] = nc[0]; c[1] = nc[1]; c[2] = nc[2];
  }});
}

export function addAnimatedLight(initC, r, emission, lightRgb, animFn) {
  const c = initC.slice();
  const lt = { kind: 'sphere', c, r, emission };
  allLights.push(lt);
  dynamicEntries.push({ update(t) {
    const nc = animFn(t);
    c[0] = nc[0]; c[1] = nc[1]; c[2] = nc[2];
  }});
  dynamicVisual.push({ kind: 'light', c, r, rgb: lightRgb });
  return lt;
}

export function tickAnimation(t) {
  for (const e of dynamicEntries) e.update(t);
}
export function getDynamicVisuals() {
  return dynamicVisual;
}

// adiciona um quad light em runtime (sem afetar BVH — luzes ficam fora).
// p0..p3 em CCW vista do lado emissivo.
export function addRuntimeQuadLight(p0, p1, p2, p3, emission) {
  const u = sub(p1, p0);
  const v = sub(p3, p0);
  const c = cross(u, v);
  const area = Math.hypot(c[0], c[1], c[2]);
  const n = [c[0]/area, c[1]/area, c[2]/area];
  allLights.push({ kind: 'quad', p0, p1, p2, p3, n, area, emission });
}

// adiciona uma sphere light em runtime (sem afetar BVH).
export function addRuntimeSphereLight(c, r, emission) {
  allLights.push({ kind: 'sphere', c, r, emission });
}

// adiciona um quad em runtime (2 tris). Não reconstrói BVH — caller deve
// chamar rebuildRuntimeBVH() depois de batches.
export function addRuntimeQuad(p0, p1, p2, p3, albedo) {
  const mat = { kind: M_DIFFUSE, albedo };
  const e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
  const e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
  const n = norm(cross(e1, e2));
  allTris.push({ v0: p0, v1: p1, v2: p2, n, mat });
  allTris.push({ v0: p0, v1: p2, v2: p3, n, mat });
}
export function rebuildRuntimeBVH() { rebuildBVH(); }

// 6 faces do box, índices nos verts em ordem boxGeom (corner standard order)
const BOX_FACE_QUADS = [
  [0, 3, 2, 1], // -z
  [4, 5, 6, 7], // +z
  [0, 1, 5, 4], // -y
  [3, 7, 6, 2], // +y
  [0, 4, 7, 3], // -x
  [1, 2, 6, 5], // +x
];

// adiciona 12 tris (sem rebuild). Caller chama rebuildRuntimeBVH depois.
export function pushRuntimeBoxFromVerts(verts, albedo) {
  const mat = { kind: M_DIFFUSE, albedo };
  for (const [a, b, c, d] of BOX_FACE_QUADS) {
    const p0 = verts[a], p1 = verts[b], p2 = verts[c], p3 = verts[d];
    const e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
    const e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
    const n = norm(cross(e1, e2));
    allTris.push({ v0: p0, v1: p1, v2: p2, n, mat });
    allTris.push({ v0: p0, v1: p2, v2: p3, n, mat });
  }
}
// wrapper "add" rebuilda na hora (uso single-shot)
export function addRuntimeBoxFromVerts(verts, albedo) {
  pushRuntimeBoxFromVerts(verts, albedo);
  rebuildBVH();
}

// wrapper legacy: AABB box
export function addRuntimeBox(min, max, albedo) {
  const [x0,y0,z0] = min, [x1,y1,z1] = max;
  const verts = [
    [x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],
    [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],
  ];
  addRuntimeBoxFromVerts(verts, albedo);
}

// ---------- BVH (median-split, leaf size 4) ----------
let useBVH = true;
let bvhRoot = null;
export function setUseBVH(v) { useBVH = !!v; }
export function getBVHStats() {
  return { items: allTris.length + allSphs.length };
}

let countPrim = 0, countAABB = 0;
export function resetIntersectCounters() { countPrim = 0; countAABB = 0; }
export function getIntersectCounters() { return { prim: countPrim, aabb: countAABB }; }

function triBounds(t) {
  return {
    min: [
      Math.min(t.v0[0], t.v1[0], t.v2[0]),
      Math.min(t.v0[1], t.v1[1], t.v2[1]),
      Math.min(t.v0[2], t.v1[2], t.v2[2]),
    ],
    max: [
      Math.max(t.v0[0], t.v1[0], t.v2[0]),
      Math.max(t.v0[1], t.v1[1], t.v2[1]),
      Math.max(t.v0[2], t.v1[2], t.v2[2]),
    ],
  };
}
function sphBounds(s) {
  return {
    min: [s.c[0]-s.r, s.c[1]-s.r, s.c[2]-s.r],
    max: [s.c[0]+s.r, s.c[1]+s.r, s.c[2]+s.r],
  };
}

function buildBVH(items) {
  function build(items) {
    if (items.length <= 4) {
      const minB = [Infinity, Infinity, Infinity];
      const maxB = [-Infinity, -Infinity, -Infinity];
      for (const it of items) {
        for (let k = 0; k < 3; k++) {
          if (it.bounds.min[k] < minB[k]) minB[k] = it.bounds.min[k];
          if (it.bounds.max[k] > maxB[k]) maxB[k] = it.bounds.max[k];
        }
      }
      return { leaf: true, items, boundsMin: minB, boundsMax: maxB };
    }
    const minB = [Infinity, Infinity, Infinity];
    const maxB = [-Infinity, -Infinity, -Infinity];
    for (const it of items) {
      for (let k = 0; k < 3; k++) {
        if (it.bounds.min[k] < minB[k]) minB[k] = it.bounds.min[k];
        if (it.bounds.max[k] > maxB[k]) maxB[k] = it.bounds.max[k];
      }
    }
    const dx = maxB[0]-minB[0], dy = maxB[1]-minB[1], dz = maxB[2]-minB[2];
    const axis = dx > dy && dx > dz ? 0 : (dy > dz ? 1 : 2);
    items.sort((a, b) => {
      const ca = (a.bounds.min[axis] + a.bounds.max[axis]) * 0.5;
      const cb = (b.bounds.min[axis] + b.bounds.max[axis]) * 0.5;
      return ca - cb;
    });
    const mid = items.length >> 1;
    return {
      leaf: false,
      boundsMin: minB, boundsMax: maxB,
      left:  build(items.slice(0, mid)),
      right: build(items.slice(mid)),
    };
  }
  return build([...items]);
}

function rebuildBVH() {
  const items = [
    ...allTris.map(t => ({ kind: 0, data: t, bounds: triBounds(t) })),
    ...allSphs.map(s => ({ kind: 1, data: s, bounds: sphBounds(s) })),
  ];
  bvhRoot = items.length > 0 ? buildBVH(items) : null;
}

function intersectAABB(boxMin, boxMax, ro, invDx, invDy, invDz, tMaxLimit) {
  countAABB++;
  let t1 = (boxMin[0] - ro[0]) * invDx;
  let t2 = (boxMax[0] - ro[0]) * invDx;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (boxMin[1] - ro[1]) * invDy;
  t2 = (boxMax[1] - ro[1]) * invDy;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (boxMin[2] - ro[2]) * invDz;
  t2 = (boxMax[2] - ro[2]) * invDz;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  return tmax >= Math.max(0, tmin) && tmin < tMaxLimit;
}

function bvhClosest(node, ro, rd, invDx, invDy, invDz, hit) {
  if (!intersectAABB(node.boundsMin, node.boundsMax, ro, invDx, invDy, invDz, hit.t)) return;
  if (node.leaf) {
    for (const it of node.items) {
      if (it.kind === 0) {
        const t = intersectTri(it.data, ro, rd);
        if (t < hit.t) { hit.t = t; hit.mat = it.data.mat; hit.n = it.data.n; }
      } else {
        const s = it.data;
        const t = intersectSphere(s, ro, rd);
        if (t < hit.t) {
          hit.t = t;
          hit.mat = s.mat;
          const px = ro[0]+t*rd[0], py = ro[1]+t*rd[1], pz = ro[2]+t*rd[2];
          hit.n = norm([px - s.c[0], py - s.c[1], pz - s.c[2]]);
        }
      }
    }
    return;
  }
  bvhClosest(node.left,  ro, rd, invDx, invDy, invDz, hit);
  bvhClosest(node.right, ro, rd, invDx, invDy, invDz, hit);
}

function bvhAnyHit(node, ro, rd, invDx, invDy, invDz, maxT) {
  if (!intersectAABB(node.boundsMin, node.boundsMax, ro, invDx, invDy, invDz, maxT)) return false;
  if (node.leaf) {
    for (const it of node.items) {
      const t = it.kind === 0
        ? intersectTri(it.data, ro, rd)
        : intersectSphere(it.data, ro, rd);
      if (t < maxT) return true;
    }
    return false;
  }
  if (bvhAnyHit(node.left,  ro, rd, invDx, invDy, invDz, maxT)) return true;
  if (bvhAnyHit(node.right, ro, rd, invDx, invDy, invDz, maxT)) return true;
  return false;
}

// ---------- active room (só pra HUD/info) ----------
export function setActiveRoomByPos(pos) {
  if (!rooms.length) return null;
  for (const r of rooms) {
    const { min, max } = r.bounds;
    if (pos[0] >= min[0] && pos[0] <= max[0] &&
        pos[1] >= min[1] && pos[1] <= max[1] &&
        pos[2] >= min[2] && pos[2] <= max[2]) {
      activeRoom = r;
      return r.id;
    }
  }
  return activeRoom?.id ?? null;
}

export function getActiveRoomId() { return activeRoom?.id ?? null; }
export function getActiveRoomBounds() { return activeRoom?.bounds ?? null; }

// ---------- interseção ----------
function intersectTri(tri, ro, rd) {
  countPrim++;
  const v0 = tri.v0;
  const e1x = tri.v1[0]-v0[0], e1y = tri.v1[1]-v0[1], e1z = tri.v1[2]-v0[2];
  const e2x = tri.v2[0]-v0[0], e2y = tri.v2[1]-v0[1], e2z = tri.v2[2]-v0[2];
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

function intersectSphere(s, ro, rd) {
  countPrim++;
  const ocx = ro[0]-s.c[0], ocy = ro[1]-s.c[1], ocz = ro[2]-s.c[2];
  const b = ocx*rd[0] + ocy*rd[1] + ocz*rd[2];
  const c = ocx*ocx + ocy*ocy + ocz*ocz - s.r*s.r;
  const disc = b*b - c;
  if (disc < 0) return Infinity;
  const sd = Math.sqrt(disc);
  let t = -b - sd;
  if (t < 1e-4) t = -b + sd;
  return t > 1e-4 ? t : Infinity;
}

function intersectScene(ro, rd) {
  const hit = { t: Infinity, mat: null, n: null };
  if (useBVH && bvhRoot) {
    bvhClosest(bvhRoot, ro, rd, 1/rd[0], 1/rd[1], 1/rd[2], hit);
  } else {
    for (let i = 0; i < allTris.length; i++) {
      const t = intersectTri(allTris[i], ro, rd);
      if (t < hit.t) { hit.t = t; hit.mat = allTris[i].mat; hit.n = allTris[i].n; }
    }
    for (let i = 0; i < allSphs.length; i++) {
      const s = allSphs[i];
      const t = intersectSphere(s, ro, rd);
      if (t < hit.t) {
        hit.t = t;
        hit.mat = s.mat;
        const px = ro[0]+t*rd[0], py = ro[1]+t*rd[1], pz = ro[2]+t*rd[2];
        hit.n = norm([px - s.c[0], py - s.c[1], pz - s.c[2]]);
      }
    }
  }
  for (let i = 0; i < dynamicSphs.length; i++) {
    const s = dynamicSphs[i];
    const t = intersectSphere(s, ro, rd);
    if (t < hit.t) {
      hit.t = t;
      hit.mat = s.mat;
      const px = ro[0]+t*rd[0], py = ro[1]+t*rd[1], pz = ro[2]+t*rd[2];
      hit.n = norm([px - s.c[0], py - s.c[1], pz - s.c[2]]);
    }
  }
  for (let i = 0; i < allLights.length; i++) {
    const lt = allLights[i];
    let t;
    if (lt.kind === 'quad') {
      const t1 = intersectTri({ v0: lt.p0, v1: lt.p1, v2: lt.p2 }, ro, rd);
      const t2 = intersectTri({ v0: lt.p0, v1: lt.p2, v2: lt.p3 }, ro, rd);
      t = Math.min(t1, t2);
    } else {
      t = intersectSphere(lt, ro, rd);
    }
    if (t < hit.t) {
      hit.t = t;
      hit.mat = { kind: M_LIGHT, emission: lt.emission };
      if (lt.kind === 'quad') {
        hit.n = lt.n;
      } else {
        const px = ro[0]+t*rd[0], py = ro[1]+t*rd[1], pz = ro[2]+t*rd[2];
        hit.n = norm([px - lt.c[0], py - lt.c[1], pz - lt.c[2]]);
      }
    }
  }
  return hit;
}

function occluded(ro, rd, maxT) {
  if (useBVH && bvhRoot) {
    if (bvhAnyHit(bvhRoot, ro, rd, 1/rd[0], 1/rd[1], 1/rd[2], maxT)) return true;
  } else {
    for (let i = 0; i < allTris.length; i++) {
      if (intersectTri(allTris[i], ro, rd) < maxT) return true;
    }
    for (let i = 0; i < allSphs.length; i++) {
      if (intersectSphere(allSphs[i], ro, rd) < maxT) return true;
    }
  }
  for (let i = 0; i < dynamicSphs.length; i++) {
    if (intersectSphere(dynamicSphs[i], ro, rd) < maxT) return true;
  }
  return false;
}

// ---------- sampling ----------
function sampleCosineHemisphere(n) {
  const r1 = Math.random();
  const r2 = Math.random();
  const phi = 2 * Math.PI * r1;
  const sinTheta = Math.sqrt(r2);
  const cosTheta = Math.sqrt(1 - r2);
  const lx = sinTheta * Math.cos(phi);
  const ly = sinTheta * Math.sin(phi);
  const lz = cosTheta;
  const up = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const tx = norm(cross(up, n));
  const ty = cross(n, tx);
  return [
    tx[0]*lx + ty[0]*ly + n[0]*lz,
    tx[1]*lx + ty[1]*ly + n[1]*lz,
    tx[2]*lx + ty[2]*ly + n[2]*lz,
  ];
}

// ---------- direct lighting (NEE) ----------
function directLight(p, n, albedo) {
  if (!allLights.length) return [0,0,0];
  const lt = allLights[(Math.random() * allLights.length) | 0];
  let lpx, lpy, lpz, lightArea, lnx, lny, lnz;
  if (lt.kind === 'quad') {
    const u = Math.random(), v = Math.random();
    lpx = lt.p0[0] + u*(lt.p1[0]-lt.p0[0]) + v*(lt.p3[0]-lt.p0[0]);
    lpy = lt.p0[1] + u*(lt.p1[1]-lt.p0[1]) + v*(lt.p3[1]-lt.p0[1]);
    lpz = lt.p0[2] + u*(lt.p1[2]-lt.p0[2]) + v*(lt.p3[2]-lt.p0[2]);
    lightArea = lt.area;
    lnx = lt.n[0]; lny = lt.n[1]; lnz = lt.n[2];
  } else {
    const u1 = Math.random(), u2 = Math.random();
    const z = 1 - 2 * u1;
    const r = Math.sqrt(Math.max(0, 1 - z*z));
    const phi = 2 * Math.PI * u2;
    lnx = r * Math.cos(phi); lny = z; lnz = r * Math.sin(phi);
    lpx = lt.c[0] + lt.r * lnx;
    lpy = lt.c[1] + lt.r * lny;
    lpz = lt.c[2] + lt.r * lnz;
    lightArea = 4 * Math.PI * lt.r * lt.r;
  }
  const dx = lpx - p[0], dy = lpy - p[1], dz = lpz - p[2];
  const distSq = dx*dx + dy*dy + dz*dz;
  const dist = Math.sqrt(distSq);
  const wx = dx/dist, wy = dy/dist, wz = dz/dist;
  const cosSurf = n[0]*wx + n[1]*wy + n[2]*wz;
  if (cosSurf <= 0) return [0,0,0];
  const cosLight = -(lnx*wx + lny*wy + lnz*wz);
  if (cosLight <= 0) return [0,0,0];
  if (occluded(p, [wx,wy,wz], dist - 1e-3)) return [0,0,0];
  const factor = (lightArea * cosSurf * cosLight * allLights.length) / (Math.PI * distSq);
  return [
    albedo[0] * lt.emission[0] * factor,
    albedo[1] * lt.emission[1] * factor,
    albedo[2] * lt.emission[2] * factor,
  ];
}

// ---------- path tracer ----------
const MAX_DEPTH = 6;
function trace(ro, rd, depth, includeEmission) {
  if (depth >= MAX_DEPTH) return [0,0,0];
  const { t, mat, n: rawN } = intersectScene(ro, rd);
  if (!mat) return [0,0,0];
  if (mat.kind === M_LIGHT) return includeEmission ? mat.emission : [0,0,0];
  const hp = [ro[0]+t*rd[0], ro[1]+t*rd[1], ro[2]+t*rd[2]];
  let n = rawN;
  if (dot(n, rd) > 0) n = [-n[0], -n[1], -n[2]];
  const eps = 1e-4;
  const start = [hp[0]+n[0]*eps, hp[1]+n[1]*eps, hp[2]+n[2]*eps];
  const direct = directLight(start, n, mat.albedo);
  const dir = sampleCosineHemisphere(n);
  const inc = trace(start, dir, depth + 1, false);
  return [
    direct[0] + mat.albedo[0]*inc[0],
    direct[1] + mat.albedo[1]*inc[1],
    direct[2] + mat.albedo[2]*inc[2],
  ];
}

let pt = null;
export function startPathTracer({ canvas, ctx, sampleEl, camera, onTick }) {
  if (pt) return;
  const W = canvas.width, H = canvas.height;
  pt = {
    canvas, ctx, sampleEl, onTick, W, H, aspect: W/H,
    imageData: ctx.createImageData(W, H),
    accum: new Float32Array(W*H*3),
    curRow: 0, samples: 0,
    pos: camera.pos.slice(), fwd: camera.fwd.slice(),
    right: camera.right.slice(), up: camera.up.slice(),
    tanFov: Math.tan(camera.fov/2), rafId: 0,
  };
  pt.pixelData = pt.imageData.data;
  function loop() {
    if (!pt) return;
    if (pt.onTick) pt.onTick();
    const start = performance.now();
    while (performance.now() - start < 30) {
      ptRenderRow(pt.curRow);
      pt.curRow++;
      if (pt.curRow >= pt.H) { pt.curRow = 0; pt.samples++; }
    }
    ptDisplay();
    if (pt.sampleEl) pt.sampleEl.textContent = pt.samples;
    pt.rafId = requestAnimationFrame(loop);
  }
  pt.rafId = requestAnimationFrame(loop);
}
export function stopPathTracer() {
  if (!pt) return;
  cancelAnimationFrame(pt.rafId);
  pt = null;
}
export function setPathTracerCamera(camera) {
  if (!pt) return;
  pt.pos = camera.pos.slice();
  pt.fwd = camera.fwd.slice();
  pt.right = camera.right.slice();
  pt.up = camera.up.slice();
  pt.tanFov = Math.tan(camera.fov/2);
  pt.accum.fill(0); pt.curRow = 0; pt.samples = 0;
}
function ptRenderRow(y) {
  const { W, H, aspect, tanFov, fwd, right, up, pos, accum } = pt;
  for (let x = 0; x < W; x++) {
    const jx = Math.random(), jy = Math.random();
    const u = (2*(x+jx)/W - 1) * aspect * tanFov;
    const v = (1 - 2*(y+jy)/H) * tanFov;
    const dir = norm([
      fwd[0] + u*right[0] + v*up[0],
      fwd[1] + u*right[1] + v*up[1],
      fwd[2] + u*right[2] + v*up[2],
    ]);
    const c = trace(pos, dir, 0, true);
    const i = (y*W + x)*3;
    accum[i] += c[0]; accum[i+1] += c[1]; accum[i+2] += c[2];
  }
}
function ptDisplay() {
  const { W, H, samples, curRow, accum, pixelData, ctx, imageData } = pt;
  for (let y = 0; y < H; y++) {
    const div = samples + (y < curRow ? 1 : 0);
    if (div === 0) continue;
    const inv = 1/div;
    for (let x = 0; x < W; x++) {
      const i = y*W + x, a = i*3;
      let r = accum[a]*inv, g = accum[a+1]*inv, b = accum[a+2]*inv;
      r = Math.sqrt(r/(1+r));
      g = Math.sqrt(g/(1+g));
      b = Math.sqrt(b/(1+b));
      const j = i*4;
      pixelData[j] = r*255; pixelData[j+1] = g*255; pixelData[j+2] = b*255; pixelData[j+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ---------- traçar caminho de fóton (lighttrace) ----------
export function tracePhotonPath(maxBounces = 4, emissionVar = 0, applyDecay = false) {
  const points = [];
  const colors = [];
  const intensities = [];
  if (!allLights.length) return { points, colors, intensities };
  const lt = allLights[(Math.random() * allLights.length) | 0];
  const me = Math.max(lt.emission[0], lt.emission[1], lt.emission[2]);
  const lightColor = [lt.emission[0]/me, lt.emission[1]/me, lt.emission[2]/me];

  let pos, sampleN;
  if (lt.kind === 'quad') {
    const u = Math.random(), v = Math.random();
    pos = [
      lt.p0[0] + u*(lt.p1[0]-lt.p0[0]) + v*(lt.p3[0]-lt.p0[0]),
      lt.p0[1] + u*(lt.p1[1]-lt.p0[1]) + v*(lt.p3[1]-lt.p0[1]),
      lt.p0[2] + u*(lt.p1[2]-lt.p0[2]) + v*(lt.p3[2]-lt.p0[2]),
    ];
    sampleN = lt.n;
  } else {
    const u1 = Math.random(), u2 = Math.random();
    const z = 1 - 2*u1;
    const rr = Math.sqrt(Math.max(0, 1 - z*z));
    const phi = 2*Math.PI*u2;
    sampleN = [rr*Math.cos(phi), z, rr*Math.sin(phi)];
    pos = [lt.c[0]+lt.r*sampleN[0], lt.c[1]+lt.r*sampleN[1], lt.c[2]+lt.r*sampleN[2]];
  }
  let dir = sampleCosineHemisphere(sampleN);
  let energy = 1.0;
  if (emissionVar > 0) {
    energy = 1 + (Math.random()*2 - 1) * emissionVar;
    if (energy < 0) energy = 0;
  }
  points.push(pos); colors.push(lightColor); intensities.push(energy);
  for (let b = 0; b < maxBounces; b++) {
    const { t, mat, n: rawN } = intersectScene(pos, dir);
    if (!mat) break;
    const hp = [pos[0]+t*dir[0], pos[1]+t*dir[1], pos[2]+t*dir[2]];
    if (mat.kind === M_LIGHT) {
      points.push(hp); colors.push(lightColor); intensities.push(energy);
      break;
    }
    if (applyDecay) energy *= (mat.albedo[0] + mat.albedo[1] + mat.albedo[2]) / 3;
    points.push(hp); colors.push(mat.albedo); intensities.push(energy);
    let n = rawN;
    if (dot(n, dir) > 0) n = [-n[0], -n[1], -n[2]];
    const eps = 1e-4;
    pos = [hp[0]+n[0]*eps, hp[1]+n[1]*eps, hp[2]+n[2]*eps];
    dir = sampleCosineHemisphere(n);
  }
  return { points, colors, intensities };
}
