ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE team_members
SET last_seen_at = COALESCE(last_seen_at, last_login_at, joined_at, NOW());

DO $$
DECLARE
  constraint_record record;
  users_regclass regclass;
BEGIN
  users_regclass := to_regclass('public.users');
  IF users_regclass IS NULL THEN
    RETURN;
  END IF;
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = users_regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', constraint_record.table_name, constraint_record.conname);
  END LOOP;
END $$;

DROP TABLE IF EXISTS users;
