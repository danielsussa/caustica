import { D, newRoom, rmAddQuad, rmAddBox, rmAddQuadLight } from '../_lib/builder.js';

function buildGallery() {
  // Sala 8m × 5m × 16m (z é comprimento)
  const room = newRoom('Gallery', [-4, 0, -8], [4, 5, 8]);

  // === paleta ===
  const matFloor1   = D([0.50, 0.36, 0.22]);
  const matFloor2   = D([0.58, 0.42, 0.28]);
  const matCeil     = D([0.92, 0.92, 0.86]);
  const matWall     = D([0.45, 0.10, 0.13]); // crimson
  const matWainscot = D([0.92, 0.88, 0.78]);
  const matFrameG   = D([0.78, 0.62, 0.25]); // ouro
  const matCanvas1  = D([0.30, 0.22, 0.16]);
  const matCanvas2  = D([0.55, 0.42, 0.30]);
  const matCanvas3  = D([0.45, 0.45, 0.50]);
  const matCanvas4  = D([0.65, 0.55, 0.45]);
  const matCanvas5  = D([0.40, 0.30, 0.25]);
  const matBench    = D([0.22, 0.13, 0.08]);
  const matTable    = D([0.28, 0.18, 0.10]);
  const matAltar    = D([0.92, 0.90, 0.85]);
  const matCrucifix = D([0.62, 0.50, 0.22]);
  const matStatue   = D([0.28, 0.22, 0.14]);
  const matTrim     = D([0.85, 0.83, 0.75]);

  // === chão parquet (1m × 2m, 8×8 = 64 placas, alternando 2 tons) ===
  for (let zi = 0; zi < 8; zi++) {
    for (let xi = 0; xi < 8; xi++) {
      const x0 = -4 + xi, x1 = x0 + 1;
      const z0 = -8 + zi*2, z1 = z0 + 2;
      const m = ((xi + zi) & 1) ? matFloor1 : matFloor2;
      rmAddQuad(room, [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], m);
    }
  }

  // === teto (4×8 panels com leve variação pra coffer feel) ===
  for (let zi = 0; zi < 8; zi++) {
    for (let xi = 0; xi < 4; xi++) {
      const x0 = -4 + xi*2, x1 = x0 + 2;
      const z0 = -8 + zi*2, z1 = z0 + 2;
      rmAddQuad(room, [x0, 5, z0], [x0, 5, z1], [x1, 5, z1], [x1, 5, z0], matCeil);
    }
  }

  // === paredes laterais (split em wainscoting + parte vermelha) ===
  // West (x=-4)
  rmAddQuad(room, [-4, 0, -8], [-4, 1, -8], [-4, 1, 8], [-4, 0, 8], matWainscot);
  rmAddQuad(room, [-4, 1, -8], [-4, 5, -8], [-4, 5, 8], [-4, 1, 8], matWall);
  // East (x=+4)
  rmAddQuad(room, [4, 0, -8], [4, 0, 8], [4, 1, 8], [4, 1, -8], matWainscot);
  rmAddQuad(room, [4, 1, -8], [4, 1, 8], [4, 5, 8], [4, 5, -8], matWall);
  // South (z=+8) - entrada
  rmAddQuad(room, [-4, 0, 8], [4, 0, 8], [4, 1, 8], [-4, 1, 8], matWainscot);
  rmAddQuad(room, [-4, 1, 8], [4, 1, 8], [4, 5, 8], [-4, 5, 8], matWall);

  // === parede de fundo (z=-8) com alcova ===
  rmAddQuad(room, [-4, 0, -8], [4, 0, -8], [4, 1, -8], [-4, 1, -8], matWainscot);
  rmAddQuad(room, [-4, 1, -8], [-1.2, 1, -8], [-1.2, 5, -8], [-4, 5, -8], matWall);
  rmAddQuad(room, [1.2, 1, -8], [4, 1, -8], [4, 5, -8], [1.2, 5, -8], matWall);
  rmAddQuad(room, [-1.2, 4, -8], [1.2, 4, -8], [1.2, 5, -8], [-1.2, 5, -8], matWall);
  // alcova interior (recesso até z=-9)
  rmAddQuad(room, [-1.2, 1, -9], [1.2, 1, -9], [1.2, 4, -9], [-1.2, 4, -9], matAltar);
  rmAddQuad(room, [-1.2, 1, -9], [-1.2, 4, -9], [-1.2, 4, -8], [-1.2, 1, -8], matAltar);
  rmAddQuad(room, [1.2, 1, -8], [1.2, 4, -8], [1.2, 4, -9], [1.2, 1, -9], matAltar);
  rmAddQuad(room, [-1.2, 4, -9], [-1.2, 4, -8], [1.2, 4, -8], [1.2, 4, -9], matAltar);
  rmAddQuad(room, [-1.2, 1, -9], [-1.2, 1, -8], [1.2, 1, -8], [1.2, 1, -9], matAltar);

  // === itens da alcova ===
  rmAddBox(room, [-1.0, 1.0, -8.9], [1.0, 1.4, -8.3], matAltar);
  rmAddBox(room, [-0.05, 1.4, -8.85], [0.05, 3.0, -8.75], matCrucifix);
  rmAddBox(room, [-0.4, 2.4, -8.85], [0.4, 2.55, -8.75], matCrucifix);
  rmAddBox(room, [-0.85, 1.4, -8.85], [-0.65, 1.7, -8.7], matAltar);
  rmAddBox(room, [0.65, 1.4, -8.85], [0.85, 1.7, -8.7], matAltar);
  rmAddBox(room, [-0.82, 1.7, -8.83], [-0.68, 2.5, -8.72], matStatue);
  rmAddBox(room, [0.68, 1.7, -8.83], [0.82, 2.5, -8.72], matStatue);
  rmAddBox(room, [-0.30, 1.4, -8.85], [-0.20, 1.6, -8.75], matCrucifix);
  rmAddBox(room, [0.20, 1.4, -8.85], [0.30, 1.6, -8.75], matCrucifix);

  // === pilastras (4 por parede lateral, no z = -6, -2, 2, 6) ===
  for (const z of [-6, -2, 2, 6]) {
    rmAddBox(room, [-4.0, 0, z - 0.15], [-3.85, 4.5, z + 0.15], matWainscot);
    rmAddBox(room, [3.85, 0, z - 0.15], [4.0, 4.5, z + 0.15], matWainscot);
  }

  // === quadros nas paredes laterais ===
  const westPaintings = [
    { z: -7, w: 1.4, h: 1.6, m: matCanvas1 },
    { z: -4, w: 2.0, h: 2.2, m: matCanvas2 },
    { z:  0, w: 1.8, h: 2.0, m: matCanvas3 },
    { z:  4, w: 1.5, h: 1.8, m: matCanvas4 },
    { z:  7, w: 1.4, h: 1.6, m: matCanvas5 },
  ];
  for (const p of westPaintings) {
    const yc = 2.6, hw = p.w * 0.5, hh = p.h * 0.5;
    rmAddBox(room, [-3.95, yc - hh, p.z - hw], [-3.85, yc + hh, p.z + hw], matFrameG);
    rmAddBox(room, [-3.91, yc - hh + 0.12, p.z - hw + 0.12],
                   [-3.83, yc + hh - 0.12, p.z + hw - 0.12], p.m);
  }
  const eastPaintings = [
    { z: -7, w: 1.4, h: 1.6, m: matCanvas2 },
    { z: -4, w: 1.6, h: 1.9, m: matCanvas3 },
    { z:  0, w: 1.8, h: 2.0, m: matCanvas4 },
    { z:  4, w: 2.0, h: 2.2, m: matCanvas5 },
    { z:  7, w: 1.5, h: 1.7, m: matCanvas1 },
  ];
  for (const p of eastPaintings) {
    const yc = 2.6, hw = p.w * 0.5, hh = p.h * 0.5;
    rmAddBox(room, [3.85, yc - hh, p.z - hw], [3.95, yc + hh, p.z + hw], matFrameG);
    rmAddBox(room, [3.83, yc - hh + 0.12, p.z - hw + 0.12],
                   [3.91, yc + hh - 0.12, p.z + hw - 0.12], p.m);
  }

  // === bancos (2: centro + sul) ===
  for (const bz of [0, 5]) {
    rmAddBox(room, [-0.75, 0.4, bz - 0.3], [0.75, 0.45, bz + 0.3], matBench);
    rmAddBox(room, [-0.7, 0, bz - 0.25], [-0.6, 0.4, bz - 0.15], matBench);
    rmAddBox(room, [0.6, 0, bz - 0.25], [0.7, 0.4, bz - 0.15], matBench);
    rmAddBox(room, [-0.7, 0, bz + 0.15], [-0.6, 0.4, bz + 0.25], matBench);
    rmAddBox(room, [0.6, 0, bz + 0.15], [0.7, 0.4, bz + 0.25], matBench);
  }

  // === mesa pequena no canto sudoeste ===
  rmAddBox(room, [-3.5, 0.55, 5.4], [-2.5, 0.6, 6.1], matTable);
  rmAddBox(room, [-3.45, 0, 5.45], [-3.35, 0.55, 5.55], matTable);
  rmAddBox(room, [-2.65, 0, 5.45], [-2.55, 0.55, 5.55], matTable);
  rmAddBox(room, [-3.45, 0, 5.95], [-3.35, 0.55, 6.05], matTable);
  rmAddBox(room, [-2.65, 0, 5.95], [-2.55, 0.55, 6.05], matTable);

  // === trim ===
  rmAddBox(room, [-4.0, 0.95, -8], [-3.95, 1.05, 8], matTrim);
  rmAddBox(room, [3.95, 0.95, -8], [4.0, 1.05, 8], matTrim);
  rmAddBox(room, [-4, 0.95, -8], [4, 1.05, -7.95], matTrim);
  rmAddBox(room, [-4, 0.95, 7.95], [4, 1.05, 8], matTrim);
  rmAddBox(room, [-4.0, 4.5, -8], [-3.7, 4.7, 8], matTrim);
  rmAddBox(room, [3.7, 4.5, -8], [4.0, 4.7, 8], matTrim);
  rmAddBox(room, [-4, 4.5, -8], [4, 4.7, -7.7], matTrim);
  rmAddBox(room, [-4, 4.5, 7.7], [4, 4.7, 8], matTrim);

  // === luzes ===
  rmAddQuadLight(room,
    [-3.7, 4.85, -7.5], [-3.95, 4.85, -7.5],
    [-3.95, 4.85,  7.5], [-3.7, 4.85,  7.5],
    [22, 18, 12], [255, 230, 180],
  );
  rmAddQuadLight(room,
    [3.95, 4.85, -7.5], [3.7, 4.85, -7.5],
    [3.7, 4.85,  7.5], [3.95, 4.85,  7.5],
    [22, 18, 12], [255, 230, 180],
  );
  rmAddQuadLight(room,
    [ 0.9, 1.41, -8.7], [-0.9, 1.41, -8.7],
    [-0.9, 1.41, -8.4], [ 0.9, 1.41, -8.4],
    [38, 28, 16], [255, 220, 150],
  );

  return room;
}

export function buildScene() {
  return {
    id: 'gallery',
    rooms: [buildGallery()],
    portals: [],
  };
}
