// ======================================================
// Path tracer + photon tracing com room culling.
// Mundo: 3 cômodos numa fileira ligados por portas.
//   Sala A (oeste, vermelha) — corredor B (centro) — Sala C (leste, azul)
// Cada cômodo tem suas paredes/objetos/luz isolados. setActiveRoomByPos()
// detecta em qual cômodo a câmera está e os intersect/photon usam só
// aquele subset. Cômodos ocultos custam zero.
//
// Path tracer existe mas o main.js desabilitou R por enquanto.
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

// ---------- materiais ----------
const M_DIFFUSE = 0;
const M_LIGHT   = 1;
const D = albedo  => ({ kind: M_DIFFUSE, albedo });
const L = emission => ({ kind: M_LIGHT,   emission });

// paletas por cômodo
const matsA = {
  floor:   D([0.55, 0.40, 0.32]), // marrom-madeira
  ceiling: D([0.85, 0.78, 0.70]), // creme
  wall:    D([0.60, 0.20, 0.18]), // vermelho escuro
  pillar:  D([0.85, 0.75, 0.40]), // amarelo
  sphere:  D([0.30, 0.50, 0.80]), // azul
};
const matsB = {
  floor:   D([0.55, 0.55, 0.55]), // cinza claro
  ceiling: D([0.85, 0.85, 0.85]), // branco
  wall:    D([0.70, 0.68, 0.62]), // bege neutro
  pedestal: D([0.85, 0.85, 0.85]),
  sphere:  D([0.30, 0.85, 0.85]), // ciano
};
const matsC = {
  floor:   D([0.30, 0.32, 0.38]), // cinza escuro
  ceiling: D([0.78, 0.82, 0.90]), // azul claro
  wall:    D([0.18, 0.28, 0.55]), // azul profundo
  table:   D([0.50, 0.35, 0.25]), // madeira
  sphere:  D([0.85, 0.45, 0.55]), // rosa
};

// ---------- helpers de geometria ----------
function pushQuad(tris, p0, p1, p2, p3, mat) {
  const n = norm(cross(sub(p1, p0), sub(p2, p0)));
  tris.push({ v0: p0, v1: p1, v2: p2, n, mat });
  tris.push({ v0: p0, v1: p2, v2: p3, n, mat });
}

function albToRgb(albedo) {
  return [Math.round(albedo[0]*255), Math.round(albedo[1]*255), Math.round(albedo[2]*255)];
}

// quad axis-aligned. Empurra tris pro path tracer e quad-record pra raster.
function addAAQuad(tris, vquads, axis, value, perpRange, yRange, mat) {
  const [pa, pb] = perpRange;
  const [ya, yb] = yRange;
  let p0, p1, p2, p3;
  if (axis === 'x') {
    p0 = [value,ya,pa]; p1 = [value,yb,pa]; p2 = [value,yb,pb]; p3 = [value,ya,pb];
  } else {
    p0 = [pa,ya,value]; p1 = [pa,yb,value]; p2 = [pb,yb,value]; p3 = [pb,ya,value];
  }
  pushQuad(tris, p0, p1, p2, p3, mat);
  if (vquads) vquads.push({ p0, p1, p2, p3, rgb: albToRgb(mat.albedo) });
}

// parede com (opcional) buraco de porta. door={perp:[a,b], y:[ya,yb]} ou null
function addWall(tris, vquads, axis, value, perpRange, yRange, door, mat) {
  if (!door) { addAAQuad(tris, vquads, axis, value, perpRange, yRange, mat); return; }
  const [pa, pb] = perpRange;
  const [ya, yb] = yRange;
  const [dpa, dpb] = door.perp;
  const [dya, dyb] = door.y;
  if (dpa > pa) addAAQuad(tris, vquads, axis, value, [pa, dpa], [ya, yb], mat);
  if (dpb < pb) addAAQuad(tris, vquads, axis, value, [dpb, pb], [ya, yb], mat);
  if (dyb < yb) addAAQuad(tris, vquads, axis, value, [dpa, dpb], [dyb, yb], mat);
  if (dya > ya) addAAQuad(tris, vquads, axis, value, [dpa, dpb], [ya, dya], mat);
}

