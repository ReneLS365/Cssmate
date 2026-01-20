ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
