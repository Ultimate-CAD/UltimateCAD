# Private desktop branding (.12)

Status: implementation and focused tests complete; packaged acceptance pending.

## Single definition

Edit `apps/web/src/config/productBranding.json`, then run a full `node desktop/build-ultimate.mjs` build from a clean committed tree. It controls the product name, displayed release version, tagline/description, logo, favicon, generated Windows icon, editor-loading splash, installer artifact name, local help entry point and brand colors. Default: **Ultimate CAD**, `1.114.0-ultimate.12`. Replace the local SVG named by `logo` to change the mark; the build creates a 512 px PNG and splash from it. Display identity is compiled into the renderer and copied into the Electron package. A changed definition requires a full build; stage-only builds reject a different branding stamp.

The regular installer title, Windows product information and shortcut label use the configured name. The executable filename remains `Layerling Ultimate.exe` for installation compatibility. There is no account, activation service or remote branding service. This is build-time local configuration; existing installed binaries do not rename themselves when a source file is edited.

## Everyday UI

- Dashboard/editor mastheads, loading splash, browser/window title and footer display the configured identity.
- Private footer shows only local Help and About. GitHub, sponsorship/donations, discussions, online bug-report navigation, release notes, public update links, browser-install promotions and third-party video/importer promotions are removed from ordinary UI.
- The automatic GitHub release hook is disabled. Automatic upstream What's New presentation is disabled. Local worker/build mismatch detection remains intact.
- The built-in guide is bundled, branded and uses local navigation. Its public project footer is replaced with local About/licenses; external Markdown links are rendered as text in the private desktop guide. Original documentation source remains unchanged.
- UI translation templates substitute the display name before interpolating filenames/project data. URLs, the upstream trademark notice, original catalogs, legal text, source code and stored data are preserved. Brand-substituted sentences remain recognizable by error localization.

## Local licenses and source access

About → Open-Source Licenses opens searchable browser text views generated from the existing legal inventory. Original legal files are not altered. About identifies this application as a local derivative of Layerling by its contributors; no sole ownership of inherited code is asserted.

About → Source access exposes the preserved source-access notice and a local download of the corresponding modified application source archive. The archive includes the branding definition, build scripts, notices and changes in the runtime source commit. Original root AGPL license, third-party/license inventory, font notices, OCCT notices/source resources and OpenSCAD notices remain packaged. This mechanism remains available if the deployment changes; the notice does not assert that a future distribution/deployment automatically satisfies every applicable obligation.

Native Electron menu Help → Local help / About opens these local pages with the same hardened session. External windows/navigation remain denied and authenticated loopback-only runtime access is unchanged.

## Compatibility retained

`org.layerling.ultimate`, `org.layerling.desktop`, internal npm package names, executable filenames, install-directory identity, AppData directories (`Layerling Ultimate` / `Layerling Desktop`), `Projects`, session partition `persist:layerling`, localStorage/IndexedDB keys, LYL schemas/MIME types/createdWithVersion, geometry types, native geometry filenames/IPC channels, OpenSCAD paths, MCP endpoints/tool names and environment variables are unchanged. No project migration or directory move is performed. User project/export names remain user data. Geometry and .11 manufacturing-validation code are untouched.

## Baseline and verification

Branch: `codex/private-desktop-branding`, started clean at `aba102834cca79629ca8190495ab2d5ed78d7547`. Full .11 release preserved at `.codex-run/preserved-ultimate11`; original installer SHA-256 `13b659acf685bb6aa5c2fcf98aaf00b445ef27ad15027dca2cc205b3e070c649` verified before implementation. The working installed application is not upgraded by these scripts.

Focused checks: 107 tests passed in nine files (branding/offline footer, error localization, update utility, storage, project persistence, SCAD records, MCP tools and guide behavior), plus 16 i18n tests passed. One inherited static English-sentence scan is excluded from the focused i18n rerun: its nine reported lines in HollowFinishingPanel/PrecisionMeshStudio are byte-identical to the .11 checkpoint. No test was weakened and those unrelated geometry UI files were not edited. Evidence: `.codex-run/branding12/inherited-i18n-scan.md`; logs `focused-final.log`, `i18n-focused.log`. TypeScript check passes (`typecheck-final.log`).

`desktop/validate-branding.mjs` covers isolated packaged identity, local UI/navigation, About/licenses/source archive, original AGPL checksum, temporary Windows shortcut creation/readback, old .11 project round trip and app restart, and blocked external requests. Existing packaged OpenSCAD/native worker checks are reused separately. Acceptance runs with no development tools on PATH and external app access blocked. System network adapters and the installed user application are not changed. Expensive organic hollowing/export benchmarks are outside this branding change.
