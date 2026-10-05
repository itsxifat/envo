export type Role = 'superadmin' | 'admin' | 'agent';

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'closed';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** Home SIP server (an agent's only one). */
  tenantId: number | null;
  extensionId: number | null;
  /** Customer account; null for platform admins. */
  accountId: number | null;
  accountStatus: AccountStatus | null;
  isOwner: boolean;
  /** SIP servers this login may work in; null = all (platform admins). */
  tenantIds: number[] | null;
}

export type IvrTier = 'basic' | 'basic_ai' | 'multi_ai' | 'advanced_ai' | 'unlimited';

/** Package limits: null = unlimited, 0 = not included. */
export interface PlanLimits {
  max_servers: number | null;
  max_dids: number | null;
  max_extensions: number | null;
  max_channels: number | null;
  max_ivrs: number | null;
  recording_mb: number | null;
  recording_days: number;
  ivr_tier: IvrTier;
  call_monitoring: boolean;
  api_access: boolean;
}

export interface Plan {
  accountId: number;
  accountName: string;
  internal: boolean;
  status: AccountStatus;
  usable: boolean;
  package: { id: number; name: string; slug: string } | null;
  subscription: {
    id: number;
    status: 'active' | 'past_due' | 'cancelled';
    price: number;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    nextPackageId: number | null;
  } | null;
  limits: PlanLimits;
}

export interface Usage {
  servers: number;
  dids: number;
  extensions: number;
  ivrs: number;
  users: number;
  recordingMb: number | null;
}

export interface Package extends Omit<PlanLimits, never> {
  id: number;
  name: string;
  slug: string;
  tagline: string;
  /** BDT per month as a decimal string; null = custom price. */
  price_monthly: string | null;
  public: boolean;
  highlight: boolean;
  sort_order: number;
  active: boolean;
  display_rows: { label: string; value: string }[];
  subscribers?: number;
}

export interface AccountRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  status: AccountStatus;
  internal: boolean;
  created_at: string;
  package_id: number | null;
  package_name: string | null;
  subscription_status: 'active' | 'past_due' | 'cancelled' | null;
  price: string | null;
  current_period_end: string | null;
  servers: number;
  extensions: number;
  dids: number;
  owner_email: string | null;
}

export type Recording = 'off' | 'inbound' | 'outbound' | 'all';

export interface Tenant {
  id: number;
  account_id?: number;
  account_name?: string;
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
  /** Logins that call from this extension (admins only). */
  users?: ExtensionUser[];
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

export interface ExtensionUser {
  id: number;
  name: string;
  email?: string;
  role?: Role;
}

/** An extension an admin can hand out, from any SIP server of the account. */
export interface AssignableExtension {
  id: number;
  number: string;
  name: string;
  tenant_id: number;
  tenant_name: string;
  account_id: number;
  account_name: string;
  users: ExtensionUser[];
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
  extension_tenant_name?: string | null;
  tenant_name?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  is_owner?: boolean;
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

export type InvoiceKind = 'subscription' | 'renewal' | 'upgrade' | 'manual';

export interface Invoice {
  id: number;
  number: string;
  account_id: number;
  kind: InvoiceKind;
  package_id: number | null;
  months: number;
  description: string;
  amount: string;
  currency: string;
  status: 'unpaid' | 'paid' | 'void';
  due_at: string;
  paid_at: string | null;
  period_start: string | null;
  created_at: string;
  account_name?: string;
}

export type PaymentStatus = 'initiated' | 'pending_review' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';

export interface PaymentRow {
  id: number;
  invoice_id: number;
  method: 'sslcommerz' | 'manual';
  status: PaymentStatus;
  amount: string;
  card_type: string | null;
  channel: string;
  reference: string;
  note?: string;
  tran_id?: string | null;
  bank_tran_id?: string | null;
  created_at: string;
  updated_at: string;
  invoice_number?: string;
  description?: string;
  account_id?: number;
  account_name?: string;
}

export interface PaymentOptions {
  online: boolean;
  manual: boolean;
  manualInstructions: string;
}

export type CheckoutResult =
  | { action: 'invoice'; invoice: Invoice }
  | { action: 'scheduled'; message: string }
  | { action: 'applied'; message: string };

export interface BillingSettings {
  sslcommerz: { enabled: boolean; sandbox: boolean; store_id: string; store_passwd: string; has_passwd?: boolean };
  manual: { enabled: boolean; instructions: string };
  grace_days: number;
  renewal_notice_days: number;
  business: { name: string; address: string; email: string; phone: string };
}

export interface BillingOverview {
  mrr: string;
  collected_month: string;
  collected_last_month: string;
  outstanding: string;
  overdue: number;
  active_customers: number;
  suspended_customers: number;
  pending_customers: number;
  new_this_month: number;
  pending_reviews: number;
  by_month: { month: string; amount: string; payments: number }[];
}
