import { readFile, lstat } from 'node:fs/promises';

const delay = Number(process.env.MINECRAFT_WATCHDOG_DELAY_MS ?? 1200);
const tokenFile = process.env.MINECRAFT_BRIDGE_TOKEN_FILE;
const url = new URL(process.env.MINECRAFT_BRIDGE_URL ?? 'http://127.0.0.1:38121');

if (!Number.isInteger(delay) || delay < 500 || delay > 3000 || !tokenFile || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') process.exit(1);

await new Promise((resolve) => setTimeout(resolve, delay));
try {
  const info = await lstat(tokenFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Invalid token file');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9._~-]{32,512}$/.test(token)) throw new Error('Invalid token');
  await fetch(`${url.origin}/control/release-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  });
} catch {
  // Best-effort independent cleanup. The main action path also releases inputs.
}
