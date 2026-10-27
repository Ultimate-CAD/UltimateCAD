import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const profile = process.env.LAYERLING_DESKTOP_PROFILE || join(process.env.APPDATA, 'Layerling Desktop');
try {
  const connection = JSON.parse(readFileSync(join(profile, 'connection.json'), 'utf8'));
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('Invalid desktop connection');
  process.env.LAYERLING_URL = url.origin;
  process.env.LAYERLING_MCP_TOKEN = connection.token;
  process.env.LAYERLING_MCP_OPEN_EDITOR = '0';
  await import('./mcp/layerling-mcp-server.mjs');
} catch (error) {
  console.error(`Start Layerling Desktop and open a project before using MCP: ${error.message}`);
  process.exitCode = 1;
}
