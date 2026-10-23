# Vendored YAML parser

`yaml.mjs` bundles the `parseDocument`, `isMap`, `isSeq`, `isScalar`, and `isAlias` exports from yaml 2.9.1 (https://github.com/eemeli/yaml), using esbuild with target `node18`, ESM and minification. The npm archive is `https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz`. The original ISC license is retained in `yaml.LICENSE`.

The installer only reads the syntax tree and source ranges. It never converts unknown tags into executable values; DSH `!!js` expressions stay unchanged. No package install or network access is needed to run this parser.
