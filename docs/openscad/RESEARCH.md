# Source inspection, 2026-10-27

- openscad/openscad: 362da9e62fe71f6160a16ec96946db6cec3f77ee.
  src/openscad.cc:462 exports Customizer metadata; 626-638 applies JSON parameter sets;
  CLI exposes -D, -p/-P, dependency output -d, STL/AST outputs. Native evaluation is authoritative.
- openscad/tree-sitter-openscad: 27329e1905a346131d6beb6e2a32fed8cd7e2816.
  grammar.js and bindings/node provide syntax structure, not semantic evaluation. Avoid a new
  native parser binding/ABI dependency when the CLI already supplies full syntax diagnostics.
- openscad/openscad-playground: 012111f06bb6d8dac2b8d30318512494d87d6932.
  src/runner/actions.ts:17-62 uses --export-format=param with a mounted WASM filesystem and
  delayed/abortable execution. Its headless WASM alternative needs filesystem mounting,
  libraries and a separately pinned build. Keep it behind the engine boundary for future work.
- esalisbery/3D-Print-Artist-Studio: f63f0791344f3c51c7e4244829f1415a95319987.
  electron/openscad.js:91-113 uses spawn without shell. electron/scadParser.js:34-190 scans
  Customizer scope; 533-640 extracts groups/parameters; 655+ chooses widgets. Reuse that existing
  extractor for metadata and statement spans, never as a SCAD interpreter. One added end-offset
  field lets the engine substitute override declarations in the original lexical scope.
  package.json declares MIT.

Local stable engine verified: OpenSCAD 2021.01; its CLI lacks the newer param export shown in
the current Playground, so use the established annotation extractor with the native compiler.
The native engine is bundled rather than requiring an installed development OpenSCAD. Modern
libraries requiring newer syntax may report native diagnostics; no language features are mocked.

Script-driven dependencies/expressions are separate from dimensional sketch constraints and
feature-history solving. This work does not implement or replace a geometric constraint solver.
