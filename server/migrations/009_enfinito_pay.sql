-- Online payments through Enfinito Pay (pay.enfinito.com). The checkout id (cs_…) is kept in tran_id.
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('sslcommerz', 'manual', 'enfinito_pay'));
