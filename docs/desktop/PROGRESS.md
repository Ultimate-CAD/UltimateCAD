# Desktop execution record

## Audit
- Clean checkout at b211101dd0650a7461318a3ef73253cf9f0a801b.
- Host Windows x64; Node v26.4.0, npm 12.0.2.
- `npm ci --no-audit --no-fund --loglevel=error`: passed, 149 packages.
- Inspected server routes, MCP production authorization, worker/WASM loaders and file handling.
- Selected Next standalone plus Electron utility process; see ARCHITECTURE.md.

## Implementation and source validation
- Added Electron 45.0.0, electron-builder 26.18.0 and Playwright Core 1.64.1 (locked).
- Original UI/geometry preserved; Next standalone assets, workers, guides, fonts and WASM staged.
- Authenticated loopback server, single instance, persistent origin/profile, window bounds,
  native menus/dialogs/downloads and production stdio MCP implemented.
- `npm run typecheck`: passed.
- First `npm test -- --reporter=dot`: 4 failures in upstream useRememberedFlag under Node 26.
- `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm test -- --reporter=default`:
  415 files / 3481 tests passed. No application workaround or upstream test changes needed.
- `npm run test:e2e -- --reporter=dot`: 67 files / 589 tests passed (real OCCT/Manifold).
- `npm run desktop:build`: Next production build and runtime staging passed.
- Fixed actual packaged startup failure from builder excluding traced Node dependencies.
- Fixed actual OCCT initialization failure under CSP; Embind needs unsafe-eval (documented).
- Removed unused native Sharp/image optimizer from traced runtime (images.unoptimized).
- Completed pinned OCCT source archives, runtime license text mappings and source generator.

## Packaged runtime validation
- `node desktop/validate.mjs`: full validation-run7 passed, no renderer/local HTTP failures.
- Separate 150% DPI + replaceable WASM run passed. A modified compatible WASM was served,
  initialized and hollowed a box. Original bytes/hash restored afterward.
- Packaged real app: primitive create/resize, Boolean cut, hollow, STL/OBJ/3MF export,
  mesh import, LYL save/reopen, native STEP export, restart persistence and server cleanup.
- Bundled stdio MCP initialized, listed 74 tools and read a live scene, with System32-only PATH.
- External network requests blocked before geometry tests; no development server started.
- Windows UI: native Save As saved a .lyl; subsequent Ctrl+S updated the linked file to 42 mm.
- One staging attempt raced the independent notices generator; rerunning it serially passed.
  Build/release scripts now run their dependent stages sequentially.

## Installed validation and final release
Installed application passed all 25 checks, including with developer apps/ temporarily hidden
and restored. NSIS install, uninstall, profile preservation, existing-install preservation and
reinstall passed. Six additional installed checks passed: STL drop, exact STEP import, guide,
Japanese typeface, single instance, saved window size. Closing immediately after window creation
exposed a shutdown/loadURL race; fixed cancellation handling before the final release build.
Final runtime source commit: 38c5c1008bac232eac28be89e6993bc49b8f5446.
- `node desktop/release.mjs --stage-only`: both final Windows targets built successfully.
- Final installer applied successfully; final installed 25-check run passed with 150% DPI
  and compatible modified WASM, restoring original bytes afterward.
- Three immediate-close tests passed after the startup cancellation fix.
- Six additional installed checks passed again after final installation.
- Portable executable self-extracted and launched with System32-only PATH; real primitive,
  OCCT hollow and STL export passed; server exited normally afterward.
- Source-hidden final installed validation passed; source directory restored.
- Reports, release notes, source, dependency notices and SHA-256 manifest delivered under
  dist/windows. No source or release artifacts were published externally.
Status: COMPLETE. No required implementation work remains.
