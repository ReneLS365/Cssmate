ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS last_editor_sub text;

CREATE INDEX IF NOT EXISTS team_cases_team_status_created_idx
  ON team_cases (team_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS team_cases_team_creator_status_idx
  ON team_cases (team_id, created_by, status);

CREATE INDEX IF NOT EXISTS team_cases_team_updated_at_idx
  ON team_cases (team_id, updated_at DESC);
