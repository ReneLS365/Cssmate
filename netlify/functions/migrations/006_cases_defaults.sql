UPDATE team_cases SET created_at = NOW() WHERE created_at IS NULL;
UPDATE team_cases SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE team_cases SET last_updated_at = NOW() WHERE last_updated_at IS NULL;
UPDATE team_cases SET status = 'kladde' WHERE status IS NULL;

ALTER TABLE team_cases ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE team_cases ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE team_cases ALTER COLUMN last_updated_at SET DEFAULT NOW();
ALTER TABLE team_cases ALTER COLUMN status SET DEFAULT 'kladde';
