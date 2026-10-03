-- Number the caller originally dialed (ring groups / queues / IVRs rewrite the CDR "dst" to "s").
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS dialed text NOT NULL DEFAULT '';
