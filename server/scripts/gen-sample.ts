// Prints the Asterisk config generated for a small sample model (dev aid, not deployed).
import { generate } from '../src/asterisk/generator.js';
import type { Model } from '../src/asterisk/model.js';

const t = { id: 1, name: 'Main', slug: 'main', enabled: true, max_channels: 10, max_extensions: 0, outbound_cid: '09612000000', recording: 'inbound', timezone: 'Asia/Dhaka', language: 'en' } as const;
const ext = (id: number, number: string, extra: object = {}) => ({ id, tenant_id: 1, number, name: `User ${number}`, sip_username: `${number}_main`, sip_password: 'Secret;Pass123', webrtc: true, max_contacts: 3, codecs: 'g722,ulaw,alaw,opus', outbound_cid: '', allow_outbound: true, voicemail: true, voicemail_pin: '1234', email: '', recording: 'inherit', ring_timeout: 25, dnd: false, forward_always: '', forward_busy: '', forward_noanswer: '', enabled: true, ...extra });
const model: Model = {
  settings: { sip_domain: 'pbx.example.com', public_ip: '72.60.104.105', country_code: '880', national_prefix: '0', stun_server: '', company_name: 'Envo' },
  tenants: [t as any],
  extensions: [ext(1, '1000'), ext(2, '1001', { webrtc: false, recording: 'all' })] as any,
  trunks: [{ id: 5, tenant_id: 1, name: 'IPTSP Line 1', host: 'sip.provider.bd', port: 5060, transport: 'udp', auth_mode: 'register', username: '09612000000', auth_username: '', password: 'p@ss;word', from_user: '', from_domain: '', contact_user: '', register_expiry: 300, match_ips: '203.0.113.10, 203.0.113.0/24', codecs: 'alaw,ulaw', dtmf_mode: 'rfc4733', max_channels: 4, qualify: false, send_pai: false, outbound_proxy: '', default_dest_type: 'extension', default_dest_target: '1000', enabled: true }],
  numbers: [{ id: 3, tenant_id: 1, trunk_id: 5, number: '09612000000', label: 'Hotline', max_channels: 2, dest_type: 'ivr', dest_target: '7', cid_prefix: 'Hotline', recording: 'inherit', enabled: true }],
  routes: [{ id: 1, tenant_id: 1, name: 'BD Mobile', priority: 1, patterns: ['01XXXXXXXXX', '+8801XXXXXXXXX'], strip: 0, prepend: '', callerid: '', trunk_ids: [5], enabled: true }],
  sounds: [{ id: 9, tenant_id: 1, name: 'Welcome' }],
  ivrs: [{ id: 7, tenant_id: 1, name: 'Main Menu', number: '700', greeting_sound_id: 9, timeout: 5, max_retries: 3, direct_dial: true, options: [{ digit: '1', dest_type: 'ring_group', dest_target: '2' }, { digit: '2', dest_type: 'queue', dest_target: '4' }, { digit: '0', dest_type: 'extension', dest_target: '1000' }], timeout_dest_type: 'voicemail', timeout_dest_target: '1000', invalid_dest_type: 'hangup', invalid_dest_target: '' }],
  ringGroups: [{ id: 2, tenant_id: 1, name: 'Sales', number: '600', strategy: 'ringall', members: ['1000', '1001'], ring_time: 20, cid_prefix: 'Sales', failover_dest_type: 'voicemail', failover_dest_target: '1000' }],
  queues: [{ id: 4, tenant_id: 1, name: 'Support', number: '650', strategy: 'rrmemory', members: ['1000', '1001'], agent_timeout: 15, max_wait: 300, wrapup: 5, announce_position: true, join_sound_id: null, failover_dest_type: 'time_condition', failover_dest_target: '8' }],
  blocked: [],
  conferences: [],
  timeConditions: [{ id: 8, tenant_id: 1, name: 'Office Hours', mode: 'auto', rules: [{ days: ['sun', 'mon', 'tue', 'wed', 'thu'], start: '09:00', end: '18:00' }], holidays: [{ date: '2026-12-16', name: 'Victory Day' }], match_dest_type: 'ring_group', match_dest_target: '2', nomatch_dest_type: 'voicemail', nomatch_dest_target: '1000' }],
};
const out = generate(model);
for (const [name, content] of Object.entries(out.files)) {
  if (name === 'extensions_envo_lib.conf') continue;
  console.log(`\n######## ${name}\n${content}`);
}
console.log('warnings:', out.warnings);
