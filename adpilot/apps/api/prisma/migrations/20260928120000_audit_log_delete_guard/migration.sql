-- Audit log rows are never modified (see audit_logs_no_update) and are deleted only by the retention job,
-- which marks its own transaction with `SELECT set_config('adpilot.audit_retention', 'on', true)`.
-- Any other DELETE is rejected. The setting is transaction-local, so it cannot leak to other statements
-- that reuse the same pooled connection.
CREATE OR REPLACE FUNCTION audit_logs_block_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('adpilot.audit_retention', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'audit_logs is append-only (rows are removed only by the retention job)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_delete();
