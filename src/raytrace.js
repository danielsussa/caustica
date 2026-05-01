// ======================================================
// Path tracer Monte Carlo, render progressivo.
// Cena: cubo + chão + parede de fundo + parede esquerda
// (mesma do rasterizador). Iluminação: sky emission —
// raios que escapam pegam cor do "céu" + spot do "sol".
// Exporta start / stop pro main.js orquestrar.
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

const matCube  = { kind: M_DIFFUSE, albedo: [120/255, 170/255, 240/255] };
const matFloor = { kind: M_DIFFUSE, albedo: [ 80/255, 180/255, 130/255] };
const matBack  = { kind: M_DIFFUSE, albedo: [200/255,  90/255,  90/255] };
const matLeft  = { kind: M_DIFFUSE, albedo: [200/255, 200/255,  80/255] };
const matLight = { kind: M_LIGHT,   emission: [40, 36, 28] };

// ---------- cena ----------
const tris = [];

// luz: esfera emissiva acima da cena (visível como lâmpada)
export const lightSphere = { c: [0.5, 3.5, 0.3], r: 0.25 };
const lightArea = 4 * Math.PI * lightSphere.r * lightSphere.r;

function addQuad(p0, p1, p2, p3, mat) {
  const n = norm(cross(sub(p1, p0), sub(p2, p0)));
  tris.push({ v0: p0, v1: p1, v2: p2, n, mat });
  tris.push({ v0: p0, v1: p2, v2: p3, n, mat });
}

function addBox(min, max, mat) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  addQuad([x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0], mat); // -z
  addQuad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], mat); // +z
  addQuad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1], mat); // -y
  addQuad([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0], mat); // +y
  addQuad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], mat); // -x
  addQuad([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1], mat); // +x
}

addQuad([-3,-1,-3],[ 3,-1,-3],[ 3,-1, 2],[-3,-1, 2], matFloor);
addQuad([-3,-1,-3],[ 3,-1,-3],[ 3, 3,-3],[-3, 3,-3], matBack);
addQuad([-3,-1,-3],[-3,-1, 2],[-3, 3, 2],[-3, 3,-3], matLeft);
addBox([-1,-1,-1], [1, 1, 1], matCube);

// ---------- interseção (Möller–Trumbore) ----------
function intersectTri(tri, ro, rd) {
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
  let tMin = Infinity;
  let mat = null;
  let n = null;
  for (let i = 0; i < tris.length; i++) {
    const t = intersectTri(tris[i], ro, rd);
    if (t < tMin) { tMin = t; mat = tris[i].mat; n = tris[i].n; }
  }
  const tL = intersectSphere(lightSphere, ro, rd);
  if (tL < tMin) {
    tMin = tL;
    mat = matLight;
    const px = ro[0] + tL*rd[0], py = ro[1] + tL*rd[1], pz = ro[2] + tL*rd[2];
    n = norm([px - lightSphere.c[0], py - lightSphere.c[1], pz - lightSphere.c[2]]);
  }
  return { t: tMin, mat, n };
}