function addBoxTris(tris, min, max, mat) {
  const [x0,y0,z0] = min, [x1,y1,z1] = max;
  pushQuad(tris, [x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0], mat);
  pushQuad(tris, [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], mat);
  pushQuad(tris, [x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1], mat);
  pushQuad(tris, [x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0], mat);
  pushQuad(tris, [x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], mat);
  pushQuad(tris, [x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1], mat);
}

// ---------- definição dos cômodos ----------
// Cada cômodo é um objeto auto-contido. tris/sphs/lights em world space.
// bounds são pra teste "câmera está aqui?". visual.* pra raster.

function buildRoom(id, min, max, doors, mats, objects, light, lightRgb) {
  const tris = [];
  const sphs = [];
  const vquads = [];
  const vboxes = [];
  const vsphs = [];
  // chão / teto (sem porta)
  addAAQuad(tris, vquads, 'z', undefined, [0,0],[0,0], mats.floor); // placeholder removido abaixo
  vquads.length = 0; tris.length = 0;
  // chão
  pushQuad(tris, [min[0],0,min[2]],[max[0],0,min[2]],[max[0],0,max[2]],[min[0],0,max[2]], mats.floor);
  vquads.push({ p0:[min[0],0,min[2]], p1:[max[0],0,min[2]], p2:[max[0],0,max[2]], p3:[min[0],0,max[2]], rgb: albToRgb(mats.floor.albedo) });
  // teto
  pushQuad(tris, [min[0],5,min[2]],[min[0],5,max[2]],[max[0],5,max[2]],[max[0],5,min[2]], mats.ceiling);
  vquads.push({ p0:[min[0],5,min[2]], p1:[min[0],5,max[2]], p2:[max[0],5,max[2]], p3:[max[0],5,min[2]], rgb: albToRgb(mats.ceiling.albedo) });
  // 4 paredes
  addWall(tris, vquads, 'x', min[0], [min[2], max[2]], [0, 5], doors.west,  mats.wall);
  addWall(tris, vquads, 'x', max[0], [min[2], max[2]], [0, 5], doors.east,  mats.wall);
  addWall(tris, vquads, 'z', min[2], [min[0], max[0]], [0, 5], doors.south, mats.wall);
  addWall(tris, vquads, 'z', max[2], [min[0], max[0]], [0, 5], doors.north, mats.wall);
  // objetos
  for (const obj of objects) {
    if (obj.kind === 'box') {
      addBoxTris(tris, obj.min, obj.max, obj.mat);
      vboxes.push({ min: obj.min.slice(), max: obj.max.slice(), rgb: albToRgb(obj.mat.albedo) });
    } else if (obj.kind === 'sphere') {
      sphs.push({ c: obj.c.slice(), r: obj.r, mat: obj.mat });
      vsphs.push({ c: obj.c.slice(), r: obj.r, rgb: albToRgb(obj.mat.albedo) });
    }
  }
  return {
    id, bounds: { min, max }, tris, sphs, lights: [light],
    visual: {
      quads: vquads, boxes: vboxes, spheres: vsphs,
      lights: [{ c: light.c.slice(), r: light.r, rgb: lightRgb }],
    },
  };
}

const DOOR = { perp: [-1, 1], y: [0, 2.5] };

const roomA = buildRoom('A', [-10, 0, -4], [-2, 5, 4],
  { east: DOOR, west: null, north: null, south: null }, matsA,
  [
    { kind: 'box',    min: [-8.5, 0, -3], max: [-8.0, 3.0, -2.5], mat: matsA.pillar },
    { kind: 'sphere', c: [-7, 0.7, 1.5], r: 0.7, mat: matsA.sphere },
  ],
  { c: [-6, 4.5, 0], r: 0.25, emission: [42, 32, 22] },
  [255, 220, 150],
);

