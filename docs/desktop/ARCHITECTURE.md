# Layerling Windows desktop

Baseline: upstream b211101dd0650a7461318a3ef73253cf9f0a801b, version 1.114.0.

Electron supplies Chromium and Node. Its main process forks a utility process that runs the
Next.js standalone production server, without npm, a separately installed Node, or a browser.
The original React UI, server routes, modeling code and geometry workers are preserved.
Static export was rejected because project storage and the MCP command queue are server APIs.
Production Next tracing captures server dependencies; staging adds public assets and .next/static
explicitly, as required by Next's standalone deployment contract.

## Resources
Public assets include Manifold JS/WASM, versioned OCCT JS/WASM, typefaces (including generated
Japanese glyphs), shape icons, printer presets, guides and their illustrations. Webpack worker
chunks and browser code live in .next/static. The executable embeds the browser/Node runtime.
Remote release checks, external support links and hosted tutorial videos remain optional online
services. No geometry algorithm is replaced. The source archive and notices accompany releases.

## Process and data lifecycle
A single-instance lock prevents duplicate GUI/server instances. The server binds only 127.0.0.1
on a persistent, randomly allocated per-profile port. A collision fails with a useful error rather
than silently moving the browser origin and hiding saved projects. userData is under
%APPDATA%/Layerling Desktop; Chromium's persistent session stores existing local projects,
settings and recent projects. Projects/ enables the existing filesystem project API as well.
The installer never deletes userData. Window bounds are saved separately. Utility processes are
killed during shutdown; startup waits for a real authenticated HTTP response before showing UI.

## Security and MCP
Renderer sandbox and context isolation are enabled, Node integration disabled; no preload or
renderer IPC bridge is needed. Native Chromium file dialogs, drop and downloads preserve file
formats. Downloads show a native Save As dialog. New remote windows and remote navigation are
blocked. All network requests except the application origin/data/blob are blocked by default.
CSP restricts network and code sources to the application. Inline Next bootstrap/style and
JavaScript evaluation are required: OCCT's upstream Emscripten/Embind runtime creates functions
during initialization, including STEP import/export in the renderer. Blocking eval was tested
and prevented hollowing. The shipped policy allows it to preserve the unmodified kernel;
the sandbox, no renderer Node access, authenticated origin and external-network denial remain.

The server rejects foreign hosts/origins and every unauthenticated request (including assets).
Electron injects a random per-launch bearer token without exposing it to page JavaScript.
The existing production MCP mode uses this same token and same-origin editor authorization.
connection.json holds the current loopback URL/token in the user's private profile, is removed
on shutdown and is never included in a release. The bundled stdio adapter reads it at launch.
MCP does not need a client present to launch the desktop. Screenshot development-only endpoints
remain disabled; MCP screenshots use the existing editor bridge results.

## References
- https://nextjs.org/docs/15/pages/api-reference/config/next-config-js/output
- https://www.electronjs.org/docs/latest/tutorial/security
