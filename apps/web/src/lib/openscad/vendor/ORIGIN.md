# Customizer metadata extractor

scadParser.cjs is a copy of electron/scadParser.js from
https://github.com/esalisbery/3D-Print-Artist-Studio at commit
f63f0791344f3c51c7e4244829f1415a95319987 (package.json declares MIT).
The upstream source contains no separate LICENSE file; original source comments are retained.
Used privately for Customizer metadata only. It does not evaluate or interpret SCAD programs.
OpenSCAD's native parser and evaluator remain authoritative for syntax and geometry.
One adaptation adds an end offset to statement scan records so the engine can substitute
parameter expressions into the original lexical scope before native compilation. The upstream
annotation semantics and literal parser are unchanged; no SCAD evaluator was added.
