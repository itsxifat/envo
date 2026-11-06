-- Envo in the Enfinito CRM: invoices carry the VAT the CRM decides, and every change to an invoice or
-- its payments is queued for the CRM by these triggers, so no code path can forget to send it.

ALTER TABLE invoices
  -- amount = subtotal + sd_amount + vat_amount, in the shape of the CRM's invoices.
  ADD COLUMN subtotal numeric(12, 2),
  ADD COLUMN vat_treatment text NOT NULL DEFAULT 'NONE' CHECK (vat_treatment IN ('STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE')),
  ADD COLUMN vat_rate numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN sd_rate numeric(6, 2) NOT NULL DEFAULT 0,
  ADD COLUMN vat_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN sd_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN service_code text,
  -- The CRM's tax settings this invoice was priced under.
  ADD COLUMN tax_policy_version text,
  -- crm_version counts changes, crm_synced_version the last one the CRM has.
  ADD COLUMN crm_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN crm_synced_version bigint NOT NULL DEFAULT 0,
  -- pending: on its way. synced: the CRM matches. review: the CRM holds it for finance (the money is
  -- safe, Envo keeps retrying). rejected: the CRM refused it. mismatch: the CRM answered with other figures.
  -- skipped: not for the CRM (Enfinito's own account, free, from before go-live) unless it changes.
  ADD COLUMN crm_state text NOT NULL DEFAULT 'pending' CHECK (crm_state IN ('pending', 'synced', 'review', 'rejected', 'mismatch', 'skipped')),
  ADD COLUMN crm_code text,
  ADD COLUMN crm_error text,
  ADD COLUMN crm_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN crm_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN crm_synced_at timestamptz,
  ADD COLUMN crm_invoice_id text,
  -- Seller and buyer as the CRM printed them (BIN, client code).
  ADD COLUMN crm_snapshot jsonb;

UPDATE invoices SET subtotal = amount;
ALTER TABLE invoices ALTER COLUMN subtotal SET NOT NULL;

-- Code from before this migration (a deploy rolled back) inserts no subtotal: the amount has no tax then.
CREATE FUNCTION invoices_fill_subtotal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subtotal IS NULL THEN
    NEW.subtotal := NEW.amount - NEW.sd_amount - NEW.vat_amount;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_fill_subtotal BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_fill_subtotal();
ALTER TABLE invoices ADD CONSTRAINT invoices_tax_adds_up CHECK (subtotal + sd_amount + vat_amount = amount);

-- Only what still has to go: stays tiny however many invoices there are.
CREATE INDEX invoices_crm_queue ON invoices (crm_next_attempt_at) WHERE crm_version > crm_synced_version;

CREATE FUNCTION crm_invoice_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.number, NEW.account_id, NEW.description, NEW.amount, NEW.status, NEW.due_at, NEW.paid_at)
     IS DISTINCT FROM (OLD.number, OLD.account_id, OLD.description, OLD.amount, OLD.status, OLD.due_at, OLD.paid_at) THEN
    NEW.crm_version := OLD.crm_version + 1;
    NEW.crm_state := 'pending';
    NEW.crm_attempts := 0;
    NEW.crm_next_attempt_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_crm_changed BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION crm_invoice_changed();

-- A payment that succeeds, or stops counting (a refund), changes what the CRM has to book.
CREATE FUNCTION crm_payment_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'succeeded' OR (TG_OP = 'UPDATE' AND OLD.status = 'succeeded') THEN
    IF TG_OP = 'INSERT' OR (NEW.status, NEW.amount, NEW.invoice_id) IS DISTINCT FROM (OLD.status, OLD.amount, OLD.invoice_id) THEN
      UPDATE invoices SET crm_version = crm_version + 1, crm_state = 'pending', crm_attempts = 0, crm_next_attempt_at = now()
       WHERE id = NEW.invoice_id;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER payments_crm_changed AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION crm_payment_changed();
