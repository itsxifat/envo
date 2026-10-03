import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { many } from '../db.js';
import { ami } from './pbx.js';
import { loadModel, type Extension } from './model.js';
import { generate, type EndpointInfo } from './generator.js';

export interface ApplyStatus {
  state: 'idle' | 'applying' | 'error';
  lastAppliedAt: string | null;
  lastChanged: string[];
  error: string | null;
  warnings: string[];
  endpointsExpected: number;
  endpointsLoaded: number | null;
  pendingReload: boolean;
}

/** Endpoint name -> owner, refreshed on every apply. Used to attribute live state to tenants. */
export let endpointDirectory = new Map<string, EndpointInfo>();
export let registrationDirectory = new Map<string, { trunkId: number; tenantId: number | null }>();
export let numberDirectory = new Map<number, number>();

export const applyEvents = new EventEmitter();

const status: ApplyStatus = {
  state: 'idle',
  lastAppliedAt: null,
  lastChanged: [],
  error: null,
  warnings: [],
  endpointsExpected: 0,
  endpointsLoaded: null,
  pendingReload: false,
};

const RELOAD_COMMANDS: Record<string, string> = {
  'pjsip_envo.conf': 'module reload res_pjsip.so',
  'extensions_envo.conf': 'dialplan reload',
  'extensions_envo_lib.conf': 'dialplan reload',
  'voicemail_envo.conf': 'module reload app_voicemail.so',
  'queues_envo.conf': 'module reload app_queue.so',
};

const pendingReloads = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<ApplyStatus> | null = null;
let rerun = false;

/** Queues an Asterisk reload that runs on the next apply or AMI (re)connect. */
export function queueReload(command: string): void {
  pendingReloads.add(command);
}

export function getApplyStatus(): ApplyStatus {
  return { ...status, pendingReload: pendingReloads.size > 0 };
}

function emitStatus(): void {
  applyEvents.emit('status', getApplyStatus());
}

/** Debounced: many rapid dashboard edits collapse into one generate + reload. */
export function scheduleApply(delayMs = 400): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void applyNow();
  }, delayMs);
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, { mode: 0o640 });
  await fs.rename(tmp, file);
}

export async function applyNow(force = false): Promise<ApplyStatus> {
  if (inFlight) {
    // Callers rely on the directories being populated when this resolves, so wait for the
    // running apply; a follow-up run picks up whatever changed meanwhile.
    rerun = true;
    await inFlight;
    return getApplyStatus();
  }
  inFlight = runApply(force);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
    if (rerun) {
      rerun = false;
      scheduleApply(50);
    }
  }
}

async function runApply(force: boolean): Promise<ApplyStatus> {
  status.state = 'applying';
  emitStatus();
  try {
    const model = await loadModel();
    const generated = generate(model);
    endpointDirectory = generated.endpoints;
    registrationDirectory = generated.registrations;
    numberDirectory = generated.numbers;
    status.warnings = generated.warnings;
    status.endpointsExpected = [...generated.endpoints.values()].length;

    await fs.mkdir(config.paths.confDir, { recursive: true });
    const changed: string[] = [];
    for (const [name, content] of Object.entries(generated.files)) {
      const file = path.join(config.paths.confDir, name);
      const current = await fs.readFile(file, 'utf8').catch(() => null);
      if (current !== content) {
        await writeAtomic(file, content);
        changed.push(name);
      }
      if (current !== content || force) {
        const cmd = RELOAD_COMMANDS[name];
        if (cmd) pendingReloads.add(cmd);
      }
    }
    status.lastChanged = changed;
    await runPendingReloads();
    status.state = 'idle';
    status.error = null;
    status.lastAppliedAt = new Date().toISOString();
  } catch (err) {
    status.state = 'error';
    status.error = err instanceof Error ? err.message : String(err);
    console.error('[apply] failed:', err);
  } finally {
    emitStatus();
  }
  return getApplyStatus();
}

/** Runs queued reload commands; if Asterisk is down they stay queued until AMI reconnects. */
export async function runPendingReloads(): Promise<void> {
  if (!ami.connected || pendingReloads.size === 0) return;
  const commands = [...pendingReloads];
  // Dialplan last: it references endpoints that the PJSIP reload creates.
  commands.sort((a, b) => Number(a.startsWith('dialplan')) - Number(b.startsWith('dialplan')));
  for (const cmd of commands) {
    const out = await ami.command(cmd, 30_000);
    pendingReloads.delete(cmd);
    if (/fail|error|not found/i.test(out)) console.warn(`[apply] ${cmd}: ${out.trim()}`);
  }
  if (commands.some((c) => c.includes('res_pjsip'))) await verifyEndpoints();
}

export async function verifyEndpoints(): Promise<void> {
  try {
    const list = await ami.list({ Action: 'PJSIPShowEndpoints' });
    const loaded = new Set(list.map((e) => e.ObjectName as string));
    let count = 0;
    const missing: string[] = [];
    for (const name of endpointDirectory.keys()) {
      if (loaded.has(name)) count++;
      else missing.push(name);
    }
    status.endpointsLoaded = count;
    if (missing.length) {
      status.warnings = [
        ...status.warnings.filter((w) => !w.startsWith('Asterisk did not load')),
        `Asterisk did not load ${missing.length} endpoint(s): ${missing.slice(0, 5).join(', ')} - check the Asterisk log`,
      ];
    }
  } catch (err) {
    console.warn('[apply] endpoint verification failed:', err);
  }
}

// ------------------------------------------------------------------ AstDB
// Runtime call state that phones can also change with feature codes (DND, call forwarding)
// lives in Asterisk's internal database; Postgres stays the source of truth.

const ASTDB_KEYS: Array<[keyof Extension, string]> = [
  ['forward_always', 'cfu'],
  ['forward_busy', 'cfb'],
  ['forward_noanswer', 'cfna'],
];

export async function syncExtensionState(ext: Extension): Promise<void> {
  if (!ami.connected) return;
  const family = `envo/t${ext.tenant_id}/${ext.number}`;
  // Clearing the whole family (quietly) and re-adding what is set avoids per-key "does not exist" warnings.
  await ami.action({ Action: 'DBDelTree', Family: family }).catch(() => undefined);
  const put = (key: string, val: string) => ami.action({ Action: 'DBPut', Family: family, Key: key, Val: val });
  if (ext.dnd) await put('dnd', '1');
  for (const [field, key] of ASTDB_KEYS) {
    const value = String(ext[field] ?? '');
    if (/^\+?[0-9*#]{1,32}$/.test(value)) await put(key, value);
  }
}

export async function clearExtensionState(tenantId: number, number: string): Promise<void> {
  if (!ami.connected) return;
  await ami.action({ Action: 'DBDelTree', Family: `envo/t${tenantId}/${number}` }).catch(() => undefined);
}

export async function syncAllExtensionState(): Promise<void> {
  const exts = await many<Extension>('SELECT * FROM extensions');
  for (const ext of exts) await syncExtensionState(ext);
}
