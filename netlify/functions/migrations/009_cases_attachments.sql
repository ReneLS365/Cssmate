ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS attachments jsonb;

ALTER TABLE team_cases
  ALTER COLUMN attachments SET DEFAULT '{}'::jsonb;

-- Backfill: bevar eksisterende json_content som montage hvis attachments mangler.
UPDATE team_cases
SET attachments = CASE
  WHEN json_content IS NOT NULL THEN jsonb_build_object('montage', json_content)
  ELSE '{}'::jsonb
END
WHERE attachments IS NULL;