// shadow ray: só testa triângulos opacos (ignora a esfera de luz)
function occluded(ro, rd, maxT) {
  for (let i = 0; i < tris.length; i++) {
    const t = intersectTri(tris[i], ro, rd);
    if (t < maxT) return true;
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

// ---------- iluminação direta (Next Event Estimation) ----------
// A cada bounce difusa, sorteamos um ponto na esfera de luz, testamos
// visibilidade com shadow ray, e somamos a contribuição. Sem isso, com
// fundo preto e luz pequena, a chance de uma bounce aleatória achar a
// luz é mínima — convergência levaria horas.
function directLight(p, n, albedo) {
  // ponto uniforme na superfície da esfera
  const u1 = Math.random();
  const u2 = Math.random();
  const z = 1 - 2 * u1;
  const r = Math.sqrt(Math.max(0, 1 - z*z));
  const phi = 2 * Math.PI * u2;
  const lnx = r * Math.cos(phi), lny = z, lnz = r * Math.sin(phi);
  const lpx = lightSphere.c[0] + lightSphere.r * lnx;
  const lpy = lightSphere.c[1] + lightSphere.r * lny;
  const lpz = lightSphere.c[2] + lightSphere.r * lnz;

  const dx = lpx - p[0], dy = lpy - p[1], dz = lpz - p[2];
  const distSq = dx*dx + dy*dy + dz*dz;
  const dist = Math.sqrt(distSq);
  const wx = dx / dist, wy = dy / dist, wz = dz / dist;

  const cosSurf = n[0]*wx + n[1]*wy + n[2]*wz;
  if (cosSurf <= 0) return [0, 0, 0];
  const cosLight = -(lnx*wx + lny*wy + lnz*wz);
  if (cosLight <= 0) return [0, 0, 0]; // ponto está no lado oculto da esfera

  if (occluded(p, [wx, wy, wz], dist - 1e-3)) return [0, 0, 0];

  // estimador MC: Le * BRDF * cos_x * cos_y * area / dist²
  // BRDF lambertiano = albedo / π
  const factor = (lightArea * cosSurf * cosLight) / (Math.PI * distSq);
  const Le = matLight.emission;
  return [
    albedo[0] * Le[0] * factor,
    albedo[1] * Le[1] * factor,
    albedo[2] * Le[2] * factor,
  ];
}

// ---------- path tracer ----------
const MAX_DEPTH = 6;

// includeEmission: true só quando o raio veio direto da câmera (ou bounce
// especular). Em raios que vieram de bounce difusa, NEE já contou a luz,
// então retornar emission aqui causaria contagem dupla.
function trace(ro, rd, depth, includeEmission) {
  if (depth >= MAX_DEPTH) return [0, 0, 0];

  const { t, mat, n: rawN } = intersectScene(ro, rd);
  if (!mat) return [0, 0, 0]; // fundo preto

  if (mat.kind === M_LIGHT) {
    return includeEmission ? mat.emission : [0, 0, 0];
  }

  const hp = [ro[0] + t*rd[0], ro[1] + t*rd[1], ro[2] + t*rd[2]];
  let n = rawN;
  if (dot(n, rd) > 0) n = [-n[0], -n[1], -n[2]];
  const eps = 1e-4;
  const start = [hp[0] + n[0]*eps, hp[1] + n[1]*eps, hp[2] + n[2]*eps];

  const direct = directLight(start, n, mat.albedo);

  const dir = sampleCosineHemisphere(n);
  const inc = trace(start, dir, depth + 1, false);
  return [
    direct[0] + mat.albedo[0] * inc[0],
    direct[1] + mat.albedo[1] * inc[1],
    direct[2] + mat.albedo[2] * inc[2],
  ];
}

// ---------- runtime: start / stop ----------
let rafId = 0;
let running = false;

export function startPathTracer({ canvas, ctx, sampleEl, camera }) {
  if (running) return;
  running = true;

  const W = canvas.width;
  const H = canvas.height;
  const aspect = W / H;
  const imageData = ctx.createImageData(W, H);
  const pixelData = imageData.data;
  const accum = new Float32Array(W * H * 3);
  let curRow = 0;
  let samples = 0;

  const { pos, fwd, right, up, fov } = camera;
  const tanFov = Math.tan(fov / 2);

  function renderRow(y) {
    for (let x = 0; x < W; x++) {
      const jx = Math.random();
      const jy = Math.random();
      const u = (2 * (x + jx) / W - 1) * aspect * tanFov;
      const v = (1 - 2 * (y + jy) / H) * tanFov;
      const dir = norm([
        fwd[0] + u*right[0] + v*up[0],
        fwd[1] + u*right[1] + v*up[1],
        fwd[2] + u*right[2] + v*up[2],
      ]);
      const c = trace(pos, dir, 0, true);
      const i = (y * W + x) * 3;
      accum[i+0] += c[0];
      accum[i+1] += c[1];
      accum[i+2] += c[2];
    }
  }

  function display() {
    for (let y = 0; y < H; y++) {
      const div = samples + (y < curRow ? 1 : 0);
      if (div === 0) continue;
      const inv = 1 / div;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const a = i * 3;
        let r = accum[a]   * inv;
        let g = accum[a+1] * inv;
        let b = accum[a+2] * inv;
        r = Math.sqrt(r / (1 + r));
        g = Math.sqrt(g / (1 + g));
        b = Math.sqrt(b / (1 + b));
        const j = i * 4;
        pixelData[j]   = r * 255;
        pixelData[j+1] = g * 255;
        pixelData[j+2] = b * 255;
        pixelData[j+3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const FRAME_BUDGET_MS = 30;
  function frame() {
    if (!running) return;
    const start = performance.now();
    while (performance.now() - start < FRAME_BUDGET_MS) {
      renderRow(curRow);
      curRow++;
      if (curRow >= H) {
        curRow = 0;
        samples++;
      }
    }
    display();
    if (sampleEl) sampleEl.textContent = samples;
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

export function stopPathTracer() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}
