// Caverna voxel-based 1×1×1m. Sem luz inicial — só as lamps que o
// player adicionar. Bounds gigantes (sala lógica é "infinita").
import { newRoom } from '../_lib/builder.js';

export function buildScene() {
  const room = newRoom('Cave', [-100, 0, -100], [100, 100, 100]);
  return { id: 'cave', rooms: [room], portals: [] };
}
