ALTER TABLE teams ADD COLUMN IF NOT EXISTS slug text;

UPDATE teams
SET slug = name
WHERE slug IS NULL OR slug = '';

ALTER TABLE teams ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS teams_slug_idx ON teams (slug);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_members_role_check'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_role_check
      CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_members_status_check'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_status_check
      CHECK (status IN ('active', 'disabled', 'pending'));
  END IF;
END $$;
