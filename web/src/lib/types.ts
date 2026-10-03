export type Role = 'superadmin' | 'admin' | 'agent';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  tenantId: number | null;
  extensionId: number | null;
}

export type Recording = 'off' | 'inbound' | 'outbound' | 'all';

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  max_channels: number;
  max_extensions: number;
  outbound_cid: string;
  recording: Recording;
  timezone: string;
  language: string;
  extension_count?: number;
  number_count?: number;
  trunk_count?: number;
}

export interface Extension {
  id: number;
  tenant_id: number;
  number: string;
  name: string;
  sip_username: string;
  sip_password?: string;
  webrtc: boolean;
  max_contacts: number;
  codecs: string;
  outbound_cid: string;
  allow_outbound: boolean;
  voicemail: boolean;
  voicemail_pin?: string;
  email: string;
  recording: 'inherit' | Recording;
  ring_timeout: number;
  dnd: boolean;
  forward_always: string;
  forward_busy: string;
  forward_noanswer: string;
  enabled: boolean;
  provisioning?: {
    domain: string;
    server_ip: string;
    udp_port: number;
    tcp_port: number;
    tls_port: number;
    username: string;
    auth_username: string;
    password: string;
    voicemail_pin: string;
  };
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
  has_password?: boolean;
  from_user: string;
  from_domain: string;
  contact_user: string;
  register_expiry: number;
  match_ips: string;
  codecs: string;
  dtmf_mode: 'rfc4733' | 'inband' | 'info' | 'auto';
  max_channels: number;
  qualify: boolean;
  send_pai: boolean;
  outbound_proxy: string;
  default_dest_type: DestType;
  default_dest_target: string;
  enabled: boolean;
  endpoint?: string;
  registration?: { status: string; nextRegSec: number | null } | null;
  reachability?: { status: string; rttMs: number | null } | null;
}

export type DestType = 'extension' | 'voicemail' | 'ring_group' | 'queue' | 'ivr' | 'time_condition' | 'conference' | 'external' | 'hangup';

export interface BlockedNumber {
  id: number;
  number: string;
  match: 'exact' | 'prefix' | 'anonymous';
  note: string;
  created_at: string;
}

export interface Conference {
  id: number;
  name: string;
  number: string;
  pin: string;
  max_members: number;
  announce_join: boolean;
}

export interface Voice {
  id: string;
  label: string;
  language: string;
}

export interface PhoneNumber {
  id: number;
  tenant_id: number;
  trunk_id: number | null;
  trunk_name?: string | null;
  number: string;
  label: string;
  max_channels: number;
  dest_type: DestType;
  dest_target: string;
  cid_prefix: string;
  recording: 'inherit' | 'off' | 'on';
  enabled: boolean;
}

export interface OutboundRoute {
  id: number;
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
  source: string;
  duration_ms: number;
  created_at: string;
}

export interface IvrOption {
  digit: string;
  dest_type: DestType;
  dest_target: string;
}

export interface Ivr {
  id: number;
  name: string;
  number: string;
  greeting_sound_id: number | null;
  timeout: number;
  max_retries: number;
  direct_dial: boolean;
  options: IvrOption[];
  timeout_dest_type: DestType;
  timeout_dest_target: string;
  invalid_dest_type: DestType;
  invalid_dest_target: string;
}

export interface RingGroup {
  id: number;
  name: string;
  number: string;
  strategy: 'ringall' | 'hunt';
  members: string[];
  ring_time: number;
  cid_prefix: string;
  failover_dest_type: DestType;
  failover_dest_target: string;
}

export interface Queue {
  id: number;
  name: string;
  number: string;
  strategy: 'ringall' | 'leastrecent' | 'fewestcalls' | 'random' | 'rrmemory' | 'linear';
  members: string[];
  agent_timeout: number;
  max_wait: number;
  wrapup: number;
  announce_position: boolean;
  join_sound_id: number | null;
  failover_dest_type: DestType;
  failover_dest_target: string;
}

export interface TimeRule {
  days: string[];
  start: string;
  end: string;
}

export interface TimeCondition {
  id: number;
  name: string;
  mode: 'auto' | 'open' | 'closed';
  rules: TimeRule[];
  holidays: { date: string; name: string }[];
  match_dest_type: DestType;
  match_dest_target: string;
  nomatch_dest_type: DestType;
  nomatch_dest_target: string;
}

export interface AppUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  tenant_id: number | null;
  extension_id: number | null;
  enabled: boolean;
  last_login_at: string | null;
  extension_number?: string | null;
  tenant_name?: string | null;
}

export interface CallRow {
  linkedid: string;
  calldate: string;
  clid: string;
  src: string;
  dst: string;
  did: string | null;
  direction: 'inbound' | 'outbound' | 'internal' | null;
  answered: boolean;
  disposition: string;
  answered_channel: string;
  duration: number;
  billsec: number;
  record_id: number;
  has_recording: boolean;
  legs: number;
}

export interface VoicemailMessage {
  mailbox: string;
  folder: string;
  id: string;
  callerid: string;
  origtime: number;
  duration: number;
}

export interface LiveContact {
  endpoint: string;
  uri: string;
  status: string;
  rttMs: number | null;
  userAgent: string;
  via: string;
  expiresAt: number | null;
}

export interface LiveRegistration {
  name: string;
  status: string;
  serverUri: string;
  clientUri: string;
  nextRegSec: number | null;
}

export interface LiveChannel {
  name: string;
  uniqueid: string;
  linkedid: string;
  state: string;
  callerNum: string;
  callerName: string;
  connectedNum: string;
  connectedName: string;
  accountcode: string;
  context: string;
  exten: string;
  application: string;
  appData: string;
  startedAt: number;
  bridgeId: string;
  endpoint: string;
  tenantId: number | null;
}

export interface LiveExtState {
  exten: string;
  context: string;
  status: string;
  tenantId: number | null;
}

export interface AsteriskInfo {
  connected: boolean;
  version: string;
  startedAt: string | null;
  reloadedAt: string | null;
  currentCalls: number;
}

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

export interface Settings {
  sip_domain: string;
  public_ip: string;
  country_code: string;
  national_prefix: string;
  stun_server: string;
  company_name: string;
}

export interface Option {
  value: string;
  label: string;
}

export type Destinations = Record<Exclude<DestType, 'external' | 'hangup'>, Option[]>;
