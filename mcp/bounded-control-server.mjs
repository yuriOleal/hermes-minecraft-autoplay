import { readFile, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,512}$/;
const BRIDGE_ORIGIN = bridgeOrigin(process.env.MINECRAFT_BRIDGE_URL ?? 'http://127.0.0.1:38121');
const TOKEN_FILE = process.env.MINECRAFT_BRIDGE_TOKEN_FILE;
const CLIENT_LOG_FILE = process.env.MINECRAFT_CLIENT_LOG_FILE;
const BARITONE_SETTINGS_FILE = process.env.MINECRAFT_BARITONE_SETTINGS_FILE;
const ENABLED = process.env.MINECRAFT_ENABLE_SINGLEPLAYER_CONTROL === '1';
const WATCHDOG = fileURLToPath(new URL('./release-watchdog.mjs', import.meta.url));
const WATCHDOG_DELAY_MS = Number(process.env.MINECRAFT_WATCHDOG_DELAY_MS ?? 1200);
const NAVIGATION_TIMEOUT_MS = Number(process.env.MINECRAFT_NAVIGATION_TIMEOUT_MS ?? 2000);
let stopped = false;
let navigationUsed = false;

const TOOLS = ENABLED ? [
  {
    name: 'minecraft_look',
    description: 'Turn the camera up to 5 degrees on each axis in the active single-player world; verify the result. No movement, clicks, chat or commands.',
    inputSchema: {
      type: 'object',
      properties: {
        yaw_delta: { type: 'number', minimum: -5, maximum: 5 },
        pitch_delta: { type: 'number', minimum: -5, maximum: 5 },
      },
      required: ['yaw_delta', 'pitch_delta'],
      additionalProperties: false,
    },
  },
  {
    name: 'minecraft_step_forward',
    description: 'Hold forward for 50 to 200 ms in an unpaused single-player world; release all synthetic inputs and report distance moved. Use only in a clear, safe area.',
    inputSchema: {
      type: 'object',
      properties: { duration_ms: { type: 'integer', minimum: 50, maximum: 200 } },
      required: ['duration_ms'],
      additionalProperties: false,
    },
  },
  {
    name: 'minecraft_navigate_nearby',
    description: 'Ask Baritone to navigate at most one block in X and Z in the active single-player test world, then stop and verify. One navigation call per MCP process.',
    inputSchema: {
      type: 'object',
      properties: {
        dx: { type: 'integer', minimum: -1, maximum: 1 },
        dz: { type: 'integer', minimum: -1, maximum: 1 },
      },
      required: ['dx', 'dz'],
      additionalProperties: false,
    },
  },
  {
    name: 'minecraft_stop',
    description: 'Release synthetic inputs and permanently disable actions for this MCP process.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] : [];

function bridgeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('MINECRAFT_BRIDGE_URL must be a numeric 127.0.0.1 HTTP origin with a port');
  }
  return url.origin;
}

async function token() {
  if (!TOKEN_FILE) throw new Error('MINECRAFT_BRIDGE_TOKEN_FILE is not configured');
  const info = await lstat(TOKEN_FILE);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Bridge token file is invalid');
  const value = (await readFile(TOKEN_FILE, 'utf8')).trim();
  if (!TOKEN_PATTERN.test(value)) throw new Error('Bridge token file is invalid');
  return value;
}

async function request(path, method = 'GET', body) {
  const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Minecraft bridge returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('Minecraft bridge response is too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_JSON_BYTES) throw new Error('Minecraft bridge response is too large');
  return JSON.parse(bytes.toString('utf8'));
}

async function assertSingleplayer() {
  if (!CLIENT_LOG_FILE) throw new Error('MINECRAFT_CLIENT_LOG_FILE is not configured');
  const info = await lstat(CLIENT_LOG_FILE);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error('Minecraft client log is invalid');
  const log = await readFile(CLIENT_LOG_FILE, 'utf8');
  const events = [...log.matchAll(/^.*(?:\[net\.minecraft\.client\.server\.IntegratedServer\/\]: Starting integrated minecraft server|\[net\.minecraft\.client\.gui\.screens\.ConnectScreen\/\]: Connecting to|\[net\.minecraft\.server\.MinecraftServer\/\]: Stopping server).*$/gm)];
  if (!events.length || !events.at(-1)[0].includes('Starting integrated minecraft server')) {
    throw new Error('Current client session is not confirmed single-player');
  }
}

function checkedArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 2 || !Object.hasOwn(args, 'yaw_delta') || !Object.hasOwn(args, 'pitch_delta')) {
    throw new Error('Expected yaw_delta and pitch_delta only');
  }
  for (const value of [args.yaw_delta, args.pitch_delta]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 5) throw new Error('Each camera delta must be within 5 degrees');
  }
  if (args.yaw_delta === 0 && args.pitch_delta === 0) throw new Error('At least one camera delta must be nonzero');
  return args;
}

