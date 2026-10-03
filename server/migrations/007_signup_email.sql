-- Self sign-up: verified email addresses, one-time links (verify / reset password), and a log of
-- the emails Envo sends.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
-- Everyone who exists today was created by an administrator.
UPDATE users SET email_verified_at = now();

-- The package a customer picked while signing up (offered first when they choose and pay).
ALTER TABLE accounts ADD COLUMN signup_package_id integer REFERENCES packages(id) ON DELETE SET NULL;

CREATE TABLE email_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify', 'reset')),
  -- sha256 of the token in the link; the link itself is never stored.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, kind);

CREATE TABLE email_log (
  id serial PRIMARY KEY,
  to_addr text NOT NULL,
  subject text NOT NULL,
  -- skipped: email is not set up yet (the message is only written to the server log).
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_created_idx ON email_log (created_at DESC);
