import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function testStdioMcp(executable, profile) {
  const script = path.join(path.dirname(executable), 'resources/app.asar/mcp-client.mjs');
  const child = spawn(executable, [script], { windowsHide: true, env: { ...process.env,
    PATH: process.env.SystemRoot + '\\System32', ELECTRON_RUN_AS_NODE: '1', LAYERLING_DESKTOP_PROFILE: profile }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '', stderr = '', nextId = 1;
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer += data.toString();
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      } catch { /* Non-JSON output is captured by a timeout failure. */ }
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out. ${stderr}`)); }, 20000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'desktop-release-validation', version: '1' } });
    assert.equal(init.serverInfo.name, 'layerling-mcp');
    const list = await rpc('tools/list');
    assert.ok(list.tools.some(tool => tool.name === 'layerling_read_scene'));
    const scene = await rpc('tools/call', { name: 'layerling_read_scene', arguments: {} });
    assert.notEqual(scene.isError, true, JSON.stringify(scene));
    return { tools: list.tools.length, sceneRead: true, runtime: 'bundled Electron Node' };
  } finally { child.kill(); }
}
