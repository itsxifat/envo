-- Numbers can come from more than one provider (operator); a request remembers which one it is for.
-- Every request so far was for ICC, the only provider until now.
ALTER TABLE number_requests ADD COLUMN provider text NOT NULL DEFAULT '';
UPDATE number_requests SET provider = 'icc';
