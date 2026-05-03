// Great Enfilade do Winter Palace (Hermitage) — 5 salas em sequência,
// alinhadas ao longo de -z. Dimensões aproximadas (±10-30%).
//
// Ordem (do sul/entrada pro norte):
//   FieldMarshals → Petrovsky → Armorial → WarGallery1812 → StGeorge
//
// Cada sala é um box self-contained com chão/teto/paredes. Paredes entre
// salas adjacentes ficam duplicadas (uma por sala) com o mesmo buraco de
// porta — facilita streaming futuro (cada sala é independente).
import { D, newRoom, rmAddQuad, rmAddBox, rmAddWall, rmAddQuadLight } from '../_lib/builder.js';

// porta padrão: 3m largura × 5m altura, centrada
const DOOR = { perp: [-1.5, 1.5], y: [0, 5] };

// helper: light retangular no teto, virada pra baixo (-y)
function addCeilingLight(room, cx, cz, w, d, ceilY, emission, rgb) {
  const y = ceilY - 0.1;
  rmAddQuadLight(room,
    [cx-w/2, y, cz-d/2],
    [cx+w/2, y, cz-d/2],
    [cx+w/2, y, cz+d/2],
    [cx-w/2, y, cz+d/2],
    emission, rgb,
  );
}

// helper: paredes/chão/teto de uma sala-caixa retangular
function addShell(room, mats, doorPosZ, doorNegZ) {
  const { min, max } = room.bounds;
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  // chão (CCW olhando de cima → normal +y)
  rmAddQuad(room, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], mats.floor);
  // teto (CCW olhando de baixo → normal -y)
  rmAddQuad(room, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], mats.ceiling);
  // paredes laterais (x), sólidas
  rmAddWall(room, 'x', x0, [z0, z1], [y0, y1], null, mats.wall);
  rmAddWall(room, 'x', x1, [z0, z1], [y0, y1], null, mats.wall);
  // parede +z (sul) e -z (norte), porta opcional
  rmAddWall(room, 'z', z1, [x0, x1], [y0, y1], doorPosZ ? DOOR : null, mats.wall);
  rmAddWall(room, 'z', z0, [x0, x1], [y0, y1], doorNegZ ? DOOR : null, mats.wall);
}

// helper: fileira de "quadros" (frame dourado + canvas escuro) em uma parede.
// wallX: posição x da parede; side: 'east' (+x normal) ou 'west' (-x normal)
function addPaintingsXWall(room, wallX, side, zPositions, frameMat, canvasMat) {
  const inset = side === 'east' ? -0.08 : 0.08;
  const dx = side === 'east' ? -0.10 : 0.10;
  for (const { z, w, h, yc } of zPositions) {
    const hw = w/2, hh = h/2;
    // moldura: caixa fina rente à parede
    rmAddBox(room,
      [wallX + Math.min(0, dx), yc - hh, z - hw],
      [wallX + Math.max(0, dx), yc + hh, z + hw],
      frameMat);
    // canvas: caixa interna (0.12m menor de cada lado)
    rmAddBox(room,
      [wallX + Math.min(0, dx) + (side === 'east' ? 0.04 : 0), yc - hh + 0.12, z - hw + 0.12],
      [wallX + Math.max(0, dx) - (side === 'east' ? 0 : 0.04), yc + hh - 0.12, z + hw - 0.12],
      canvasMat);
  }
}

// ---------------- sala 1: Field Marshals' Hall ----------------
// Corredor de gala com retratos militares. Paredes brancas, frames dourados.
function buildFieldMarshals() {
  const room = newRoom('FieldMarshals', [-7.5, 0, -30], [7.5, 12, 0]);
  const mats = {
    floor:   D([0.55, 0.40, 0.25]),
    ceiling: D([0.92, 0.92, 0.86]),
    wall:    D([0.88, 0.85, 0.78]),
  };
  addShell(room, mats, false, true); // sem porta sul (entrada da escadaria), com porta norte
  // retratos nos lados (5 cada)
  const frame  = D([0.78, 0.62, 0.25]);
  const canvas = D([0.30, 0.22, 0.16]);
  const paintings = [-26, -20, -14, -8, -4].map(z => ({ z, w: 1.6, h: 2.2, yc: 4.5 }));
  addPaintingsXWall(room, -7.5, 'west', paintings, frame, canvas);
  addPaintingsXWall(room,  7.5, 'east', paintings, frame, canvas);
  // 2 lights no teto
  addCeilingLight(room, 0, -8,  6, 4, 12, [14, 11, 7], [255, 230, 180]);
  addCeilingLight(room, 0, -22, 6, 4, 12, [14, 11, 7], [255, 230, 180]);
  return room;
}

// ---------------- sala 2: Petrovsky (Small Throne Room) ----------------
// Pequena, paredes vermelhas profundas, trono na parede norte.
function buildPetrovsky() {
  const room = newRoom('PetrovskyHall', [-7, 0, -52], [7, 10, -30]);
  const mats = {
    floor:   D([0.45, 0.30, 0.18]),
    ceiling: D([0.92, 0.88, 0.78]),
    wall:    D([0.55, 0.10, 0.13]), // crimson profundo
  };
  addShell(room, mats, true, true);
  // trono na parede norte (z=-52), simbólico
  const matGold   = D([0.80, 0.65, 0.28]);
  const matFabric = D([0.55, 0.10, 0.10]);
  rmAddBox(room, [-1.5, 0, -51.5], [1.5, 0.4, -50.5], matGold);     // base
  rmAddBox(room, [-1.2, 0.4, -51.5], [1.2, 1.6, -51.0], matFabric); // assento
  rmAddBox(room, [-1.2, 1.6, -51.7], [1.2, 3.2, -51.5], matFabric); // encosto
  // 1 light central
  addCeilingLight(room, 0, -41, 5, 3, 10, [22, 18, 10], [255, 220, 150]);
  return room;
}