const roomB = buildRoom('B', [-2, 0, -4], [2, 5, 4],
  { east: DOOR, west: DOOR, north: null, south: null }, matsB,
  [
    { kind: 'box',    min: [0.4, 0, 1.2], max: [1.6, 0.7, 2.4], mat: matsB.pedestal },
    { kind: 'sphere', c: [1.0, 1.15, 1.8], r: 0.45, mat: matsB.sphere },
  ],
  { c: [0, 4.5, -1], r: 0.22, emission: [38, 38, 36] },
  [240, 240, 230],
);

const roomC = buildRoom('C', [2, 0, -4], [10, 5, 4],
  { east: null, west: DOOR, north: null, south: null }, matsC,
  [
    { kind: 'box',    min: [4.5, 0, -2.5], max: [8.5, 0.5, 1], mat: matsC.table },
    { kind: 'sphere', c: [5.2, 0.85, -1.5], r: 0.35, mat: matsC.sphere },
    { kind: 'sphere', c: [6.5, 0.85,  0.0], r: 0.35, mat: matsC.sphere },
    { kind: 'sphere', c: [8.0, 0.85, -2.0], r: 0.35, mat: matsC.sphere },
  ],
  { c: [7, 4.5, 1.5], r: 0.25, emission: [22, 30, 42] },
  [180, 200, 255],
);

export const rooms = [roomA, roomB, roomC];

// arrays planos com tudo de todos os cômodos. Usados nos intersects pra
// permitir fótons atravessarem portas. Cômodos longe são naturalmente
// fog-culled durante a projeção.
const allTris = [];
const allSphs = [];
const allLights = [];
for (const r of rooms) {
  for (const t of r.tris)   allTris.push(t);
  for (const s of r.sphs)   allSphs.push(s);
  for (const l of r.lights) allLights.push(l);
}

// ---------- BVH (median-split, leaf size 4) ----------
// Acelera intersect de O(N) pra ~O(log N). Construído uma vez no load.
// Toggle exposto pra comparar performance brute vs BVH.
let useBVH = true;
export function setUseBVH(v) { useBVH = !!v; }
export function getBVHStats() {
  return { items: allTris.length + allSphs.length };
}

// contadores pra verificar BVH vs brute. Reset/get expostos pro main.js
// chamar uma vez por frame (depois da geração de fótons).
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

const bvhItems = [
  ...allTris.map(t => ({ kind: 0, data: t, bounds: triBounds(t) })),
  ...allSphs.map(s => ({ kind: 1, data: s, bounds: sphBounds(s) })),
];
const bvhRoot = buildBVH(bvhItems);

// Ray-AABB slab. Retorna true se intersecta E está mais perto que tMaxLimit.
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

// Closest hit: atualiza hit em-place
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

// Any hit (early exit) pra shadow rays
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

// ---------- active room (só pra HUD/info, não pra culling) ----------
let activeRoom = rooms[0];

export function setActiveRoomByPos(pos) {
  for (const r of rooms) {
    const { min, max } = r.bounds;
    if (pos[0] >= min[0] && pos[0] <= max[0] &&
        pos[1] >= min[1] && pos[1] <= max[1] &&
        pos[2] >= min[2] && pos[2] <= max[2]) {
      activeRoom = r;
      return r.id;
    }
  }
  return activeRoom.id;
}

export function getActiveRoomId() { return activeRoom.id; }

// ---------- interseção (apenas no cômodo ativo) ----------
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
  if (useBVH) {
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
  // luzes ficam fora do BVH (só ~3, brute é igual)
  for (let i = 0; i < allLights.length; i++) {
    const lt = allLights[i];
    const t = intersectSphere(lt, ro, rd);
    if (t < hit.t) {
      hit.t = t;
      hit.mat = { kind: M_LIGHT, emission: lt.emission };
      const px = ro[0]+t*rd[0], py = ro[1]+t*rd[1], pz = ro[2]+t*rd[2];
      hit.n = norm([px - lt.c[0], py - lt.c[1], pz - lt.c[2]]);
    }
  }
  return hit;
}

