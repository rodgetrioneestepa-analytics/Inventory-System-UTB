import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function deploymentConfig(value) {
  if (!value)
    throw new Error('Set UTB_API_ORIGIN to the HTTPS origin of the persistent inventory backend.');
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('UTB_API_ORIGIN must be a valid HTTPS origin.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error(
      'UTB_API_ORIGIN must be an HTTPS origin without credentials, a path, query or fragment.',
    );
  }
  if (
    /^(localhost|127\.|0\.|\[?::1\]?)/i.test(origin.hostname) ||
    origin.hostname.endsWith('.localhost')
  ) {
    throw new Error(
      'UTB_API_ORIGIN must be a publicly reachable hosted backend, not this computer.',
    );
  }
  return {
    version: 3,
    routes: [
      {
        src: '^/api(?:/(.*))?$',
        dest: `${origin.origin}/api/$1`,
        headers: { 'Cache-Control': 'private, no-store' },
      },
      {
        src: '/(.*)',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'same-origin',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        },
        continue: true,
      },
      { handle: 'filesystem' },
      { src: '/assets/.*', status: 404 },
      { src: '/(.*)', dest: '/index.html' },
    ],
  };
}

export function buildVercel({ root = process.cwd(), apiOrigin = process.env.UTB_API_ORIGIN } = {}) {
  const config = deploymentConfig(apiOrigin);
  const frontend = resolve(root, 'dist/web');
  if (!existsSync(resolve(frontend, 'index.html')))
    throw new Error('Build the frontend before creating Vercel output.');
  const output = resolve(root, '.vercel/output');
  const staticOutput = resolve(output, 'static');
  const target = relative(resolve(root), staticOutput);
  if (
    target.startsWith('..') ||
    isAbsolute(target) ||
    target.replaceAll('\\', '/') !== '.vercel/output/static'
  )
    throw new Error('Unsafe deployment output path.');
  // This verified target is generated public output only; no application data is removed.
  rmSync(staticOutput, { recursive: true, force: true });
  mkdirSync(staticOutput, { recursive: true });
  // Copy only public frontend artifacts. Never include the SQLite database or environment files.
  cpSync(frontend, staticOutput, { recursive: true });
  writeFileSync(resolve(output, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = buildVercel();
  console.info(
    `Vercel frontend prepared. Inventory API proxy: ${new URL(config.routes[0].dest).origin}`,
  );
}
