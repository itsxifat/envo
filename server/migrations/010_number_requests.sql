-- Numbers customers can choose when they ask Enfinito for a new one: the operator's allocation,
-- imported by staff. reserved = held by an open request, assigned = connected to a customer.
CREATE TABLE number_pool (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'assigned')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX number_pool_status_idx ON number_pool (status, number);

-- A customer asks for a new number: the subscriber details the operator needs for registration
-- (BTRC), their photo and ID document (files under <data dir>/kyc/<id>/), and their consent.
CREATE TABLE number_requests (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id integer REFERENCES tenants(id) ON DELETE SET NULL,
  pool_id integer REFERENCES number_pool(id) ON DELETE SET NULL,
  requested_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'connected', 'rejected', 'cancelled')),
  details jsonb NOT NULL,
  photo_file text NOT NULL DEFAULT '',
  id_file text NOT NULL DEFAULT '',
  consent_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  number_id integer REFERENCES numbers(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  decided_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX number_requests_account_idx ON number_requests (account_id, created_at DESC);
CREATE INDEX number_requests_status_idx ON number_requests (status, created_at);

-- Balance top-ups for numbers Enfinito provides: paid through an invoice, then applied at the operator.
ALTER TABLE invoices DROP CONSTRAINT invoices_kind_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('subscription', 'renewal', 'upgrade', 'manual', 'topup'));

CREATE TABLE topups (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number_id integer REFERENCES numbers(id) ON DELETE SET NULL,
  number text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  invoice_id integer NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  -- awaiting_payment → paid (by the invoice) → applied (staff added it at the operator), or cancelled.
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'paid', 'applied', 'cancelled')),
  note text NOT NULL DEFAULT '',
  applied_by integer REFERENCES users(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topups_account_idx ON topups (account_id, created_at DESC);
CREATE INDEX topups_status_idx ON topups (status, created_at);
