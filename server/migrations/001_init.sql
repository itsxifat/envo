-- Envo core schema

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A "SIP Server" in the UI: an isolated virtual PBX with its own extensions, numbers and routing.
CREATE TABLE tenants (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9]{1,19}$'),
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  max_channels integer NOT NULL DEFAULT 0 CHECK (max_channels >= 0),
  max_extensions integer NOT NULL DEFAULT 0 CHECK (max_extensions >= 0),
  outbound_cid text NOT NULL DEFAULT '',
  recording text NOT NULL DEFAULT 'off' CHECK (recording IN ('off', 'inbound', 'outbound', 'all')),
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE extensions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (number ~ '^[0-9]{2,8}$'),
  name text NOT NULL,
  sip_username text NOT NULL UNIQUE,
  sip_password text NOT NULL,
  webrtc boolean NOT NULL DEFAULT true,
  max_contacts integer NOT NULL DEFAULT 3 CHECK (max_contacts BETWEEN 1 AND 20),
  codecs text NOT NULL DEFAULT 'g722,ulaw,alaw,opus',
  outbound_cid text NOT NULL DEFAULT '',
  allow_outbound boolean NOT NULL DEFAULT true,
  voicemail boolean NOT NULL DEFAULT true,
  voicemail_pin text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  recording text NOT NULL DEFAULT 'inherit' CHECK (recording IN ('inherit', 'off', 'inbound', 'outbound', 'all')),
  ring_timeout integer NOT NULL DEFAULT 25 CHECK (ring_timeout BETWEEN 5 AND 300),
  dnd boolean NOT NULL DEFAULT false,
  forward_always text NOT NULL DEFAULT '',
  forward_busy text NOT NULL DEFAULT '',
  forward_noanswer text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('superadmin', 'admin', 'agent')),
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  extension_id integer REFERENCES extensions(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'superadmin' OR tenant_id IS NOT NULL)
);

