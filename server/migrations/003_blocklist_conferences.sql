-- Callers rejected on inbound calls, per SIP server.
CREATE TABLE blocked_numbers (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number text NOT NULL,
  match text NOT NULL DEFAULT 'exact' CHECK (match IN ('exact', 'prefix', 'anonymous')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number, match)
);

-- Conference rooms (Asterisk ConfBridge).
CREATE TABLE conferences (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  number text NOT NULL DEFAULT '',
  pin text NOT NULL DEFAULT '' CHECK (pin ~ '^[0-9]{0,10}$'),
  max_members integer NOT NULL DEFAULT 20 CHECK (max_members BETWEEN 2 AND 200),
  announce_join boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
