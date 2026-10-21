-- Call recording covers every call of a SIP server: incoming, outgoing and calls between
-- extensions. New SIP servers record all calls (when the package includes recording), and existing
-- servers and extensions that recorded only one direction or nothing by default now record both.
-- An extension set to "Never record" keeps that choice; the package still decides whether
-- recording is included at all.
ALTER TABLE tenants ALTER COLUMN recording SET DEFAULT 'all';
UPDATE tenants SET recording = 'all', updated_at = now() WHERE recording <> 'all';
UPDATE extensions SET recording = 'all', updated_at = now() WHERE recording IN ('inbound', 'outbound');

-- The recordings page lists and cleans up call records by their recording file.
CREATE INDEX IF NOT EXISTS cdr_recording_idx ON cdr (accountcode, calldate DESC) WHERE recordingfile <> '';
CREATE INDEX IF NOT EXISTS cdr_recordingfile_idx ON cdr (recordingfile) WHERE recordingfile <> '';
