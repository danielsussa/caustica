// Itera scenes/*/index.js, roda buildScene() em cada uma e escreve
// public/scenes/<sceneId>/manifest.json + rooms/*.json.
//
// Roda em Node. Pré-build pra dev/build do Vite.

import { writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCENES_SRC = join(ROOT, 'scenes');
const SCENES_OUT = join(ROOT, 'public', 'scenes');

const sceneDirs = readdirSync(SCENES_SRC).filter(name => {
  if (name.startsWith('_') || name.startsWith('.')) return false;
  return statSync(join(SCENES_SRC, name)).isDirectory();
});

if (existsSync(SCENES_OUT)) rmSync(SCENES_OUT, { recursive: true });
mkdirSync(SCENES_OUT, { recursive: true });

for (const dir of sceneDirs) {
  const indexPath = join(SCENES_SRC, dir, 'index.js');
  if (!existsSync(indexPath)) {
    console.warn(`scenes/${dir}/index.js não existe — pulando`);
    continue;
  }
  const mod = await import(pathToFileURL(indexPath).href);
  if (typeof mod.buildScene !== 'function') {
    console.warn(`scenes/${dir} não exporta buildScene() — pulando`);
    continue;
  }

  const scene = mod.buildScene();
  const sceneId = scene.id || dir;
  const outDir = join(SCENES_OUT, sceneId);
  mkdirSync(join(outDir, 'rooms'), { recursive: true });

  const manifestRooms = [];
  let totalTris = 0, totalSphs = 0, totalLights = 0;
  for (const room of scene.rooms) {
    const file = `rooms/${room.id}.json`;
    writeFileSync(join(outDir, file), JSON.stringify(room));
    manifestRooms.push({ id: room.id, bounds: room.bounds, file });
    totalTris   += room.tris.length;
    totalSphs   += room.sphs.length;
    totalLights += room.lights.length;
  }

  const manifest = {
    id: sceneId,
    rooms: manifestRooms,
    portals: scene.portals || [],
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`built ${sceneId}: ${scene.rooms.length} room(s), ${totalTris} tris, ${totalSphs} sphs, ${totalLights} lights`);
}
