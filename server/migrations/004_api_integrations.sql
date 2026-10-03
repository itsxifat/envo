-- API keys let other applications (shops, CRMs) drive Envo. Keys are stored hashed.
CREATE TABLE api_keys (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{read,calls,webphone}',
  allowed_origins text NOT NULL DEFAULT '',
  last_used_at timestamptz,
  requests bigint NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id);

-- Outgoing call event notifications.
CREATE TABLE webhooks (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{call.started,call.answered,call.ended}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id bigserial PRIMARY KEY,
  webhook_id integer NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status integer,
  error text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_recent_idx ON webhook_deliveries (webhook_id, created_at DESC);