function angleDelta(after, before) {
  let delta = after - before;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

async function look(args) {
  if (!ENABLED || stopped) throw new Error('Camera control is disabled');
  const { yaw_delta, pitch_delta } = checkedArgs(args);
  await assertSingleplayer();
  const before = await request('/control/status');
  if (!before.in_world || !before.player?.present || !Number.isFinite(before.player.yaw) || !Number.isFinite(before.player.pitch)) throw new Error('Player is not in a world');
  if (before.screen?.present && before.screen.class !== 'net.minecraft.client.gui.screens.PauseScreen') throw new Error('Unexpected screen is open');
  if (before.player.pitch + pitch_delta < -90 || before.player.pitch + pitch_delta > 90) throw new Error('Camera pitch would be clamped');
  await assertSingleplayer();
  try {
    const action = await request('/control/look', 'POST', { yaw: yaw_delta, pitch: pitch_delta, relative: true });
    if (!action.ok) throw new Error('Camera action failed');
    const after = await request('/control/status');
    const observedYaw = angleDelta(after.player?.yaw, before.player.yaw);
    const observedPitch = after.player?.pitch - before.player.pitch;
    if (!after.in_world || !Number.isFinite(observedYaw) || !Number.isFinite(observedPitch) || Math.abs(observedYaw - yaw_delta) > 0.25 || Math.abs(observedPitch - pitch_delta) > 0.25) {
      throw new Error('Camera result did not match the requested turn');
    }
    return { observed_yaw_delta: observedYaw, observed_pitch_delta: observedPitch };
  } catch (error) {
    stopped = true;
    throw error;
  }
}

function startWatchdog() {
  if (!Number.isInteger(WATCHDOG_DELAY_MS) || WATCHDOG_DELAY_MS < 500 || WATCHDOG_DELAY_MS > 3000) throw new Error('Invalid watchdog delay');
  const child = spawn(process.execPath, [WATCHDOG], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      MINECRAFT_BRIDGE_URL: BRIDGE_ORIGIN,
      MINECRAFT_BRIDGE_TOKEN_FILE: TOKEN_FILE,
      MINECRAFT_WATCHDOG_DELAY_MS: String(WATCHDOG_DELAY_MS),
    },
  });
  child.unref();
  return once(child, 'spawn');
}

async function stepForward(args) {
  if (!ENABLED || stopped) throw new Error('Movement control is disabled');
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || !Number.isInteger(args.duration_ms) || args.duration_ms < 50 || args.duration_ms > 200) {
    throw new Error('duration_ms must be an integer from 50 to 200');
  }
  await assertSingleplayer();
  const before = await request('/control/status');
  if (!before.in_world || !before.player?.present || before.screen?.present || !['x', 'y', 'z'].every((axis) => Number.isFinite(before.player[axis]))) {
    throw new Error('Movement requires an unpaused world and a valid player position');
  }
  if (before.held_mappings?.includes('key.forward')) throw new Error('Forward key is already held');
  await assertSingleplayer();
  await startWatchdog();
  let actionError;
  try {
    await request('/control/key', 'POST', { mapping: 'key.forward', action: 'down' });
    await delay(args.duration_ms);
  } catch (error) {
    actionError = error;
  } finally {
    try { await request('/control/key', 'POST', { mapping: 'key.forward', action: 'up' }); } catch (error) { actionError ??= error; }
    try { await request('/control/release-all', 'POST', {}); } catch (error) { actionError ??= error; }
  }
  if (actionError) { stopped = true; throw actionError; }
  const after = await request('/control/status');
  if (!after.in_world || !after.player?.present || after.held_mappings?.includes('key.forward')) {
    stopped = true;
    throw new Error('Movement verification failed');
  }
  const distance = Math.hypot(...['x', 'y', 'z'].map((axis) => after.player[axis] - before.player[axis]));
  if (!Number.isFinite(distance)) { stopped = true; throw new Error('Movement distance is invalid'); }
  return { distance_moved: distance, released: true };
}

async function assertBaritoneSettings() {
  if (!BARITONE_SETTINGS_FILE) throw new Error('Baritone settings file is not configured');
  const info = await lstat(BARITONE_SETTINGS_FILE);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Baritone settings file is invalid');
  const settings = await readFile(BARITONE_SETTINGS_FILE, 'utf8');
  for (const name of ['allowBreak', 'allowPlace']) {
    const entries = settings.split(/\r?\n/).filter((line) => line.trim().startsWith(`${name} `));
    if (entries.length !== 1 || entries[0].trim() !== `${name} false`) throw new Error(`${name} must be false for navigation`);
  }
}

async function waitForScreen(expectedClass) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const status = await request('/control/status');
    if (expectedClass ? status.screen?.class === expectedClass : !status.screen?.present) return status;
    await delay(100);
  }
  throw new Error('Minecraft screen did not reach the expected state');
}

