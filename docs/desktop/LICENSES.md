# Desktop third-party license materials

Before producing a Windows package, run these scripts in order:

1. `node desktop/geometry-sources.mjs`
2. `node desktop/licenses.mjs`

The first script verifies the npm release/tag/submodule pins, writes pinned geometry source archives under `dist/windows/sources/`, and downloads the applicable license texts. It preserves other source files already in that directory and reuses its two large archives only when their SHA-256 matches the recorded pinned digest. The second script inventories installed npm packages, notes which package directories are in the Next standalone runtime trace, and copies available license/notice texts to `dist/windows/legal/`.

The runtime package list is different from the install-time dependency list. `sharp` and `@img/sharp-win32-x64` appeared in Next's standalone trace even though image optimization is disabled and the application does not use `next/image`; the desktop stage should exclude them. If a release retains sharp's bundled Windows libvips runtime, its LGPL-3.0-or-later source and bundled component notices need a separate review. Packages such as `@jscadui/3mf-export` and `@nodable/entities` are transitive dependencies of manifold-3d's extra 3MF export path; they were absent from the traced Node runtime and the browser-loaded `manifold.js` artifact.

`occt-wasm@5.8.0` metadata declares MIT OR Apache-2.0 for the wrapper/tooling, while its upstream README separately identifies the compiled WASM output as LGPL-2.1-only inherited from OCCT. The matching OCCT LGPL text and Open CASCADE exception are included with pinned sources. The exception's applicability to the shipped binary is not determined here.

The desktop keeps the OCCT runtime outside ASAR at `resources/runtime/apps/web/public/occt/5.8.0/occt-wasm.wasm`. To replace it, close the application, replace that file in the install directory, and restart. See `BUILD_REPORT.md` for current verification status and evidence; this note does not claim the replacement check passed.

These files report upstream and installed-package evidence. They are not a legal opinion; review the exact final package contents and applicable obligations before release.
