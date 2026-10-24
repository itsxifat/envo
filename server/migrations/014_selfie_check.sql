-- The automatic selfie check: a live selfie (looking straight, then turning the head one way and the
-- other) checked on this server when it is taken, and its face matched with the photo on the NID
-- when the registration is sent. See src/phone/identity.ts.
CREATE TABLE selfie_checks (
  id uuid PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Head turns and face distances measured in the three pictures.
  result jsonb NOT NULL,
  -- The straight picture's face descriptor, compared with the NID photo later.
  descriptor jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a registration takes it (its pictures move to the request).
  used_at timestamptz
);
CREATE INDEX selfie_checks_account_idx ON selfie_checks (account_id, created_at DESC);

-- What the automatic check found for a request: the live selfie (when taken) and the face match.
ALTER TABLE number_requests ADD COLUMN identity jsonb;
