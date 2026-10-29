# Midnight Blue appearance patch

Visual patch 1.114.0-ultimate.9.1, based on the supplied ChatGPT Windows appearance screenshot.
Selectable via Theme → Midnight Blue. Existing desktop profiles apply this preset once on upgrade; subsequent user theme choices remain persistent. Existing System, Light, Dark and Graphite themes are retained.

- Background #111111, foreground #FCFCFC, blue accent #0169CC.
- Neutral #262626 panels and subtle #494949 borders, translucent inspector/library panels.
- MS PGothic (installed Windows font), regular 16px UI base and 16px system monospace code. Compact CAD toolbar labels retain their layout sizes.
- Pointer cursors and visible keyboard focus; model colors, axis colors and safety indicators remain distinct.
- No motion override, geometry, manufacturing tolerance, serialization or worker algorithm changes.

The .9 application, installer and sources are preserved under .codex-run/preserved-ultimate9, with checkpoint-ultimate9-before-theme. The installed application is not replaced automatically. Packaged screenshots and appearance validation: dist/ultimate/windows/midnight-theme-validation.

Validated Windows build: 1.114.0-ultimate.9.1, source commit ad30d08a on codex/midnight-blue-theme. All 19 focused theme/grid regressions and four packaged appearance checks passed with zero page errors. Checks cover exact root colors/font, settled neutral dashboard panels, switching to the original Light theme, and persistence after reload. Screenshots were inspected after CSS transitions finished.

Executable: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\win-unpacked\Layerling Ultimate.exe`

Installer: `C:\Users\Justin\layerling-desktop\dist\ultimate\windows\Layerling-Ultimate-OpenSCAD-Setup-x64.exe` (212,898,998 bytes).

Installer SHA-256: `45302d75befbb1b5732af2d471f04ec3989b24e0b04d851dfe9742ad429cbddd`.

Executable SHA-256: `f017ecdf6472b45db08d2e3e6ebd5dc2edc0c7e2a2f549cd8d23fc5b93df4590`.
