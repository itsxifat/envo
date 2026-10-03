-- Envo as a product: customer accounts own SIP servers (tenants) and logins, and are limited by the
-- package they subscribe to. Limits: NULL = unlimited, 0 = not included.

CREATE TABLE accounts (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  -- pending: signed up, nothing paid yet. suspended: unpaid or blocked by an admin; SIP servers stop
  -- working but the owner can still sign in and pay. closed: gone for good, nobody can sign in.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  -- Enfinito's own account: never billed, never limited.
  internal boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_status_idx ON accounts (status);

CREATE TABLE packages (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  tagline text NOT NULL DEFAULT '',
  -- BDT per month; NULL = custom price ("Contact us").
  price_monthly numeric(12, 2) CHECK (price_monthly >= 0),
  public boolean NOT NULL DEFAULT true,
  highlight boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  max_servers integer CHECK (max_servers >= 0),
  max_dids integer CHECK (max_dids >= 0),
  max_extensions integer CHECK (max_extensions >= 0),
  max_channels integer CHECK (max_channels >= 0),
  max_ivrs integer CHECK (max_ivrs >= 0),
  -- Recording: kept this many days (0 = recording not included), within this much storage.
  recording_days integer NOT NULL DEFAULT 0 CHECK (recording_days >= 0),
  recording_mb integer CHECK (recording_mb >= 0),
  ivr_tier text NOT NULL DEFAULT 'basic' CHECK (ivr_tier IN ('basic', 'basic_ai', 'multi_ai', 'advanced_ai', 'unlimited')),
  call_monitoring boolean NOT NULL DEFAULT false,
  api_access boolean NOT NULL DEFAULT false,
  -- Extra rows for the public pricing table: [{"label": "...", "value": "..."}].
  display_rows jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  package_id integer NOT NULL REFERENCES packages(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled')),
  -- Price locked in when subscribed; renewals charge this.
  price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- Downgrade that takes effect at the next renewal.
  next_package_id integer REFERENCES packages(id),
  -- Per-customer limit overrides (Enterprise / custom deals): same keys as the package columns.
  overrides jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_one_live ON subscriptions (account_id) WHERE status <> 'cancelled';
CREATE INDEX subscriptions_period_end_idx ON subscriptions (current_period_end) WHERE status <> 'cancelled';

ALTER TABLE tenants ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE CASCADE;
-- The owner manages billing and the team; admins run the PBX of every SIP server in the account.
ALTER TABLE users ADD COLUMN is_owner boolean NOT NULL DEFAULT false;
CREATE INDEX tenants_account_idx ON tenants (account_id);
CREATE INDEX users_account_idx ON users (account_id);

-- Everything that exists today belongs to Enfinito's internal account.
INSERT INTO accounts (name, email, status, internal)
SELECT 'Enfinito', COALESCE((SELECT email FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1), 'admin@localhost'), 'active', true
WHERE EXISTS (SELECT 1 FROM tenants) OR EXISTS (SELECT 1 FROM users WHERE role <> 'superadmin');
UPDATE tenants SET account_id = (SELECT id FROM accounts WHERE internal ORDER BY id LIMIT 1) WHERE account_id IS NULL;
UPDATE users SET account_id = (SELECT id FROM accounts WHERE internal ORDER BY id LIMIT 1) WHERE role <> 'superadmin' AND account_id IS NULL;
ALTER TABLE tenants ALTER COLUMN account_id SET NOT NULL;

-- Numbers now route only through their own trunk, and a trunk sharing its provider IP with other
-- customers is recognised by its numbers: link trunk-less numbers to their server's only trunk.
UPDATE numbers n SET trunk_id = (SELECT k.id FROM trunks k WHERE k.tenant_id = n.tenant_id ORDER BY k.id LIMIT 1)
 WHERE n.trunk_id IS NULL AND (SELECT count(*) FROM trunks k WHERE k.tenant_id = n.tenant_id) = 1;

-- Logins: platform admins have no account; everyone else does; agents also sit in one SIP server.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE users ADD CONSTRAINT users_account_check CHECK (role = 'superadmin' OR account_id IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_agent_tenant_check CHECK (role <> 'agent' OR tenant_id IS NOT NULL);

-- The packages from Enfinito's price sheet (editable in the admin panel).
INSERT INTO packages (name, slug, tagline, price_monthly, highlight, sort_order, max_servers, max_dids, max_extensions, max_channels, max_ivrs, recording_days, recording_mb, ivr_tier, call_monitoring, api_access, display_rows) VALUES
  ('Starter PBX', 'starter', 'Small teams', 499, false, 10, 1, 1, 5, 1, 1, 0, 0, 'basic', false, false, '[{"label": "Call charge", "value": "BDT 0.40 / min"}]'),
  ('Business PBX', 'business', 'Growing teams', 999, false, 20, 1, 1, 10, 2, 2, 0, 0, 'basic_ai', true, false, '[{"label": "Call charge", "value": "BDT 0.40 / min"}]'),
  ('Corporate PBX', 'corporate', 'Established businesses', 1999, true, 30, 1, 1, 20, 3, 5, 7, 500, 'multi_ai', true, true, '[{"label": "Call charge", "value": "BDT 0.40 / min"}]'),
  ('Advanced PBX', 'advanced', 'High volume teams', 3499, false, 40, 1, 1, 50, 5, 10, 30, 1024, 'advanced_ai', true, true, '[{"label": "Call charge", "value": "BDT 0.40 / min"}]'),
  ('Enterprise PBX', 'enterprise', 'Large organizations', NULL, false, 50, NULL, NULL, NULL, NULL, NULL, 90, NULL, 'unlimited', true, true, '[{"label": "Call charge", "value": "BDT 0.40 / min"}]');
