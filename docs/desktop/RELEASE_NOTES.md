# Layerling Desktop 1.114.0 for Windows x64

Standalone Electron desktop edition of upstream Layerling revision
b211101dd0650a7461318a3ef73253cf9f0a801b. Runtime source commit:
38c5c1008bac232eac28be89e6993bc49b8f5446. AGPL-3.0-only; Layerling contributors.

- Per-user Windows installer/uninstaller, Start menu/desktop shortcuts and portable launcher.
- Original CAD UI, geometry engines and existing import/export formats retained.
- Bundled production Next server, Chromium/Node runtime, workers, WASM, fonts and local guides.
- Native Open/Save/download behavior, persistent window size and local project/preferences data.
- Authenticated loopback MCP with 74 original tools and a bundled stdio client runtime.
- Source archives, pinned geometry sources, dependency notices and SHA-256 manifest included.

Verified: 3481 unit tests; 589 geometry integration tests; installed CAD/file workflows,
150% DPI, offline network isolation, restart persistence, source-independent operation,
compatible WASM replacement, native file dialogs, single instance and install/uninstall/reinstall.
The portable launcher also created/hollowed a solid and exported STL.

Unsigned binaries. External tutorial/support/release services are blocked inside the app.
The OCCT Embind runtime requires the documented CSP unsafe-eval allowance. See
BUILD_REPORT.md for exact executed evidence and KNOWN_ISSUES.md for remaining limits.

Run Layerling-Desktop-Setup-x64.exe, or launch Layerling-Desktop-Portable-x64.exe.
Rebuild from committed sources with npm ci and npm run desktop:release; see BUILD_INSTRUCTIONS.md.
