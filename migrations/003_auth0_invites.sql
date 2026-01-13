ALTER TABLE teams ADD COLUMN IF NOT EXISTS created_by_sub text;

ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_user_id_fkey;
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_status_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'team_members' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE team_members RENAME COLUMN user_id TO user_sub;
  END IF;
END $$;

ALTER TABLE team_members
  ALTER COLUMN user_sub TYPE text USING user_sub::text;

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();

UPDATE team_members SET role = 'admin' WHERE role = 'owner';
UPDATE team_members SET status = 'removed' WHERE status = 'disabled';

ALTER TABLE team_members
  ADD CONSTRAINT team_members_role_check CHECK (role IN ('admin', 'member', 'owner'));

ALTER TABLE team_members
  ADD CONSTRAINT team_members_status_check CHECK (status IN ('active', 'removed', 'disabled', 'pending'));

ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_created_by_fkey;
ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_accepted_by_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'team_invites' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE team_invites RENAME COLUMN created_by TO created_by_sub;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'team_invites' AND column_name = 'accepted_by'
  ) THEN
    ALTER TABLE team_invites RENAME COLUMN accepted_by TO accepted_by_sub;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'team_invites' AND column_name = 'accepted_at'
  ) THEN
    ALTER TABLE team_invites RENAME COLUMN accepted_at TO used_at;
  END IF;
END $$;

ALTER TABLE team_invites
  ALTER COLUMN created_by_sub TYPE text USING created_by_sub::text,
  ALTER COLUMN accepted_by_sub TYPE text USING accepted_by_sub::text;

ALTER TABLE team_invites
  ADD COLUMN IF NOT EXISTS token_hint text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS accept_ip text,
  ADD COLUMN IF NOT EXISTS accept_ua text;

CREATE UNIQUE INDEX IF NOT EXISTS team_invites_active_email_idx
  ON team_invites (team_id, email)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE team_cases DROP CONSTRAINT IF EXISTS team_cases_created_by_fkey;

ALTER TABLE team_cases
  ALTER COLUMN created_by TYPE text USING created_by::text,
  ALTER COLUMN updated_by TYPE text USING updated_by::text,
  ALTER COLUMN deleted_by TYPE text USING deleted_by::text;

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_sub text,
  action text NOT NULL,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
