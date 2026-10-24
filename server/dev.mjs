// Local development: `npm run dev` here, `npm run dev` in ../web, open http://localhost:5173.
// Starts Postgres in Docker (container envo-dev-pg, port 54329), rebuilds the server on every change
// and restarts it. Asterisk is not needed - the AMI client just keeps retrying - and generated
// configs, sounds and recordings go to ../.dev/ instead of /etc/asterisk and /var.
// First start: open the one-time /setup link printed in the log to create the platform admin.
import { context } from 'esbuild';
import { copyFaceAssets } from './face-assets.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '.dev');
const PG = { name: 'envo-dev-pg', port: 54329 };

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ensurePostgres() {
  const state = (() => {
    try {
      return docker('inspect', '-f', '{{.State.Running}}', PG.name);
    } catch {
      return 'missing';
    }
  })();
  if (state === 'missing') {
    console.log('[dev] creating Postgres container');
    docker('run', '-d', '--name', PG.name, '-e', 'POSTGRES_USER=envo', '-e', 'POSTGRES_PASSWORD=envo', '-e', 'POSTGRES_DB=envo',
      '-p', `127.0.0.1:${PG.port}:5432`, '-v', `${PG.name}:/var/lib/postgresql`, 'postgres:18');
  } else if (state !== 'true') {
    docker('start', PG.name);
  }
  for (let i = 0; i < 60; i++) {
    try {
      docker('exec', PG.name, 'pg_isready', '-U', 'envo', '-d', 'envo');
      return;
    } catch {
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
    }
  }
  throw new Error('Postgres did not become ready');
}

const dirs = { conf: 'asterisk', sounds: 'sounds', monitor: 'monitor', voicemail: 'voicemail', data: 'data' };
for (const d of Object.values(dirs)) mkdirSync(path.join(root, d), { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '4310',
  HOST: '127.0.0.1',
  DATABASE_URL: `postgresql://envo:envo@127.0.0.1:${PG.port}/envo`,
  JWT_SECRET: 'dev-only-not-a-secret',
  COOKIE_SECURE: 'false',
  PUBLIC_HOST: 'localhost',
  PUBLIC_URL: 'http://localhost:5173',
  SIP_DOMAIN: 'localhost',
  AMI_SECRET: 'dev',
  ASTERISK_CONF_DIR: path.join(root, dirs.conf),
  ASTERISK_SOUNDS_DIR: path.join(root, dirs.sounds),
  ASTERISK_MONITOR_DIR: path.join(root, dirs.monitor),
  ASTERISK_VOICEMAIL_DIR: path.join(root, dirs.voicemail),
  ENVO_DATA_DIR: path.join(root, dirs.data),
  FFMPEG_PATH: 'ffmpeg',
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ENVO_DEV_'))),
};

ensurePostgres();

let child = null;
const restart = () => {
  if (child) child.kill();
  child = spawn(process.execPath, ['--enable-source-maps', 'dist/index.mjs'], { env, stdio: 'inherit' });
};

copyFaceAssets();
const ctx = await context({
  // The face worker runs in a thread of its own, next to the face models it loads.
  entryPoints: { index: 'src/index.ts', 'faces/worker': 'src/phone/faceWorker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  loader: { '.sql': 'text', '.conf': 'text' },
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __envoCreateRequire } from 'node:module'; import { fileURLToPath as __envoFileURLToPath } from 'node:url'; const require = __envoCreateRequire(import.meta.url); const __filename = __envoFileURLToPath(import.meta.url); const __dirname = __filename.slice(0, __filename.lastIndexOf('/'));",
  },
  logLevel: 'warning',
  plugins: [
    {
      name: 'restart',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return;
          console.log('[dev] server rebuilt, restarting');
          restart();
        });
      },
    },
  ],
});
await ctx.watch();
process.on('SIGINT', () => {
  child?.kill();
  process.exit(0);
});
