// Runs in Electron's Node utility process. No dependency on an installed Node executable.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = process.env.LAYERLING_RUNTIME;
const token = process.env.LAYERLING_MCP_TOKEN;
const port = Number(process.env.PORT);
if (!runtime || !token || !Number.isInteger(port)) throw new Error('Missing desktop runtime configuration');
const origin = `http://127.0.0.1:${port}`;
const expected = Buffer.from(`Bearer ${token}`);
const createServer = http.createServer;
http.createServer = function (...args) {
  const index = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[index];
  args[index] = (req, res) => {
    const auth = Buffer.from(req.headers.authorization || '');
    if (req.headers.host !== `127.0.0.1:${port}` ||
        (req.headers.origin && req.headers.origin !== origin) ||
        auth.length !== expected.length || !crypto.timingSafeEqual(auth, expected)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Desktop access denied');
      return;
    }
    // Disallow proxy headers from changing Next's interpretation of the trusted origin.
    delete req.headers['x-forwarded-host'];
    delete req.headers['x-forwarded-proto'];
    // OCCT's upstream Embind glue constructs JS functions during initialization.
    // Keep eval limited to this fully local, authenticated, sandboxed application.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    handler(req, res);
  };
  return createServer.apply(this, args);
};
process.env.NODE_ENV = 'production';
process.chdir(runtime);
const config = JSON.parse(fs.readFileSync(path.join(runtime, '.next/required-server-files.json'), 'utf8')).config;
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
const runtimeRequire = require('node:module').createRequire(path.join(runtime, 'server.js'));
const { startServer } = runtimeRequire('next/dist/server/lib/start-server.js');
startServer({ dir: runtime, isDev: false, hostname: '127.0.0.1', port, allowRetry: false, keepAliveTimeout: 5000 })
  .catch(error => { console.error(error); process.exit(1); });
