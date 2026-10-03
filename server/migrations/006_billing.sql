-- Billing: invoices for packages and renewals, and the payments against them (SSLCommerz or manual
-- bKash/bank transfers an admin approves).

CREATE SEQUENCE invoice_number_seq START 1;

CREATE TABLE invoices (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- subscription: first package (or a new one after a cancelled one); renewal: next period;
  -- upgrade: prorated difference to a bigger package; manual: anything an admin bills by hand.
  kind text NOT NULL CHECK (kind IN ('subscription', 'renewal', 'upgrade', 'manual')),
  package_id integer REFERENCES packages(id),
  months integer NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 36),
  description text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'BDT',
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  due_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  -- Renewals: the period this invoice pays for starts here (one renewal invoice per period).
  period_start timestamptz,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_account_idx ON invoices (account_id, created_at DESC);
CREATE INDEX invoices_status_idx ON invoices (status);
CREATE UNIQUE INDEX invoices_one_renewal_per_period ON invoices (account_id, period_start) WHERE kind = 'renewal' AND status <> 'void';

CREATE TABLE payments (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('sslcommerz', 'manual')),
  -- initiated: sent to the gateway; pending_review: manual transfer or a risky card payment waiting
  -- for an admin; succeeded/failed/cancelled are final (refunded is set by an admin).
  status text NOT NULL CHECK (status IN ('initiated', 'pending_review', 'succeeded', 'failed', 'cancelled', 'refunded')),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  -- Our id for the gateway transaction, and what the gateway reports back.
  tran_id text UNIQUE,
  val_id text,
  bank_tran_id text,
  card_type text,
  -- Manual payments: how the customer paid (bkash, nagad, bank...) and their transaction reference.
  channel text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  raw jsonb NOT NULL DEFAULT '{}',
  reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_status_idx ON payments (status, created_at);
