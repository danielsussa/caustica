// Caverna voxel-based 1×1×1m. Geometria gerada em runtime no main.js
// a partir do estado de voxels vazios. Aqui só luz pendurada do "teto"
// inicial (y=2) e bounds gigantes (sala lógica é "infinita").
import { newRoom, rmAddLight } from '../_lib/builder.js';

export function buildScene() {
  const room = newRoom('Cave', [-100, 0, -100], [100, 100, 100]);
  rmAddLight(room, [0, 1.7, 0], 0.08, [12, 7, 2], [255, 170, 80]);
  return { id: 'cave', rooms: [room], portals: [] };
}
