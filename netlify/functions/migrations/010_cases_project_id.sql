ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS parent_case_id uuid;

CREATE INDEX IF NOT EXISTS team_cases_team_parent_case_idx
  ON team_cases (team_id, parent_case_id);