-- Connections to upstream SIP providers / carriers (IPTSP, Twilio, etc).
-- tenant_id NULL = shared trunk owned by the platform.
CREATE TABLE trunks (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 5060 CHECK (port BETWEEN 1 AND 65535),
  transport text NOT NULL DEFAULT 'udp' CHECK (transport IN ('udp', 'tcp', 'tls')),
  auth_mode text NOT NULL DEFAULT 'register' CHECK (auth_mode IN ('register', 'outbound', 'ip')),
  username text NOT NULL DEFAULT '',
  auth_username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  from_user text NOT NULL DEFAULT '',
  from_domain text NOT NULL DEFAULT '',
  contact_user text NOT NULL DEFAULT '',
  register_expiry integer NOT NULL DEFAULT 300 CHECK (register_expiry BETWEEN 60 AND 7200),
  match_ips text NOT NULL DEFAULT '',
  codecs text NOT NULL DEFAULT 'alaw,ulaw,g722',
  dtmf_mode text NOT NULL DEFAULT 'rfc4733' CHECK (dtmf_mode IN ('rfc4733', 'inband', 'info', 'auto')),
  max_channels integer NOT NULL DEFAULT 0 CHECK (max_channels >= 0),
  qualify boolean NOT NULL DEFAULT false,
  send_pai boolean NOT NULL DEFAULT false,
  outbound_proxy text NOT NULL DEFAULT '',
  default_dest_type text NOT NULL DEFAULT 'hangup',
  default_dest_target text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DIDs / IP phone numbers.
CREATE TABLE numbers (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trunk_id integer REFERENCES trunks(id) ON DELETE SET NULL,
  number text NOT NULL UNIQUE CHECK (number ~ '^\+?[0-9]{3,20}$'),
  label text NOT NULL DEFAULT '',
  max_channels integer NOT NULL DEFAULT 0 CHECK (max_channels >= 0),
  dest_type text NOT NULL DEFAULT 'hangup',
  dest_target text NOT NULL DEFAULT '',
  cid_prefix text NOT NULL DEFAULT '',
  recording text NOT NULL DEFAULT 'inherit' CHECK (recording IN ('inherit', 'off', 'on')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbound_routes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 10,
  patterns text[] NOT NULL DEFAULT '{}',
  strip integer NOT NULL DEFAULT 0 CHECK (strip BETWEEN 0 AND 20),
  prepend text NOT NULL DEFAULT '',
  callerid text NOT NULL DEFAULT '',
  trunk_ids integer[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sounds (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'tts')),
  text text NOT NULL DEFAULT '',
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ivrs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  number text NOT NULL DEFAULT '',
  greeting_sound_id integer REFERENCES sounds(id) ON DELETE SET NULL,
  timeout integer NOT NULL DEFAULT 5 CHECK (timeout BETWEEN 1 AND 60),
  max_retries integer NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 1 AND 10),
  direct_dial boolean NOT NULL DEFAULT true,
  options jsonb NOT NULL DEFAULT '[]',
  timeout_dest_type text NOT NULL DEFAULT 'hangup',
  timeout_dest_target text NOT NULL DEFAULT '',
  invalid_dest_type text NOT NULL DEFAULT 'hangup',
  invalid_dest_target text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ring_groups (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  number text NOT NULL DEFAULT '',
  strategy text NOT NULL DEFAULT 'ringall' CHECK (strategy IN ('ringall', 'hunt')),
  members text[] NOT NULL DEFAULT '{}',
  ring_time integer NOT NULL DEFAULT 20 CHECK (ring_time BETWEEN 5 AND 300),
  cid_prefix text NOT NULL DEFAULT '',
  failover_dest_type text NOT NULL DEFAULT 'hangup',
  failover_dest_target text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE queues (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  number text NOT NULL DEFAULT '',
  strategy text NOT NULL DEFAULT 'ringall'
    CHECK (strategy IN ('ringall', 'leastrecent', 'fewestcalls', 'random', 'rrmemory', 'linear')),
  members text[] NOT NULL DEFAULT '{}',
  agent_timeout integer NOT NULL DEFAULT 15 CHECK (agent_timeout BETWEEN 5 AND 120),
  max_wait integer NOT NULL DEFAULT 300 CHECK (max_wait BETWEEN 0 AND 7200),
  wrapup integer NOT NULL DEFAULT 0 CHECK (wrapup BETWEEN 0 AND 600),
  announce_position boolean NOT NULL DEFAULT true,
  join_sound_id integer REFERENCES sounds(id) ON DELETE SET NULL,
  failover_dest_type text NOT NULL DEFAULT 'hangup',
  failover_dest_target text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE time_conditions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'open', 'closed')),
  rules jsonb NOT NULL DEFAULT '[]',
  holidays jsonb NOT NULL DEFAULT '[]',
  match_dest_type text NOT NULL DEFAULT 'hangup',
  match_dest_target text NOT NULL DEFAULT '',
  nomatch_dest_type text NOT NULL DEFAULT 'hangup',
  nomatch_dest_target text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Written directly by Asterisk's cdr_pgsql module (role envo_cdr). Custom columns are filled from CDR() variables.
CREATE TABLE cdr (
  id bigserial PRIMARY KEY,
  calldate timestamptz NOT NULL DEFAULT now(),
  clid text NOT NULL DEFAULT '',
  src text NOT NULL DEFAULT '',
  dst text NOT NULL DEFAULT '',
  dcontext text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT '',
  dstchannel text NOT NULL DEFAULT '',
  lastapp text NOT NULL DEFAULT '',
  lastdata text NOT NULL DEFAULT '',
  duration integer NOT NULL DEFAULT 0,
  billsec integer NOT NULL DEFAULT 0,
  disposition text NOT NULL DEFAULT '',
  amaflags integer NOT NULL DEFAULT 0,
  accountcode text NOT NULL DEFAULT '',
  uniqueid text NOT NULL DEFAULT '',
  userfield text NOT NULL DEFAULT '',
  peeraccount text NOT NULL DEFAULT '',
  linkedid text NOT NULL DEFAULT '',
  sequence integer NOT NULL DEFAULT 0,
  recordingfile text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT '',
  did text NOT NULL DEFAULT ''
);
CREATE INDEX cdr_calldate_idx ON cdr (calldate DESC);
CREATE INDEX cdr_account_calldate_idx ON cdr (accountcode, calldate DESC);
CREATE INDEX cdr_linkedid_idx ON cdr (linkedid);
CREATE INDEX cdr_uniqueid_idx ON cdr (uniqueid);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  tenant_id integer,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Asterisk's CDR writer may only append call records.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'envo_cdr') THEN
    GRANT INSERT, SELECT ON cdr TO envo_cdr;
    GRANT USAGE ON SEQUENCE cdr_id_seq TO envo_cdr;
  END IF;
END $$;