function occluded(ro, rd, maxT) {
  if (useBVH) {
    return bvhAnyHit(bvhRoot, ro, rd, 1/rd[0], 1/rd[1], 1/rd[2], maxT);
  }
  for (let i = 0; i < allTris.length; i++) {
    if (intersectTri(allTris[i], ro, rd) < maxT) return true;
  }
  for (let i = 0; i < allSphs.length; i++) {
    if (intersectSphere(allSphs[i], ro, rd) < maxT) return true;
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
// Sample uniforme entre todas as luzes do mundo (1/N pdf, compensa
// multiplicando contribuição por N).
function directLight(p, n, albedo) {
  const lt = allLights[(Math.random() * allLights.length) | 0];
  const lightArea = 4 * Math.PI * lt.r * lt.r;
  const u1 = Math.random();
  const u2 = Math.random();
  const z = 1 - 2 * u1;
  const r = Math.sqrt(Math.max(0, 1 - z*z));
  const phi = 2 * Math.PI * u2;
  const lnx = r * Math.cos(phi), lny = z, lnz = r * Math.sin(phi);
  const lpx = lt.c[0] + lt.r * lnx;
  const lpy = lt.c[1] + lt.r * lny;
  const lpz = lt.c[2] + lt.r * lnz;
  const dx = lpx - p[0], dy = lpy - p[1], dz = lpz - p[2];
  const distSq = dx*dx + dy*dy + dz*dz;
  const dist = Math.sqrt(distSq);
  const wx = dx/dist, wy = dy/dist, wz = dz/dist;
  const cosSurf = n[0]*wx + n[1]*wy + n[2]*wz;
  if (cosSurf <= 0) return [0,0,0];
  const cosLight = -(lnx*wx + lny*wy + lnz*wz);
  if (cosLight <= 0) return [0,0,0];
  if (occluded(p, [wx,wy,wz], dist - 1e-3)) return [0,0,0];
  // factor inclui N (allLights.length) pra compensar pdf 1/N de seleção uniforme
  const factor = (lightArea * cosSurf * cosLight * allLights.length) / (Math.PI * distSq);
  return [
    albedo[0] * lt.emission[0] * factor,
    albedo[1] * lt.emission[1] * factor,
    albedo[2] * lt.emission[2] * factor,
  ];
}

// ---------- path tracer (mantido mas main.js desabilitou R) ----------
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
// Retorna { points, colors, intensities }:
//   colors[i]      = cor do material no ponto i (0 = luz)
//   intensities[i] = energia restante deixando o ponto i.
//                    Inicial = 1 + (rand*2-1)*emissionVar (clamp >= 0)
//                    Se applyDecay, multiplica por mean(albedo) a cada bounce.
export function tracePhotonPath(maxBounces = 4, emissionVar = 0, applyDecay = false) {
  const points = [];
  const colors = [];
  const intensities = [];
  // sorteia uma luz uniformemente entre todas. Isso dispersa fótons de
  // todos os cômodos pelo buffer; cômodos longe são naturalmente fog-culled.
  const lt = allLights[(Math.random() * allLights.length) | 0];
  const me = Math.max(lt.emission[0], lt.emission[1], lt.emission[2]);
  const lightColor = [lt.emission[0]/me, lt.emission[1]/me, lt.emission[2]/me];

  const u1 = Math.random(), u2 = Math.random();
  const z = 1 - 2*u1;
  const rr = Math.sqrt(Math.max(0, 1 - z*z));
  const phi = 2*Math.PI*u2;
  const ln = [rr*Math.cos(phi), z, rr*Math.sin(phi)];
  let pos = [lt.c[0]+lt.r*ln[0], lt.c[1]+lt.r*ln[1], lt.c[2]+lt.r*ln[2]];
  let dir = sampleCosineHemisphere(ln);
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
