-- Shared cases v2 workflow + phase normalization + demo seed

ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS last_editor_sub text;

ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS attachments jsonb;

ALTER TABLE team_cases
  ALTER COLUMN attachments SET DEFAULT '{}'::jsonb;

ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS totals jsonb;

ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS phase text;

ALTER TABLE team_cases
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz;

-- Normalize legacy status values to the new workflow.
UPDATE team_cases
SET status = 'kladde'
WHERE status IN ('draft', 'klar_til_deling', 'klar', 'ready');

UPDATE team_cases
SET status = 'godkendt'
WHERE status IN ('ready_for_demontage', 'klar_til_demontage');

UPDATE team_cases
SET status = 'afsluttet'
WHERE status IN ('completed', 'done');

-- Normalize phase to montage/demontage.
UPDATE team_cases
SET phase = CASE
  WHEN phase IN ('montage', 'demontage') THEN phase
  WHEN status IN ('demontage_i_gang', 'afsluttet') THEN 'demontage'
  WHEN attachments ? 'demontage' THEN 'demontage'
  ELSE 'montage'
END
WHERE phase IS NULL
  OR phase IN ('draft', 'ready_for_demontage', 'completed')
  OR phase NOT IN ('montage', 'demontage');

-- Seed demo team + members + sample cases (idempotent).
DO $$
DECLARE
  demo_team_id uuid := '00000000-0000-4000-8000-000000000010';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE slug = 'demo') THEN
    INSERT INTO teams (id, name, slug, created_at, created_by_sub)
    VALUES (demo_team_id, 'Demo Team', 'demo', NOW(), NULL);
  END IF;

  INSERT INTO team_members (team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at)
  VALUES
    (demo_team_id, 'auth0|demo-owner', 'demo-owner@sscaff.app', 'Demo Owner', 'owner', 'active', NOW(), NOW(), NOW()),
    (demo_team_id, 'auth0|demo-member', 'demo-member@sscaff.app', 'Demo Member', 'member', 'active', NOW(), NOW(), NOW())
  ON CONFLICT (team_id, user_sub) DO NOTHING;

  INSERT INTO team_cases
    (case_id, team_id, job_number, case_kind, system, totals, status, phase, attachments,
     created_at, updated_at, last_updated_at, created_by, created_by_email, created_by_name, updated_by, last_editor_sub, json_content)
  VALUES
    ('00000000-0000-4000-8000-000000000101', demo_team_id, 'DEMO-1001', 'montage', 'Bosta',
     '{"materials": 1200, "montage": 3500, "demontage": 0, "total": 4700}',
     'kladde', 'montage', '{}'::jsonb,
     NOW() - interval '5 days', NOW() - interval '5 days', NOW() - interval '5 days',
     'auth0|demo-owner', 'demo-owner@sscaff.app', 'Demo Owner', 'auth0|demo-owner', 'auth0|demo-owner',
     '{"meta": {"jobNumber": "DEMO-1001"}, "totals": {"materials": 1200, "total": 4700}}'
    ),
    ('00000000-0000-4000-8000-000000000102', demo_team_id, 'DEMO-1002', 'montage', 'Bosta',
     '{"materials": 1500, "montage": 4200, "demontage": 0, "total": 5700}',
     'godkendt', 'montage',
     jsonb_build_object(
       'montage', jsonb_build_object('exported_at', NOW() - interval '4 days', 'payload', jsonb_build_object('totals', jsonb_build_object('materials', 1500, 'total', 5700)))
     ),
     NOW() - interval '4 days', NOW() - interval '3 days', NOW() - interval '3 days',
     'auth0|demo-owner', 'demo-owner@sscaff.app', 'Demo Owner', 'auth0|demo-owner', 'auth0|demo-owner',
     '{"meta": {"jobNumber": "DEMO-1002"}, "totals": {"materials": 1500, "total": 5700}}'
    ),
    ('00000000-0000-4000-8000-000000000103', demo_team_id, 'DEMO-1003', 'demontage', 'Bosta',
     '{"materials": 1600, "montage": 4200, "demontage": 800, "total": 6600}',
     'demontage_i_gang', 'demontage',
     jsonb_build_object(
       'montage', jsonb_build_object('exported_at', NOW() - interval '7 days', 'payload', jsonb_build_object('totals', jsonb_build_object('materials', 1400, 'total', 5600))),
       'demontage', jsonb_build_object('exported_at', NOW() - interval '1 days', 'payload', jsonb_build_object('totals', jsonb_build_object('materials', 200, 'total', 1000)))
     ),
     NOW() - interval '7 days', NOW() - interval '1 days', NOW() - interval '1 days',
     'auth0|demo-owner', 'demo-owner@sscaff.app', 'Demo Owner', 'auth0|demo-member', 'auth0|demo-member',
     '{"meta": {"jobNumber": "DEMO-1003"}, "totals": {"materials": 1600, "total": 6600}}'
    ),
    ('00000000-0000-4000-8000-000000000104', demo_team_id, 'DEMO-1004', 'demontage', 'Bosta',
     '{"materials": 2000, "montage": 4500, "demontage": 1200, "total": 7700}',
     'afsluttet', 'demontage',
     jsonb_build_object(
       'montage', jsonb_build_object('exported_at', NOW() - interval '8 days', 'payload', jsonb_build_object('totals', jsonb_build_object('materials', 1700, 'total', 6200))),
       'demontage', jsonb_build_object('exported_at', NOW() - interval '2 days', 'payload', jsonb_build_object('totals', jsonb_build_object('materials', 300, 'total', 1500))),
       'receipt', jsonb_build_object('createdAt', NOW() - interval '2 days', 'totals', jsonb_build_object('materials', 2000, 'montage', 6200, 'demontage', 1500, 'total', 7700, 'hours', 80))
     ),
     NOW() - interval '8 days', NOW() - interval '2 days', NOW() - interval '2 days',
     'auth0|demo-owner', 'demo-owner@sscaff.app', 'Demo Owner', 'auth0|demo-owner', 'auth0|demo-owner',
     '{"meta": {"jobNumber": "DEMO-1004"}, "totals": {"materials": 2000, "total": 7700}}'
    )
  ON CONFLICT (case_id) DO NOTHING;

  INSERT INTO team_cases
    (case_id, team_id, job_number, case_kind, system, totals, status, phase, attachments,
     created_at, updated_at, last_updated_at, created_by, created_by_email, created_by_name, updated_by, last_editor_sub,
     json_content, deleted_at, deleted_by)
  VALUES
    ('00000000-0000-4000-8000-000000000105', demo_team_id, 'DEMO-1005', 'montage', 'Bosta',
     '{"materials": 900, "montage": 2500, "demontage": 0, "total": 3400}',
     'deleted', 'montage', '{}'::jsonb,
     NOW() - interval '10 days', NOW() - interval '10 days', NOW() - interval '9 days',
     'auth0|demo-owner', 'demo-owner@sscaff.app', 'Demo Owner', 'auth0|demo-owner', 'auth0|demo-owner',
     '{"meta": {"jobNumber": "DEMO-1005"}, "totals": {"materials": 900, "total": 3400}}',
     NOW() - interval '9 days', 'auth0|demo-owner'
    )
  ON CONFLICT (case_id) DO NOTHING;
END $$;
