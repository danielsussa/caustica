// Cena totalmente vazia (void). Sem chão, sem paredes, sem luz.
// Player flutua no nada; usa o editor (+ box) pra montar a cena do zero.
// Modos light-based (lighttrace, path tracer) ficam pretos sem luz —
// só shaded/wireframe mostram boxes adicionadas (LIGHT fixa em view-space).
export function buildScene() {
  return { id: 'empty', rooms: [], portals: [] };
}
