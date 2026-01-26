ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS attachments jsonb;

ALTER TABLE team_cases
  ALTER COLUMN attachments SET DEFAULT '{}'::jsonb;

-- Backfill: bevar eksisterende json_content som montage/demontage afhængigt af status/phase.
UPDATE team_cases
SET attachments = CASE
  WHEN json_content IS NOT NULL AND (status IN ('demontage_i_gang', 'afsluttet') OR phase = 'demontage')
    THEN jsonb_build_object('demontage', json_content)
  WHEN json_content IS NOT NULL
    THEN jsonb_build_object('montage', json_content)
  ELSE '{}'::jsonb
END
WHERE attachments IS NULL;
