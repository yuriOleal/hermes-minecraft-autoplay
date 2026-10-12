import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../mcp/read-only-server.mjs', import.meta.url));

test('read-only MCP exposes bounded authenticated observations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minecraft-mcp-test-'));
  const secret = 'test-token-that-is-at-least-thirty-two-characters';
  const tokenFile = join(dir, 'bridge.token');
  await writeFile(tokenFile, secret);
  const seen = [];
  const bridge = createServer((req, res) => {
    seen.push({ path: req.url, method: req.method, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      MINECRAFT_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}`,
      MINECRAFT_BRIDGE_TOKEN_FILE: tokenFile,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('MCP timeout')); }, 5000);
    pending.set(requestId, (message) => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
  });

  try {
    const init = await call('initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'hermes-minecraft-read-only');
    const listed = await call('tools/list', {});
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['minecraft_status', 'minecraft_state', 'minecraft_screen', 'minecraft_frame']);
    const state = await call('tools/call', { name: 'minecraft_state', arguments: { radius: 3 } });
    assert.equal(JSON.parse(state.result.content[0].text).path, '/control/state?radius=3');
    assert.deepEqual(seen, [{ path: '/control/state?radius=3', method: 'GET', auth: `Bearer ${secret}` }]);
    const invalid = await call('tools/call', { name: 'minecraft_state', arguments: { radius: 999 } });
    assert.equal(invalid.result.isError, true);
    const command = await call('tools/call', { name: 'minecraft_command', arguments: { command: 'op user' } });
    assert.equal(command.result.isError, true);
    assert.equal(seen.length, 1);
    assert.equal(JSON.stringify([init, listed, state, invalid, command]).includes(secret), false);
    await writeFile(tokenFile, 'wrong-token-that-is-at-least-thirty-two-characters');
    const unauthorized = await call('tools/call', { name: 'minecraft_status', arguments: {} });
    assert.equal(unauthorized.result.isError, true);
    assert.match(unauthorized.result.content[0].text, /HTTP 401/);
    assert.equal(unauthorized.result.content[0].text.includes(secret), false);
  } finally {
    child.kill();
    bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
});
