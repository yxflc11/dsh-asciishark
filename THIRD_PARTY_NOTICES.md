# Third-party notices

This project contains code and ideas adapted from the following third-party
projects. Each component's license or pending permission status is described below.

## @local/dsh-client-ui-ascii-ocean (this repository)

Original contributions that the maintainer is entitled to license are available
under the MIT License. See `LICENSE`. This does not grant rights to third-party
code, including the ascii-sharks sources or their copies in compiled bundles.
The package as a whole must not be treated as fully MIT-licensed while upstream
permission remains unresolved.

## stackedlol/ascii-sharks

- Source: https://github.com/stackedlol/ascii-sharks
- Usage: copies of `engine.ts`, `index.ts`, `math.ts`, `react.tsx`, `renderer.ts`,
  `species.ts`, `world.ts`, and the upstream README under `src/ascii-sharks/`,
  with worker/OffscreenCanvas adaptations. The engine is also included in
  `lib/client.js` and `preview/ocean.global.js`.
- License: no upstream license was found as of 2026-10-23, when upstream `main`
  pointed to `c521e24a787e6d4cc460d4cf2b9815f25e4fe453`. Attribution alone is not
  permission to use, modify, or redistribute this code.
- Permission request: [submitted by yxflc11 on 2026-10-23](https://github.com/stackedlol/ascii-sharks/issues/1#issuecomment-6355506507).
  The request covers the incorporated version, continued modification and
  integration, source and compiled plugin/preview distribution, and downstream
  rights under MIT. **Permission is pending, not granted. Until it is confirmed,
  please do not redistribute this repository or the built plugin/preview
  bundles.** If permission is granted, retain the author's copyright notice and
  full license text in the repository and distributed packages. If permission
  cannot be obtained, replace the copied sources with a licensed implementation
  and rebuild the bundles.
- Copyright: © the ascii-sharks author (stackedlol).

## eemeli/yaml

- Source: https://github.com/eemeli/yaml (npm package `yaml`, version 2.9.1).
- Usage: the offline desktop installation helper includes a bundled YAML syntax
  parser in `scripts/vendor/yaml.mjs`. It locates configuration entries without
  evaluating DSH `!!js` expressions or rewriting unrelated configuration.
- License: ISC. The complete original copyright and permission notice is
  included in `scripts/vendor/yaml.LICENSE` and copied with every installation.
- Build provenance: see `scripts/vendor/README.md`.

## rdev/liquid-glass-react

- Source: https://github.com/rdev/liquid-glass-react
- Usage: the liquid-glass refraction technique (per-pixel displacement map +
  SVG filter with chromatic aberration) and the elastic/glass presentation
  approach are adapted from this project. The implementation here is an
  independent vanilla-TS port for DSH.
- License: MIT

```
MIT License

Copyright (c) 2025 Max Rovensky

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