async function baritoneCommand(command) {
  await assertSingleplayer();
  const status = await request('/control/status');
  if (!status.in_world) throw new Error('Player left the world');
  if (!status.screen?.present) {
    await request('/control/key', 'POST', { mapping: 'key.chat', action: 'click' });
    await waitForScreen('net.minecraft.client.gui.screens.ChatScreen');
  } else if (status.screen.class !== 'net.minecraft.client.gui.screens.ChatScreen') {
    throw new Error('Unexpected screen prevents Baritone command');
  }
  const sent = await request('/control/text', 'POST', { text: command, submit: true });
  if (!sent.submitted) throw new Error('Baritone command was not submitted');
  await waitForScreen(null);
}

async function navigateNearby(args) {
  if (!ENABLED || stopped || navigationUsed) throw new Error('Navigation is disabled or already used');
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 2 ||
      !Number.isInteger(args.dx) || !Number.isInteger(args.dz) ||
      Math.abs(args.dx) > 1 || Math.abs(args.dz) > 1 || (args.dx === 0 && args.dz === 0)) {
    throw new Error('dx and dz must be integers from -1 to 1, with at least one nonzero');
  }
  if (!Number.isInteger(NAVIGATION_TIMEOUT_MS) || NAVIGATION_TIMEOUT_MS < 200 || NAVIGATION_TIMEOUT_MS > 3000) throw new Error('Invalid navigation timeout');
  await assertSingleplayer();
  await assertBaritoneSettings();
  const before = await request('/control/status');
  const state = await request('/control/state?radius=0');
  if (!before.in_world || !before.player?.present || before.screen?.present ||
      !Number.isFinite(before.player.x) || !Number.isFinite(before.player.z) ||
      !Number.isFinite(state.player?.health) || state.player.health !== state.player.max_health ||
      state.player.on_ground !== true || state.nearby?.total !== 0) {
    throw new Error('Navigation requires a healthy grounded player with no nearby entities or open screen');
  }
  await assertSingleplayer();
  navigationUsed = true;
  const x = Math.floor(before.player.x) + args.dx;
  const z = Math.floor(before.player.z) + args.dz;
  let actionError;
  try {
    await baritoneCommand(`#goto ${x} ${z}`);
    await delay(NAVIGATION_TIMEOUT_MS);
  } catch (error) {
    actionError = error;
  } finally {
    // TODO(security): add an independent Baritone stop watchdog before unattended navigation.
    try { await baritoneCommand('#stop'); } catch (error) { actionError ??= error; }
    try { await request('/control/release-all', 'POST', {}); } catch (error) { actionError ??= error; }
  }
  if (actionError) { stopped = true; throw actionError; }
  await assertSingleplayer();
  const after = await request('/control/status');
  const afterState = await request('/control/state?radius=0');
  if (!after.in_world || !after.player?.present || after.screen?.present ||
      !Number.isFinite(after.player.x) || !Number.isFinite(after.player.z) ||
      (after.held_mappings?.length ?? 0) !== 0 ||
      !Number.isFinite(afterState.player?.health) || afterState.player.health < state.player.health) {
    stopped = true;
    throw new Error('Navigation result is unsafe or incomplete');
  }
  return {
    distance_moved: Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z),
    health: afterState.player.health,
    target: { x, z },
    stopped: true,
  };
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function emptyArgs(args) {
  if (args === undefined || (args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0)) return;
  throw new Error('This tool takes no arguments');
}

async function handle(line) {
  let message;
  try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } });
    return;
  }
  if (message.id === undefined) return;
  try {
    let result;
    if (message.method === 'initialize') {
      result = { protocolVersion: message.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hermes-minecraft-bounded-control', version: '0.1.0' } };
    } else if (message.method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (name === 'minecraft_stop' && ENABLED) {
        emptyArgs(message.params?.arguments);
        stopped = true;
        await request('/control/release-all', 'POST', {});
        result = { content: [{ type: 'text', text: JSON.stringify({ stopped: true }) }], isError: false };
      } else if (name === 'minecraft_look' && ENABLED) {
        result = { content: [{ type: 'text', text: JSON.stringify(await look(message.params?.arguments)) }], isError: false };
      } else if (name === 'minecraft_step_forward' && ENABLED) {
        result = { content: [{ type: 'text', text: JSON.stringify(await stepForward(message.params?.arguments)) }], isError: false };
      } else if (name === 'minecraft_navigate_nearby' && ENABLED) {
        result = { content: [{ type: 'text', text: JSON.stringify(await navigateNearby(message.params?.arguments)) }], isError: false };
      } else {
        throw new Error('Unknown tool');
      }
    } else {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: String(error.message || 'Bridge error') }], isError: true } });
  }
}

let pending = Buffer.alloc(0);
let queue = Promise.resolve();
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  for (;;) {
    const newline = pending.indexOf(10);
    if (newline < 0) break;
    const line = pending.subarray(0, newline);
    pending = pending.subarray(newline + 1);
    if (line.length > MAX_LINE_BYTES) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Line too large' } });
      continue;
    }
    if (line.length) queue = queue.then(() => handle(line.toString('utf8')));
  }
  if (pending.length > MAX_LINE_BYTES) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Line too large' } });
    process.exitCode = 1;
    process.stdin.pause();
  }
});
