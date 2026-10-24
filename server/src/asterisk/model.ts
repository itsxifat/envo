import { many } from '../db.js';
import { getSettings, type Settings } from '../settings.js';
import { getAccountPlan } from '../billing/plan.js';

export interface Tenant {
  id: number;
  account_id: number;
  /** Concurrent external calls across every SIP server of the account (0 = unlimited); from the package. */
  account_max_channels: number;
  name: string;
  slug: string;
  enabled: boolean;
  max_channels: number;
  max_extensions: number;
  outbound_cid: string;
  recording: 'off' | 'inbound' | 'outbound' | 'all';
  timezone: string;
  language: string;
}

export interface Extension {
  id: number;
  tenant_id: number;
  number: string;
  name: string;
  sip_username: string;
  sip_password: string;
  webrtc: boolean;
  max_contacts: number;
  codecs: string;
  outbound_cid: string;
  allow_outbound: boolean;
  voicemail: boolean;
  voicemail_pin: string;
  email: string;
  recording: 'inherit' | 'off' | 'inbound' | 'outbound' | 'all';
  ring_timeout: number;
  dnd: boolean;
  forward_always: string;
  forward_busy: string;
  forward_noanswer: string;
  enabled: boolean;
}

export interface Trunk {
  id: number;
  tenant_id: number | null;
  name: string;
  host: string;
  port: number;
  transport: 'udp' | 'tcp' | 'tls';
  auth_mode: 'register' | 'outbound' | 'ip';
  username: string;
  auth_username: string;
  password: string;
  from_user: string;
  from_domain: string;
  contact_user: string;
  register_expiry: number;
  match_ips: string;
  codecs: string;
  dtmf_mode: string;
  max_channels: number;
  qualify: boolean;
  send_pai: boolean;
  outbound_proxy: string;
  default_dest_type: string;
  default_dest_target: string;
  enabled: boolean;
}

export interface PhoneNumber {
  id: number;
  tenant_id: number;
  trunk_id: number | null;
  number: string;
  label: string;
  max_channels: number;
  dest_type: string;
  dest_target: string;
  cid_prefix: string;
  recording: 'inherit' | 'off' | 'on';
  enabled: boolean;
}

export interface OutboundRoute {
  id: number;
  tenant_id: number;
  name: string;
  priority: number;
  patterns: string[];
  strip: number;
  prepend: string;
  callerid: string;
  trunk_ids: number[];
  enabled: boolean;
}

export interface Sound {
  id: number;
  tenant_id: number | null;
  name: string;
}

export interface IvrOption {
  digit: string;
  dest_type: string;
  dest_target: string;
}

export interface Ivr {
  id: number;
  tenant_id: number;
  name: string;
  number: string;
  greeting_sound_id: number | null;
  timeout: number;
  max_retries: number;
  direct_dial: boolean;
  options: IvrOption[];
  timeout_dest_type: string;
  timeout_dest_target: string;
  invalid_dest_type: string;
  invalid_dest_target: string;
}

export interface RingGroup {
  id: number;
  tenant_id: number;
  name: string;
  number: string;
  strategy: 'ringall' | 'hunt';
  members: string[];
  ring_time: number;
  cid_prefix: string;
  failover_dest_type: string;
  failover_dest_target: string;
}

export interface Queue {
  id: number;
  tenant_id: number;
  name: string;
  number: string;
  strategy: string;
  members: string[];
  agent_timeout: number;
  max_wait: number;
  wrapup: number;
  announce_position: boolean;
  join_sound_id: number | null;
  failover_dest_type: string;
  failover_dest_target: string;
}

export interface TimeRule {
  days: string[];
  start: string;
  end: string;
}

export interface Holiday {
  date: string;
  name?: string;
}

export interface TimeCondition {
  id: number;
  tenant_id: number;
  name: string;
  mode: 'auto' | 'open' | 'closed';
  rules: TimeRule[];
  holidays: Holiday[];
  match_dest_type: string;
  match_dest_target: string;
  nomatch_dest_type: string;
  nomatch_dest_target: string;
}

export interface BlockedNumber {
  id: number;
  tenant_id: number;
  number: string;
  match: 'exact' | 'prefix' | 'anonymous';
}

