ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS parent_case_id uuid;

CREATE INDEX IF NOT EXISTS team_cases_team_project_idx
  ON team_cases (team_id, project_id);

CREATE INDEX IF NOT EXISTS team_cases_team_project_phase_idx
  ON team_cases (team_id, project_id, phase);
