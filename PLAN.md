# Windows desktop release

Upstream: b211101dd0650a7461318a3ef73253cf9f0a801b (1.114.0).
User authorization: implement, test, package and locally commit; continue through milestones.

## 1. Architecture
Electron hosts the original Next standalone production server in a managed utility process.
All runtime assets are local. A persistent per-user origin preserves IndexedDB/localStorage.
Loopback requests require a random per-launch secret. Existing authenticated MCP is retained.

## 2. SURGICAL CONTEXT MAP
- apps/web/next.config.ts:28-40 production build settings
- apps/web/src/app/api/layerling-mcp/route.ts:17-36 production bridge authorization
- apps/web/src/components/LayerlingEditor.tsx:11630-11670 editor bridge registration
- package.json:14-41 build/test scripts
- desktop/ new main process, server, packaging and validation scripts

## 3. Milestones
- [x] Inspect upstream and choose runtime architecture.
- [ ] Implement desktop runtime, authenticated server and release staging.
- [ ] Run upstream checks and build production assets.
- [ ] Package executable, portable release and per-user NSIS installer.
- [ ] Validate installed release, CAD, file operations, offline, persistence and MCP.
- [ ] Finalize reports, licenses, source, checksums and local commits.

## 4. STATE HANDOFF
Dependencies are being installed. See docs/desktop/PROGRESS.md for execution evidence.
