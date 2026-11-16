import 'dotenv/config';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  watchFile,
  unwatchFile,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export function httpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Provide a valid HTTPS website origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use an HTTPS origin without credentials, a path, query or fragment.');
  return url.origin;
}

const local = resolve('.local');
const originFile = resolve(local, 'tunnel-origin.txt');
const stateFile = resolve(local, 'tunnel-state.json');
const controlFile = resolve(local, 'tunnel-control.json');
const port = 3002;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function start() {
  mkdirSync(local, { recursive: true });
  if (!existsSync(resolve('dist/server/index.js'))) throw new Error('Build the application first.');
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`Port ${port} is already in use; no existing process was changed.`);
  } catch (error) {
    if (error.message.startsWith('Port ')) throw error;
  }
  const executable =
    process.env.CLOUDFLARED_PATH ||
    (process.platform === 'win32' ? resolve('.local/bin/cloudflared.exe') : 'cloudflared');
  const sessionId = randomUUID();
  let backend,
    tunnelUrl,
    stopping = false,
    starting = false;
  let frontendOrigin = existsSync(originFile)
    ? httpsOrigin(readFileSync(originFile, 'utf8').trim())
    : '';
  let restart = Promise.resolve();
  const tunnel = spawn(
    executable,
    ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  function record(status) {
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          session_id: sessionId,
          status,
          url: tunnelUrl,
          frontend_origin: frontendOrigin,
          port,
          pid: process.pid,
          backend_pid: backend?.pid,
          tunnel_pid: tunnel.pid,
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    unwatchFile(originFile);
    unwatchFile(controlFile);
    record('stopping');
    backend?.kill();
    tunnel.kill();
    await delay(500);
    record('stopped');
    process.exit(code);
  }
  async function launchBackend() {
    const previous = backend;
    backend = undefined;
    if (previous && previous.exitCode === null) {
      previous.kill();
      await Promise.race([new Promise((resolve) => previous.once('exit', resolve)), delay(3000)]);
    }
    const child = spawn(process.execPath, [resolve('dist/server/index.js')], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'production',
        DATABASE_PATH: process.env.DATABASE_PATH || resolve('data/utb.sqlite'),
        APP_ORIGIN: [tunnelUrl, frontendOrigin].filter(Boolean).join(','),
      },
    });
    backend = child;
    child.stdout.on('data', (data) => process.stdout.write(data));
    child.stderr.on('data', (data) => process.stderr.write(data));
    child.on('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    child.on('exit', (code) => {
      if (backend === child && !stopping) {
        console.error(`Public backend stopped (${code}).`);
        stop(1);
      }
    });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(250);
    }
    if (!ready) throw new Error('The public backend did not become ready.');
    record('running');
    console.info(`Temporary HTTPS backend: ${tunnelUrl}`);
    if (frontendOrigin) console.info(`Authorized frontend: ${frontendOrigin}`);
    console.info('Database remains on this computer. Keep this process and computer running.');
  }
  let buffer = '';
  function tunnelOutput(data) {
    process.stdout.write(data);
    buffer = (buffer + data.toString()).slice(-20000);
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
    if (match && !starting) {
      starting = true;
      tunnelUrl = match[0];
      restart = restart.then(launchBackend).catch((error) => {
        console.error(error.message);
        stop(1);
      });
    }
  }
  tunnel.stdout.on('data', tunnelOutput);
  tunnel.stderr.on('data', tunnelOutput);
  tunnel.on('error', (error) => {
    console.error(`Cloudflare tunnel could not start: ${error.message}`);
    stop(1);
  });
  tunnel.on('exit', (code) => {
    if (!stopping) {
      console.error(`Tunnel stopped (${code}).`);
      stop(1);
    }
  });
  watchFile(originFile, { interval: 1000 }, () => {
    try {
      if (!existsSync(originFile)) return;
      const value = httpsOrigin(readFileSync(originFile, 'utf8').trim());
      if (value === frontendOrigin) return;
      frontendOrigin = value;
      if (tunnelUrl)
        restart = restart.then(launchBackend).catch((error) => {
          console.error(error.message);
          stop(1);
        });
    } catch (error) {
      console.error(error.message);
    }
  });
  watchFile(controlFile, { interval: 1000 }, () => {
    try {
      const command = JSON.parse(readFileSync(controlFile, 'utf8'));
      if (command.session_id === sessionId && command.action === 'stop') stop();
    } catch {}
  });
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  setTimeout(() => {
    if (!tunnelUrl && !stopping) {
      console.error('Tunnel URL was not available within 45 seconds.');
      stop(1);
    }
  }, 45000).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  mkdirSync(local, { recursive: true });
  if (process.argv[2] === '--set-frontend-origin') {
    writeFileSync(originFile, httpsOrigin(process.argv[3]) + '\n');
    console.info(
      'Frontend origin saved. The running tunnel restarts only its public backend to apply it.',
    );
  } else if (process.argv[2] === '--stop') {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    writeFileSync(controlFile, JSON.stringify({ session_id: state.session_id, action: 'stop' }));
    console.info('Stop requested for this workspace tunnel.');
  } else await start();
}
