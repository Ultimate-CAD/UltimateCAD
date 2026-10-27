# Known issues

- Release binaries are unsigned; no signing certificate was used.
- External tutorial videos, support links and release-check services are blocked inside this
  offline desktop edition. Bundled local guides and core CAD features remain available.
- Packaged, installed and portable validation passed, including 150% DPI. No critical runtime
  errors remained in the executed acceptance workflows. Physical Explorer drag gestures were
  not separately tested; the existing file-drop handler was tested with real STL bytes.
- OCCT Embind requires CSP unsafe-eval. The renderer remains sandboxed with no Node access.
- A profile uses a stable loopback port to preserve browser data; an occupied port produces a
  startup error rather than silently changing origin. Closing the conflicting program resolves it.
- This host attempted optional local.adguard.org requests; the shipped request filter blocked
  them. No core local asset requests failed in validation.
