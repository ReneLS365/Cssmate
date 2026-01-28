ALTER TABLE public.team_cases
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS parent_case_id uuid;
