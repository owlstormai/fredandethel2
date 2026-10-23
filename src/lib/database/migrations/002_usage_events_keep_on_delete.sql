-- Usage events are the operator's cost records: the global daily cap is a sum
-- over them. Deleting an account must remove the person's data, not the spend,
-- so usage rows survive the delete with user_id set to NULL. Per-user queries
-- filter by user_id and are unaffected; the global sum includes NULL rows.

ALTER TABLE usage_events ALTER COLUMN user_id DROP NOT NULL;

-- The 001 constraint was auto-named (usage_events_user_id_fkey); look it up
-- rather than assume, then replace ON DELETE CASCADE with ON DELETE SET NULL.
DO $$
DECLARE
  fk_name text;
BEGIN
  FOR fk_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'usage_events'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'users'::regclass
       AND a.attname = 'user_id'
  LOOP
    EXECUTE format('ALTER TABLE usage_events DROP CONSTRAINT %I', fk_name);
  END LOOP;
END
$$;

ALTER TABLE usage_events
  ADD CONSTRAINT usage_events_user_id_fkey FOREIGN KEY (user_id)
  REFERENCES users(id) ON DELETE SET NULL;
