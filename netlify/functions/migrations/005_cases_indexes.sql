-- Indeholder indexes for hurtige opslag på store arkiver
CREATE INDEX IF NOT EXISTS team_cases_team_created_idx ON team_cases (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_cases_team_updated_idx ON team_cases (team_id, last_updated_at DESC);
