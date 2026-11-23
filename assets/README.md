# Assets

Source GLBs, a catalog of fit data, and a script that turns the sources into normalized, compressed models. The app still loads `frontend/public/models/`. Switching it to `out/` belongs to the pose integration work.

## Canonical frame

Millimetres. Origin at the bridge centre, on the rear face of the bridge bar.

- +x toward the wearer's left (the viewer's right when facing the wearer)
- +y up
- +z out of the face, toward the viewer
- temples extend along -z

Anchors in `catalog.json` (`bridgeCenter`, `nosePadLeft`, `nosePadRight`, `hingeLeft`, `hingeRight`) are in this frame. `totalWidthMm` is the width of the frame front, measured on the front slab so splayed temples do not count. All dimensions are `nominal`: typical values for the style, not manufacturer specs.

## Run

```
npm install
npm run normalize   # writes out/<slug>.glb and out/manifest.json
npm run render      # writes renders/<slug>-{front,top,side}.png with anchor markers
npm test
```

Marker colours: bridge magenta, left pad blue, right pad green, left hinge orange, right hinge red. Axes are red (x), green (y), blue (z). `render.mjs` drives headless Chrome through `playwright-core` and serves three.js from `node_modules`.

## Pipeline

`normalize.mjs` rotates by `axisCorrection`, bakes and flattens nodes, scales to `totalWidthMm`, moves the origin to `bridgeOriginMm`, welds, dedupes, joins meshes per material, prunes, then quantizes and compresses with meshopt. Output is deterministic and a test checks it.

`bridgeOriginMm` is hand-set. It is the bridge centre in the intermediate frame (front slab centred in x, vertically centred, front plane at z = 0). Anchors were set from the geometry and checked in the renders. `expectedBoundsMm` pins the output bounds so tests catch a change in scale, origin or orientation.

## Compression

Meshopt. Sizes are in `out/manifest.json`, with gzip at level 9.

| Model | Source | Meshopt | Draco | Meshopt gzip | Draco gzip |
|---|---|---|---|---|---|
| rectangular-acetate | 1164908 | 168428 | 79604 | 70789 | 67842 |
| oval-wire-sunglasses | 2066096 | 1006804 | 940072 | 911193 | 908598 |
| pixel-shades | 202272 | 26088 | 7332 | 6624 | 5053 |
| round-wire-glasses | 2652712 | 831064 | 712084 | 682755 | 676753 |

Draco is smaller on every model, before and after gzip. Over the four models gzipped Draco is 13115 bytes smaller. Meshopt wins on the decoder: in three 0.187, `meshopt_decoder.module.js` is 29256 bytes, while the Draco glTF decoder is 192420 bytes of wasm plus a 58456 byte wrapper (250876 total), and meshopt decodes faster. The decoder is paid once per visitor, so the saving outweighs the gap. Textures are unchanged and account for most of the remaining size in the oval and round models.

## Credits

All four models are CC BY 4.0. See `CREDITS.md`. Each output GLB carries the attribution in `asset.copyright` and `asset.extras`.
