CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY,
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_invites (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  accepted_by uuid REFERENCES users(id),
  accepted_at timestamptz
);

CREATE INDEX IF NOT EXISTS team_invites_team_status_idx ON team_invites (team_id, status);

CREATE TABLE IF NOT EXISTS team_cases (
  case_id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  job_number text,
  case_kind text,
  system text,
  totals jsonb,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  last_updated_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_by_email text,
  created_by_name text,
  updated_by uuid,
  json_content text,
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS team_cases_team_deleted_idx ON team_cases (team_id, deleted_at);

CREATE TABLE IF NOT EXISTS team_audit (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id uuid,
  action text,
  actor jsonb,
  summary text,
  created_at timestamptz DEFAULT now()
);
