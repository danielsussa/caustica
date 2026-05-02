# cáustica

Renderer 3D experimental em JavaScript puro — só Canvas 2D, sem WebGL, sem Three.js, sem libs de gráficos. Quatro modos de visualização compartilhando a mesma cena: **wireframe**, **shaded** (rasterizador com z-buffer feito na mão), **lighttrace** (visualização dos fótons saindo da fonte de luz) e **path tracer** progressivo.

A cena é uma pequena galeria de museu multi-room (~1000 triângulos), com paredes, portas, esferas, quad lights emissivas e objetos animados. Travessia de raios acelerada por BVH (median-split, leaf size 4).

## Modos

| Tecla | Modo         | O que faz                                                                 |
|-------|--------------|---------------------------------------------------------------------------|
| `M`   | wireframe ↔ shaded | rasterização clássica, z-buffer por pixel                            |
| `L`   | lighttrace   | dispara fótons da luz e desenha o caminho (splats coloridos opcionais)    |
| `R`   | path tracer  | acumula amostras Monte Carlo a partir da câmera                           |

## Controles

- `WASD` — andar
- `Q` / `E` ou `↑` / `↓` — subir / descer
- arrastar mouse ou dedo — olhar
- mobile: joystick virtual + botões na tela

## Painel do lighttrace

Abre junto com o modo `L`. Permite ajustar em tempo real:

- paths/frame, brilho, decay por bounce, máximo de bounces
- splats coloridos, halo gaussian, depth fog, cor por bounce
- decay físico (1/r²) vs. artístico
- BVH on/off (pra comparar performance lado a lado)
- variação de emissão, exibir wireframe sobreposto

## Como rodar

```bash
npm install
npm run dev
# abre em http://localhost:5199
```

## Arquitetura

- `src/main.js` — render loop, rasterizador, lighttrace, splat layer, controles, UI
- `src/raytrace.js` — geometria da cena, BVH, interseções, animação de objetos

Math 4×4, projeção perspectiva e rasterização de triângulos escritos do zero. Nada de GPU.

## Status

Experimento aberto. Path tracer funcional mas longe de otimizado; o lighttrace ainda está explorando o que fica visualmente interessante.
