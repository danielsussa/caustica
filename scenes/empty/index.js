// Cena vazia / sandbox — 1 sala neutra grande sem objetos. Pra usar com
// o editor de boxes (botão + box).
import { D, newRoom, rmAddQuad, rmAddWall, rmAddQuadLight } from '../_lib/builder.js';

export function buildScene() {
  const W = 50, H = 10;
  const room = newRoom('Studio', [-W/2, 0, -W/2], [W/2, H, W/2]);

  const matFloor   = D([0.55, 0.53, 0.50]);
  const matCeiling = D([0.92, 0.92, 0.88]);
  const matWall    = D([0.78, 0.76, 0.72]);

  rmAddQuad(room,
    [-W/2, 0, -W/2], [W/2, 0, -W/2], [W/2, 0, W/2], [-W/2, 0, W/2],
    matFloor);
  rmAddQuad(room,
    [-W/2, H, -W/2], [-W/2, H, W/2], [W/2, H, W/2], [W/2, H, -W/2],
    matCeiling);

  rmAddWall(room, 'x', -W/2, [-W/2, W/2], [0, H], null, matWall);
  rmAddWall(room, 'x',  W/2, [-W/2, W/2], [0, H], null, matWall);
  rmAddWall(room, 'z', -W/2, [-W/2, W/2], [0, H], null, matWall);
  rmAddWall(room, 'z',  W/2, [-W/2, W/2], [0, H], null, matWall);

  // luz ampla central no teto
  const y = H - 0.1;
  rmAddQuadLight(room,
    [-6, y, -6], [6, y, -6], [6, y, 6], [-6, y, 6],
    [16, 13, 8], [255, 230, 180]);

  return { id: 'empty', rooms: [room], portals: [] };
}
