# Known issues

- Release binaries will be unsigned; no signing certificate has been supplied.
- External tutorial videos/support/release services require internet; core runtime is bundled.
- Full packaged CAD/file/MCP validation and 150% DPI passed. Final installer validation pending.
- OCCT Embind requires CSP unsafe-eval. The renderer remains sandboxed with no Node access.
- A profile uses a stable loopback port to preserve browser data; an occupied port produces a
  startup error rather than silently changing origin. Closing the conflicting program resolves it.
- Windows machine-wide anti-adblocking software injects optional local.adguard.org requests;
  the shipped request filter blocks them. No core local asset requests failed in validation.
