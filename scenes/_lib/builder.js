// Helpers de construção de cena. Apenas build-time (Node + dev),
// não entram no bundle runtime.

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [
  a[1]*b[2] - a[2]*b[1],
  a[2]*b[0] - a[0]*b[2],
  a[0]*b[1] - a[1]*b[0],
];
const norm = a => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0]/l, a[1]/l, a[2]/l];
};

export const M_DIFFUSE = 0;
export const M_LIGHT   = 1;
export const D = albedo  => ({ kind: M_DIFFUSE, albedo });
export const L = emission => ({ kind: M_LIGHT,   emission });

function albToRgb(albedo) {
  return [Math.round(albedo[0]*255), Math.round(albedo[1]*255), Math.round(albedo[2]*255)];
}

function pushQuad(tris, p0, p1, p2, p3, mat) {
  const n = norm(cross(sub(p1, p0), sub(p2, p0)));
  tris.push({ v0: p0, v1: p1, v2: p2, n, mat });
  tris.push({ v0: p0, v1: p2, v2: p3, n, mat });
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

export function newRoom(id, min, max) {
  return {
    id, bounds: { min, max },
    tris: [], sphs: [], lights: [],
    visual: { quads: [], boxes: [], spheres: [], lights: [] },
  };
}

export function rmAddQuad(room, p0, p1, p2, p3, mat) {
  pushQuad(room.tris, p0, p1, p2, p3, mat);
  room.visual.quads.push({ p0, p1, p2, p3, rgb: albToRgb(mat.albedo) });
}

export function rmAddBox(room, min, max, mat) {
  addBoxTris(room.tris, min, max, mat);
  room.visual.boxes.push({ min: min.slice(), max: max.slice(), rgb: albToRgb(mat.albedo) });
}

export function rmAddSph(room, c, r, mat) {
  room.sphs.push({ c, r, mat });
  room.visual.spheres.push({ c: c.slice(), r, rgb: albToRgb(mat.albedo) });
}

export function rmAddLight(room, c, r, emission, lightRgb) {
  room.lights.push({ kind: 'sphere', c, r, emission });
  room.visual.lights.push({ kind: 'sphere', c: c.slice(), r, rgb: lightRgb });
}

// quad light: p0..p3 em CCW vista do lado emissivo. Normal = cross(p1-p0, p3-p0)
export function rmAddQuadLight(room, p0, p1, p2, p3, emission, lightRgb) {
  const u = sub(p1, p0);
  const v = sub(p3, p0);
  const c = cross(u, v);
  const area = Math.hypot(c[0], c[1], c[2]);
  const n = [c[0]/area, c[1]/area, c[2]/area];
  room.lights.push({ kind: 'quad', p0, p1, p2, p3, n, area, emission });
  room.visual.lights.push({ kind: 'quad', p0, p1, p2, p3, rgb: lightRgb });
}
