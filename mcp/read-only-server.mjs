import { readFile, lstat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,512}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BRIDGE_ORIGIN = bridgeOrigin(process.env.MINECRAFT_BRIDGE_URL ?? 'http://127.0.0.1:38121');
const TOKEN_FILE = process.env.MINECRAFT_BRIDGE_TOKEN_FILE;

const TOOLS = [
  {
    name: 'minecraft_status',
    description: 'Read current Minecraft client and bridge status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'minecraft_state',
    description: 'Read player, world, inventory, crosshair and nearby-entity state.',
    inputSchema: {
      type: 'object',
      properties: { radius: { type: 'number', minimum: 0, maximum: 16 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'minecraft_screen',
    description: 'Read current GUI, widgets and container slots.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'minecraft_frame',
    description: 'Capture the currently displayed Minecraft frame as a PNG image.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

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

async function request(path, maxBytes) {
  const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Minecraft bridge returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Minecraft bridge response is too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('Minecraft bridge response is too large');
  return bytes;
}

async function jsonTool(path) {
  const bytes = await request(path, MAX_JSON_BYTES);
  const data = JSON.parse(bytes.toString('utf8'));
  return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false };
}

function emptyArgs(args) {
  if (args === undefined || (args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0)) return;
  throw new Error('This tool takes no arguments');
}

async function callTool(name, args) {
  if (name === 'minecraft_status') {
    emptyArgs(args);
    return jsonTool('/control/status');
  }
  if (name === 'minecraft_state') {
    if (args === undefined) args = {};
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => key !== 'radius')) {
      throw new Error('Invalid state arguments');
    }
    const radius = args.radius ?? 8;
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > 16) {
      throw new Error('radius must be between 0 and 16');
    }
    return jsonTool(`/control/state?radius=${radius}`);
  }
  if (name === 'minecraft_screen') {
    emptyArgs(args);
    return jsonTool('/control/screen');
  }
  if (name === 'minecraft_frame') {
    emptyArgs(args);
    const bytes = await request('/control/frame', MAX_FRAME_BYTES);
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('Minecraft bridge did not return PNG');
    return { content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }], isError: false };
  }
  throw new Error('Unknown tool');
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
      result = { protocolVersion: message.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hermes-minecraft-read-only', version: '0.1.0' } };
    } else if (message.method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (message.method === 'tools/call') {
      result = await callTool(message.params?.name, message.params?.arguments);
    } else {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    // Tool errors contain no response body or token; they can be shown to the model safely.
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: String(error.message || 'Bridge error') }], isError: true } });
  }
}

let pending = Buffer.alloc(0);
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
    if (line.length) void handle(line.toString('utf8'));
  }
  if (pending.length > MAX_LINE_BYTES) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Line too large' } });
    process.exitCode = 1;
    process.stdin.pause();
  }
});
