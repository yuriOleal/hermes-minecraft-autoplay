import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../mcp/bounded-control-server.mjs', import.meta.url));
const INTEGRATED = '[12out.2026 19:23:34.253] [Server thread/INFO] [net.minecraft.client.server.IntegratedServer/]: Starting integrated minecraft server version 1.21.1\n';
const REMOTE = '[12out.2026 19:24:34.253] [Render thread/INFO] [net.minecraft.client.gui.screens.ConnectScreen/]: Connecting to private.example, 12345\n';

async function fixture(logContent, enabled = true) {
  const dir = await mkdtemp(join(tmpdir(), 'minecraft-control-test-'));
  const tokenFile = join(dir, 'bridge.token');
  const logFile = join(dir, 'latest.log');
  const secret = 'test-token-that-is-at-least-thirty-two-characters';
  await writeFile(tokenFile, secret);
  await writeFile(logFile, logContent);
  let yaw = 20;
  let pitch = 10;
  let x = 0;
  let held = false;
  let screen = null;
  const seen = [];
  const bridge = createServer(async (req, res) => {
    seen.push({ path: req.url, method: req.method, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/control/status' && req.method === 'GET') {
      res.end(JSON.stringify({ ok: true, in_world: true, player: { present: true, x, y: 64, z: 0, yaw, pitch }, screen: { present: Boolean(screen), class: screen }, held_mappings: held ? ['key.forward'] : [] }));
    } else if (req.url === '/control/look' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const action = JSON.parse(body);
      yaw += action.yaw;
      pitch += action.pitch;
      res.end(JSON.stringify({ ok: true, yaw, pitch }));
    } else if (req.url === '/control/key' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const action = JSON.parse(body);
      if (action.mapping !== 'key.forward') { res.writeHead(400).end(); return; }
      if (action.action === 'down') held = true;
      if (action.action === 'up') { held = false; x += 0.1; }
      res.end(JSON.stringify({ ok: true, mapping_down: held }));
    } else if (req.url === '/control/release-all' && req.method === 'POST') {
      held = false;
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404).end();
    }
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      MINECRAFT_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}`,
      MINECRAFT_BRIDGE_TOKEN_FILE: tokenFile,
      MINECRAFT_CLIENT_LOG_FILE: logFile,
      MINECRAFT_ENABLE_SINGLEPLAYER_CONTROL: enabled ? '1' : '0',
      MINECRAFT_WATCHDOG_DELAY_MS: '500',
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
  return {
    call,
    seen,
    setScreen(value) { screen = value; },
    async close() { child.kill(); bridge.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('bounded look verifies the observed angle and stop blocks later actions', async () => {
  const f = await fixture(INTEGRATED);
  try {
    const tools = await f.call('tools/list', {});
    assert.deepEqual(tools.result.tools.map((tool) => tool.name), ['minecraft_look', 'minecraft_step_forward', 'minecraft_stop']);
    const looked = await f.call('tools/call', { name: 'minecraft_look', arguments: { yaw_delta: 3, pitch_delta: 0 } });
    assert.equal(looked.result.isError, false);
    assert.equal(JSON.parse(looked.result.content[0].text).observed_yaw_delta, 3);
    assert.deepEqual(f.seen.map((entry) => [entry.method, entry.path]), [
      ['GET', '/control/status'], ['POST', '/control/look'], ['GET', '/control/status'],
    ]);
    const stopped = await f.call('tools/call', { name: 'minecraft_stop', arguments: {} });
    assert.equal(stopped.result.isError, false);
    const refused = await f.call('tools/call', { name: 'minecraft_look', arguments: { yaw_delta: 3, pitch_delta: 0 } });
    assert.equal(refused.result.isError, true);
    assert.equal(f.seen.some((entry) => entry.path === '/control/key'), false);
  } finally { await f.close(); }
});

test('short forward step releases the key and the independent watchdog releases again', async () => {
  const f = await fixture(INTEGRATED);
  try {
    const result = await f.call('tools/call', { name: 'minecraft_step_forward', arguments: { duration_ms: 100 } });
    assert.equal(result.result.isError, false);
    assert.ok(JSON.parse(result.result.content[0].text).distance_moved > 0);
    assert.deepEqual(f.seen.filter((entry) => entry.path === '/control/key').map((entry) => entry.method), ['POST', 'POST']);
    assert.ok(f.seen.some((entry) => entry.path === '/control/release-all'));
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.ok(f.seen.filter((entry) => entry.path === '/control/release-all').length >= 2);
    const stopped = await f.call('tools/call', { name: 'minecraft_stop', arguments: {} });
    assert.equal(stopped.result.isError, false);
    const refused = await f.call('tools/call', { name: 'minecraft_step_forward', arguments: { duration_ms: 100 } });
    assert.equal(refused.result.isError, true);
  } finally { await f.close(); }
});

test('forward step refuses a pause screen and an excessive duration', async () => {
  const f = await fixture(INTEGRATED);
  try {
    f.setScreen('net.minecraft.client.gui.screens.PauseScreen');
    const paused = await f.call('tools/call', { name: 'minecraft_step_forward', arguments: { duration_ms: 100 } });
    assert.equal(paused.result.isError, true);
    f.setScreen(null);
    const long = await f.call('tools/call', { name: 'minecraft_step_forward', arguments: { duration_ms: 1000 } });
    assert.equal(long.result.isError, true);
    assert.equal(f.seen.some((entry) => entry.path === '/control/key'), false);
  } finally { await f.close(); }
});

test('rejects remote session, oversized turn, unexpected GUI, and unknown tool without sending input', async () => {
  const remote = await fixture(INTEGRATED + REMOTE);
  try {
    const result = await remote.call('tools/call', { name: 'minecraft_look', arguments: { yaw_delta: 3, pitch_delta: 0 } });
    assert.equal(result.result.isError, true);
    assert.equal(remote.seen.some((entry) => entry.method === 'POST'), false);
  } finally { await remote.close(); }

  const local = await fixture(INTEGRATED);
  try {
    const oversized = await local.call('tools/call', { name: 'minecraft_look', arguments: { yaw_delta: 20, pitch_delta: 0 } });
    assert.equal(oversized.result.isError, true);
    local.setScreen('net.minecraft.client.gui.screens.inventory.InventoryScreen');
    const gui = await local.call('tools/call', { name: 'minecraft_look', arguments: { yaw_delta: 3, pitch_delta: 0 } });
    assert.equal(gui.result.isError, true);
    const command = await local.call('tools/call', { name: 'minecraft_command', arguments: { command: '/op user' } });
    assert.equal(command.result.isError, true);
    assert.equal(local.seen.some((entry) => entry.method === 'POST'), false);
  } finally { await local.close(); }
});

test('camera tools are unavailable until explicitly enabled', async () => {
  const f = await fixture(INTEGRATED, false);
  try {
    const listed = await f.call('tools/list', {});
    assert.deepEqual(listed.result.tools, []);
    const refused = await f.call('tools/call', { name: 'minecraft_look', arguments: { yaw_delta: 3, pitch_delta: 0 } });
    assert.equal(refused.result.isError, true);
    assert.equal(f.seen.length, 0);
  } finally { await f.close(); }
});