export interface Conference {
  id: number;
  tenant_id: number;
  name: string;
  number: string;
  pin: string;
  max_members: number;
  announce_join: boolean;
}

export interface Model {
  settings: Settings;
  blocked: BlockedNumber[];
  conferences: Conference[];
  tenants: Tenant[];
  extensions: Extension[];
  trunks: Trunk[];
  numbers: PhoneNumber[];
  routes: OutboundRoute[];
  sounds: Sound[];
  ivrs: Ivr[];
  ringGroups: RingGroup[];
  queues: Queue[];
  timeConditions: TimeCondition[];
}

export async function loadModel(): Promise<Model> {
  const [settings, tenants, extensions, trunks, numbers, routes, sounds, ivrs, ringGroups, queues, timeConditions, blocked, conferences] =
    await Promise.all([
      getSettings(),
      many<Tenant>('SELECT * FROM tenants ORDER BY id'),
      many<Extension>('SELECT * FROM extensions ORDER BY tenant_id, number'),
      many<Trunk>('SELECT * FROM trunks ORDER BY id'),
      many<PhoneNumber>('SELECT * FROM numbers ORDER BY id'),
      many<OutboundRoute>('SELECT * FROM outbound_routes ORDER BY tenant_id, priority, id'),
      many<Sound>('SELECT id, tenant_id, name FROM sounds ORDER BY id'),
      many<Ivr>('SELECT * FROM ivrs ORDER BY id'),
      many<RingGroup>('SELECT * FROM ring_groups ORDER BY id'),
      many<Queue>('SELECT * FROM queues ORDER BY id'),
      many<TimeCondition>('SELECT * FROM time_conditions ORDER BY id'),
      many<BlockedNumber>('SELECT id, tenant_id, number, match FROM blocked_numbers ORDER BY id'),
      many<Conference>('SELECT * FROM conferences ORDER BY id'),
    ]);
  await applyPlans(tenants, extensions, numbers);
  // Envo Phone calls out from a balance: once it is used up, calls out stop (calls in still ring).
  const noBalance = new Set(
    (
      await many<{ id: number }>(
        `SELECT t.id FROM tenants t JOIN accounts a ON a.id = t.account_id AND a.kind = 'personal'
          WHERE COALESCE((SELECT sum(l.amount) FROM balance_ledger l WHERE l.account_id = a.id), 0) <= 0`,
      )
    ).map((t) => t.id),
  );
  for (const r of routes) if (noBalance.has(r.tenant_id)) r.enabled = false;
  return { settings, tenants, extensions, trunks, numbers, routes, sounds, ivrs, ringGroups, queues, timeConditions, blocked, conferences };
}

/**
 * The customer's package shapes what Asterisk gets: SIP servers of an account that is not active
 * (unpaid, suspended, no package) are switched off, recording is off unless the package includes it,
 * and every server carries the account-wide channel cap.
 */
async function applyPlans(tenants: Tenant[], extensions: Extension[], numbers: PhoneNumber[]): Promise<void> {
  const noRecording = new Set<number>();
  for (const accountId of new Set(tenants.map((t) => t.account_id))) {
    const plan = await getAccountPlan(accountId);
    for (const t of tenants.filter((x) => x.account_id === accountId)) {
      t.account_max_channels = plan.limits.max_channels ?? 0;
      if (!plan.usable || plan.limits.max_channels === 0) t.enabled = false;
      if (plan.limits.recording_days === 0) {
        t.recording = 'off';
        noRecording.add(t.id);
      }
    }
  }
  for (const e of extensions) if (noRecording.has(e.tenant_id) && e.recording !== 'inherit') e.recording = 'off';
  for (const n of numbers) if (noRecording.has(n.tenant_id) && n.recording === 'on') n.recording = 'off';
}

/** Asterisk sound path (no extension) for a stored sound. */
export function soundPath(sound: Pick<Sound, 'id' | 'tenant_id'>): string {
  return `envo/t${sound.tenant_id ?? 0}/snd${sound.id}`;
}

export function trunkEndpoint(trunk: Pick<Trunk, 'id'>): string {
  return `trunk_${trunk.id}`;
}

export function webEndpoint(ext: Pick<Extension, 'sip_username'>): string {
  return `${ext.sip_username}_web`;
}
