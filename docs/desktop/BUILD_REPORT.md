# Build and validation report

Status: COMPLETE. Installer, installed application and portable launcher verified.
Date: 2026-10-27. Windows 11 x64, Node 26.4.0 / npm 12.0.2 (build tools only).
Upstream: b211101dd0650a7461318a3ef73253cf9f0a801b, Layerling 1.114.0.
Release implementation/source commit: 38c5c1008bac232eac28be89e6993bc49b8f5446.
Subsequent documentation commits do not change application binaries.

## Architecture and resources
Electron 45.0.0 with a managed Next.js 15.5.28 standalone production server. The renderer
is sandboxed and isolated with Node disabled; no preload IPC API. Every HTTP request needs
an injected bearer token and matching loopback host/origin. The native MCP stdio adapter
runs on Electron's bundled Node, discovers the profile's current authenticated endpoint,
and exposes the original 74 tools. No development server or external runtime is required.

Bundled resources: Next frontend/backend, all worker chunks, Manifold JS/WASM, OCCT 5.8.0
JS/WASM, existing shapes/printer profiles/UI assets, generated Japanese typefaces, fonts,
278 guide pages and illustrations, third-party notices and corresponding source archives.
Unused traced Sharp native codecs are excluded because images are unoptimized.
Core modeling algorithms and supported import/export formats were retained.

## Executed checks
| Command/check | Result |
| --- | --- |
| npm ci --no-audit --no-fund | Passed |
| npm run typecheck (including after packaging edits) | Passed |
| npm test -- --reporter=dot, unmodified Node 26 environment | 4 upstream jsdom/localStorage failures |
| NODE_OPTIONS=--no-experimental-webstorage npm test -- --reporter=default | 415 files, 3481 tests passed |
| npm run test:e2e -- --reporter=dot | 67 files, 589 tests passed, real OCCT/Manifold |
| npm run desktop:build | Next production build, guides/fonts/WASM and staging passed |
| node desktop/release.mjs --stage-only | Production assets reused; final x64 release packaged |
| node desktop/validate.mjs (packaged executable) | Full acceptance run passed |
| Installed executable, 150% DPI + replacement WASM | 25 checks passed, zero renderer/local HTTP errors |
| Installed executable while repository apps/ was moved out of reach | Same 25 checks passed; source restored |
| Six additional installed checks | STL drop handler, STEP import, guide, fonts, single instance, window persistence passed |
| Windows native file dialogs | Save As, subsequent linked-file Ctrl+S overwrite and Open exercised |
| NSIS per-user install/uninstall/reinstall | Exit 0; executable and shortcuts created/removed; profile preserved |
| Existing separate Layerling installation | Registry entry remained present after uninstall test |
| Final portable self-extracting launcher | Launched with System32-only PATH; created/hollowed a box and exported STL |
| Immediate startup-window close after cancellation fix | Three independent runs passed, server/secret cleanup verified |

The 25-check installed run covers executable startup with System32-only PATH and an external
working directory/profile containing spaces; renderer settings; authentication/origin rejection;
MCP stdio initialize/list/read; primitive creation/resizing; Boolean subtraction; OCCT hollow;
STL, OBJ and 3MF export; STL import; LYL serialization/reopen; STEP UI export/native download;
150% DPI canvas; server/secret cleanup; restart persistence and worker/local asset loading.
Source-independent testing hid the checkout's entire apps/ directory, including .next and
public assets. No changes were made to the separate existing Layerling installation.

Offline verification used the shipped session policy denying all external requests from the
first launch, plus an explicit rejected external fetch before modeling. Local modeling, saves,
imports, exports, guides and fonts passed. The physical network adapter was left unchanged.
The file-drop check dispatches a browser DragEvent with real STL File bytes to the existing
import panel. Physical Explorer drag gestures were not separately tested.

## Replaceable kernel and licensing evidence
OCCT WASM is outside ASAR in resources/runtime/apps/web/public/occt/5.8.0/occt-wasm.wasm.
A valid non-semantic custom section changed the kernel bytes; the installed app served those
bytes, initialized the modified kernel and hollowed a solid. Original bytes were restored:
SHA-256 24bf04061311f3e6bd6599b27c6eb7e3dd90f7b4467dc931f640cbac2378766b.
Pinned OCCT wrapper/kernel source archives and LGPL/exception texts are included; the
inventory has 18 staged Node-runtime packages with no missing runtime license texts.

## Artifacts and evidence
Installed executable: C:\Users\Justin\AppData\Local\Programs\Layerling Desktop\Layerling Desktop.exe.
Release directory: C:\Users\Justin\layerling-desktop\dist\windows.
Installer: Layerling-Desktop-Setup-x64.exe. Portable: Layerling-Desktop-Portable-x64.exe.
Checksums: SHA256SUMS.txt. Corresponding source: sources/Layerling-Desktop-Source.zip.
Evidence: validation-final/, installer-validation.json and release-metadata.json.
Run/rebuild/MCP instructions: BUILD_INSTRUCTIONS.md. Runtime limits: KNOWN_ISSUES.md.
Final installer: 258161174 bytes, SHA-256
7f54d97c0fc83219afd134e23b14ee25d85de325db3c6d95262f68fed2aee883.
Final portable: 233486547 bytes, SHA-256
867809a31eca82779318365e294f1800c9a5cdc874b02e20d573df7b0c85e75e.

## Defects found and repaired
Builder initially omitted traced server dependencies; afterPack now copies the runtime tree
verbatim. CSP initially blocked OCCT Embind function generation; the local-only policy allows
unsafe-eval while retaining sandbox/isolation and blocking remote content. A staging/notices
generation race was resolved by running dependent stages serially. A validation harness used
Node require inside an evaluated callback and was corrected. A close-during-startup loadURL
cancellation now exits without a blocking error dialog. No upstream modeling code was changed.