// ---------------- sala 3: Armorial Hall ----------------
// Gigante, colunas douradas, teto branco. ~50×25.
function buildArmorial() {
  const room = newRoom('ArmorialHall', [-12.5, 0, -102], [12.5, 13, -52]);
  const mats = {
    floor:   D([0.62, 0.48, 0.32]),
    ceiling: D([0.95, 0.94, 0.88]),
    wall:    D([0.92, 0.88, 0.74]), // creme claro
  };
  addShell(room, mats, true, true);
  const matCol = D([0.85, 0.70, 0.32]); // dourado
  // 2 fileiras de colunas (x=±9), 6 colunas cada ao longo de z
  for (const x of [-9, 9]) {
    for (const z of [-58, -66, -74, -82, -90, -98]) {
      rmAddBox(room, [x - 0.5, 0, z - 0.5], [x + 0.5, 11, z + 0.5], matCol);
    }
  }
  // 4 chandeliers (lights) em grid central
  for (const z of [-65, -77, -89, -97]) {
    addCeilingLight(room, 0, z, 4, 4, 13, [18, 15, 9], [255, 230, 180]);
  }
  return room;
}

// ---------------- sala 4: 1812 War Gallery ----------------
// Corredor longo (~55m), estreito (~12m), retratos cobrindo as paredes.
function buildWarGallery() {
  const room = newRoom('WarGallery1812', [-6, 0, -157], [6, 9, -102]);
  const mats = {
    floor:   D([0.40, 0.28, 0.18]),
    ceiling: D([0.90, 0.86, 0.74]),
    wall:    D([0.45, 0.18, 0.12]), // burgundy
  };
  addShell(room, mats, true, true);
  // ~12 retratos por parede (representação simplificada dos 332 originais)
  const frame  = D([0.78, 0.62, 0.25]);
  const canvas = D([0.20, 0.15, 0.12]);
  const paintings = [];
  for (let i = 0; i < 12; i++) {
    const z = -106 - i * 4.2;
    paintings.push({ z, w: 1.0, h: 1.5, yc: 4.0 });
  }
  addPaintingsXWall(room, -6, 'west', paintings, frame, canvas);
  addPaintingsXWall(room,  6, 'east', paintings, frame, canvas);
  // 3 lights ao longo do corredor
  addCeilingLight(room, 0, -114, 3, 3, 9, [16, 13, 8], [255, 220, 160]);
  addCeilingLight(room, 0, -130, 3, 3, 9, [16, 13, 8], [255, 220, 160]);
  addCeilingLight(room, 0, -146, 3, 3, 9, [16, 13, 8], [255, 220, 160]);
  return room;
}

// ---------------- sala 5: St. George's Hall (Great Throne Room) ----------------
// 800m² confirmado. Mármore branco, colunas mármore, trono a norte.
function buildStGeorge() {
  const room = newRoom('StGeorgeHall', [-10, 0, -197], [10, 14, -157]);
  const mats = {
    floor:   D([0.65, 0.55, 0.40]), // parquet claro
    ceiling: D([0.95, 0.95, 0.92]),
    wall:    D([0.90, 0.88, 0.80]),
  };
  addShell(room, mats, true, false);
  // colunas mármore (2 fileiras × 5)
  const matMarble = D([0.92, 0.90, 0.85]);
  for (const x of [-7, 7]) {
    for (const z of [-163, -171, -179, -187, -195]) {
      rmAddBox(room, [x - 0.4, 0, z - 0.4], [x + 0.4, 12, z + 0.4], matMarble);
    }
  }
  // trono na parede norte (z=-197)
  const matGold = D([0.82, 0.66, 0.30]);
  const matRed  = D([0.55, 0.10, 0.10]);
  rmAddBox(room, [-2, 0, -196.5], [2, 0.6, -195.5], matGold);     // pedestal
  rmAddBox(room, [-1.5, 0.6, -196.5], [1.5, 2.0, -195.8], matRed); // assento
  rmAddBox(room, [-1.5, 2.0, -196.8], [1.5, 4.0, -196.5], matRed); // encosto alto
  // 2 chandeliers
  addCeilingLight(room, 0, -170, 5, 5, 14, [22, 18, 10], [255, 230, 180]);
  addCeilingLight(room, 0, -188, 5, 5, 14, [22, 18, 10], [255, 230, 180]);
  return room;
}

export function buildScene() {
  const rooms = [
    buildFieldMarshals(),
    buildPetrovsky(),
    buildArmorial(),
    buildWarGallery(),
    buildStGeorge(),
  ];
  // portals: descreve buraco de passagem entre 2 salas. Coordenadas em world
  // space. axis indica eixo perpendicular à parede do portal.
  const portals = [
    { fromRoom: 'FieldMarshals',   toRoom: 'PetrovskyHall',   axis: 'z', position: -30,  perpRange: [-1.5, 1.5], yRange: [0, 5] },
    { fromRoom: 'PetrovskyHall',   toRoom: 'ArmorialHall',    axis: 'z', position: -52,  perpRange: [-1.5, 1.5], yRange: [0, 5] },
    { fromRoom: 'ArmorialHall',    toRoom: 'WarGallery1812',  axis: 'z', position: -102, perpRange: [-1.5, 1.5], yRange: [0, 5] },
    { fromRoom: 'WarGallery1812',  toRoom: 'StGeorgeHall',    axis: 'z', position: -157, perpRange: [-1.5, 1.5], yRange: [0, 5] },
  ];
  return { id: 'hermitage-enfilade', rooms, portals };
}
