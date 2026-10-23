-- Guided onboarding. The answers a customer gives while choosing a package (how many people use
-- phones, how many calls at the same time) point to the package that fits and size the first SIP server.
ALTER TABLE accounts ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}';

-- Where calls to a SIP server's numbers ring, as chosen in the guided setup. Numbers connected later
-- (one the customer brings, or one Enfinito registers for them) ring there too. '' = not chosen yet.
ALTER TABLE tenants ADD COLUMN default_dest_type text NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN default_dest_target text NOT NULL DEFAULT '';

-- A special (easy to remember) number the customer applied for, in their own words. '' for an
-- ordinary request (a number from the pool, or any free one).
ALTER TABLE number_requests ADD COLUMN special text NOT NULL DEFAULT '';
