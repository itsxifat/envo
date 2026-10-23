-- Envo Phone: people who only want a phone number (the phone app and the website's personal side),
-- next to the businesses that run a PBX. A personal account has one SIP server with one extension
-- and one number from Enfinito's pool, on the hidden "Envo Phone" package, and pays for calls from a
-- balance it tops up.

ALTER TABLE accounts ADD COLUMN kind text NOT NULL DEFAULT 'business' CHECK (kind IN ('business', 'personal'));
-- The person asked to close their account (the app has to offer it); support finishes the job.
ALTER TABLE accounts ADD COLUMN close_requested_at timestamptz;

-- Every personal account is on this package: one number, one phone, no monthly fee.
INSERT INTO packages (name, slug, tagline, price_monthly, public, sort_order, max_servers, max_dids, max_extensions, max_channels, max_ivrs, recording_days, recording_mb, ivr_tier, call_monitoring, api_access)
VALUES ('Envo Phone', 'phone', 'A personal number', 0, false, 0, 1, 1, 1, 2, 0, 0, 0, 'basic', false, false)
ON CONFLICT (slug) DO NOTHING;

-- A personal account's calling balance: paid top-ups in, calls out, and support's corrections. One
-- row per top-up and per call, so nothing is ever counted twice.
CREATE TABLE balance_ledger (
  id bigserial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('topup', 'call', 'adjustment')),
  -- Positive adds to the balance, negative takes from it.
  amount numeric(12, 2) NOT NULL,
  topup_id integer UNIQUE REFERENCES topups(id) ON DELETE SET NULL,
  cdr_id bigint UNIQUE,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX balance_ledger_account_idx ON balance_ledger (account_id, created_at DESC);

-- Six-digit codes that confirm an email address in the app: one live code per login, a few tries.
CREATE TABLE email_codes (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sign-ins from before this moment stop working: set when the password changes, so a lost phone
-- that is still signed in is signed out too.
ALTER TABLE users ADD COLUMN sessions_valid_after timestamptz;
