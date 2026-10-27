# Build and run on Windows 11 x64

## Run
Run `Layerling-Desktop-Setup-x64.exe`, choose a per-user installation directory, then start
Layerling Desktop from Start or its desktop shortcut. Installation does not need administrator
privileges. `Layerling-Desktop-Portable-x64.exe` extracts and launches without installation.
Neither requires installed Node/npm, Git, Python, a development server or an external browser.

Create or reopen designs from the dashboard. Ctrl+O opens a native import dialog; Ctrl+S saves
the current editable project. Export offers the existing STL, OBJ, 3MF, STEP, SVG, DXF, PNG,
LYL and drawing formats. Drop files onto the editor as before. Native downloads ask where to
save. The original modeling UI and keyboard shortcuts are retained.

Data is in `%APPDATA%\Layerling Desktop`, including Chromium local project/settings storage,
filesystem `Projects`, thumbnail cache, window settings and `desktop.log`. Back up this entire
folder while the application is closed. Keep exported .lyl files as portable project backups.
Uninstalling leaves the profile intact. Do not delete it when updating.

External support pages, videos and update services are unavailable in this offline desktop
edition. Bundled guides and all local CAD assets work without internet. Releases are unsigned.

## Rebuild
Build tools only: Windows x64, Git, Node >=22.18 and npm. The verified host used Node 26.4.0
and npm 12.0.2. An initial dependency/runtime download needs internet. No global installer or
administrator tool installation is needed.

```powershell
npm ci --no-audit --no-fund
npm run typecheck
$env:NODE_OPTIONS='--no-experimental-webstorage' # Node 26 test environment only
npm test -- --reporter=default
npm run test:e2e -- --reporter=default
Remove-Item Env:NODE_OPTIONS
npm run desktop:release
```

The release script requires committed sources, builds the production frontend, stages the
Next traced runtime and assets, generates legal/source materials, archives the exact local
source revision, then produces NSIS and portable x64 packages and SHA-256 checksums.
It does not publish anything. Existing pinned geometry source archives are verified/reused.
`npm run desktop:build` builds/stages only. `npm run desktop:package` repackages a staged tree.
`node desktop/release.mjs --stage-only --nsis-only` reuses an already verified Next build.

```powershell
$env:LAYERLING_VALIDATION_DIR='dist/windows/validation-installed'
$env:LAYERLING_TEST_DPI='1.5'
$env:LAYERLING_TEST_WASM_REPLACEMENT='1'
node desktop/validate.mjs 'C:\path with spaces\Layerling Desktop.exe'
```

Validation uses isolated profiles, removes Node/Git/npm from the app's PATH, disables external
network access using the shipped session policy, runs real modeling/file workflows, and writes
results/screenshots under the validation directory. The optional replacement test temporarily
appends a valid non-semantic custom section to the installed OCCT WASM and restores its original
bytes afterward; close other instances of the tested installation first.

## Local MCP
Start the desktop app and open one editor. Configure an MCP client with its executable as the
runtime and its bundled adapter as the script. No external Node is needed. For example:

```toml
[mcp_servers.layerling_desktop]
command = 'C:\Users\YOUR_NAME\AppData\Local\Programs\Layerling Desktop\Layerling Desktop.exe'
args = ['C:\Users\YOUR_NAME\AppData\Local\Programs\Layerling Desktop\resources\app.asar\mcp-client.mjs']
[mcp_servers.layerling_desktop.env]
ELECTRON_RUN_AS_NODE = '1'
```

Adjust both paths to the selected installation directory. The adapter reads the per-launch
URL/token from `%APPDATA%\Layerling Desktop\connection.json`. Do not copy that token into
client configurations or share the profile. Other users on the machine must not have access to
your Windows profile. MCP only binds loopback and requires authentication. There is no cloud
connection and an absent MCP client does not affect launching or modeling.

## Source and replaceable components
The installation contains `resources/legal` and `resources/sources`. The latter includes the
desktop source snapshot and pinned OCCT wrapper/kernel source archives. Electron's licenses
are next to the executable. Geometry WASM is outside app.asar; see LICENSES.md and the generated
SOURCE-ACCESS notice for the exact path and source pins. Rebuild a compatible OCCT runtime from
those sources, close Layerling, back up the installed WASM and replace it, then restart. No
signature, hash lock or installer integrity check prevents that replacement.
