-- Dienstplan-Modul (docs/specs/dienstplan.md): Regelwerk, Personalprofile, Qualifikationen,
-- Diensttypen, Mindestbesetzung, Perioden, Dienste, Wunschfrei, Dienstwünsche, Tausch,
-- Zeiterfassung, Feiertage, KI-Läufe und ein unveränderliches Audit-Log.
-- Bestehende Einteilungen, Check-ins und bewilligte Abwesenheiten werden übernommen.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Aborts the statement (and its transaction) with a code the API turns into a message.
CREATE OR REPLACE FUNCTION carecore_assert(condition BOOLEAN, code TEXT) RETURNS BOOLEAN AS $$
BEGIN
  IF condition IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = code;
  END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Regelwerk pro Organisation, optional pro Wohnbereich überschrieben. Werte sind Beispielwerte,
-- bis die Leitung sie bestätigt (values_confirmed_at).
CREATE TABLE IF NOT EXISTS carecore_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Zurich',
  weekly_norm_minutes INTEGER NOT NULL DEFAULT 2520 CHECK (weekly_norm_minutes BETWEEN 60 AND 6000),
  min_rest_minutes INTEGER NOT NULL DEFAULT 660 CHECK (min_rest_minutes BETWEEN 0 AND 1440),
  max_daily_work_minutes INTEGER NOT NULL DEFAULT 600 CHECK (max_daily_work_minutes BETWEEN 60 AND 1440),
  max_weekly_work_minutes INTEGER NOT NULL DEFAULT 3000 CHECK (max_weekly_work_minutes BETWEEN 60 AND 10080),
  max_consecutive_work_days SMALLINT NOT NULL DEFAULT 6 CHECK (max_consecutive_work_days BETWEEN 1 AND 31),
  break_rules JSONB NOT NULL DEFAULT '[{"minWorkMinutes":330,"minBreakMinutes":15},{"minWorkMinutes":420,"minBreakMinutes":30},{"minWorkMinutes":540,"minBreakMinutes":60}]'::jsonb,
  night_start CHAR(5) NOT NULL DEFAULT '23:00' CHECK (night_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  night_end CHAR(5) NOT NULL DEFAULT '06:00' CHECK (night_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  deviation_threshold_minutes INTEGER NOT NULL DEFAULT 30 CHECK (deviation_threshold_minutes BETWEEN 1 AND 1440),
  missing_clock_out_after_minutes INTEGER NOT NULL DEFAULT 120 CHECK (missing_clock_out_after_minutes BETWEEN 1 AND 1440),
  clock_in_earliest_minutes INTEGER NOT NULL DEFAULT 60 CHECK (clock_in_earliest_minutes BETWEEN 0 AND 720),
  auto_swap_approval BOOLEAN NOT NULL DEFAULT TRUE,
  allow_shift_takeover BOOLEAN NOT NULL DEFAULT FALSE,
  ai_runs_per_hour SMALLINT NOT NULL DEFAULT 10 CHECK (ai_runs_per_hour BETWEEN 0 AND 100),
  values_confirmed_at TIMESTAMPTZ,
  values_confirmed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_rule_sets_scope_idx
  ON carecore_rule_sets (organization_id, COALESCE(care_unit_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Beschäftigung (1:1 zur Person). Ausgeschlossene Kategorien ohne Begründung.
CREATE TABLE IF NOT EXISTS carecore_employee_profiles (
  user_id UUID PRIMARY KEY REFERENCES carecore_users(id) ON DELETE CASCADE,
  pensum_percent NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (pensum_percent > 0 AND pensum_percent <= 100),
  weekly_target_minutes_override INTEGER CHECK (weekly_target_minutes_override IS NULL OR weekly_target_minutes_override BETWEEN 0 AND 6000),
  employment_start DATE,
  employment_end DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  excluded_categories TEXT[] NOT NULL DEFAULT '{}' CHECK (excluded_categories <@ ARRAY['NIGHT', 'STANDBY', 'ON_CALL']::text[]),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (employment_end IS NULL OR employment_start IS NULL OR employment_end >= employment_start)
);

-- Zugehörigkeit zu Wohnbereichen: planbar (Zeile im Dienstplan) und/oder Leitung (plant den Bereich).
CREATE TABLE IF NOT EXISTS carecore_unit_memberships (
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  plannable BOOLEAN NOT NULL DEFAULT TRUE,
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, care_unit_id),
  CHECK (plannable OR is_lead)
);
CREATE INDEX IF NOT EXISTS carecore_unit_memberships_unit_idx ON carecore_unit_memberships (care_unit_id);

CREATE TABLE IF NOT EXISTS carecore_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS carecore_employee_qualifications (
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  qualification_id UUID NOT NULL REFERENCES carecore_qualifications(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  PRIMARY KEY (user_id, qualification_id, valid_from),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE IF NOT EXISTS carecore_shift_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  code VARCHAR(8) NOT NULL,
  category VARCHAR(12) NOT NULL CHECK (category IN ('WORK', 'STANDBY', 'ON_CALL', 'ABSENCE')),
  absence_kind VARCHAR(12) CHECK (absence_kind IN ('VACATION', 'SICK', 'TRAINING', 'OTHER')),
  start_time CHAR(5) NOT NULL CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time CHAR(5) NOT NULL CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  break_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 240),
  color CHAR(7) NOT NULL DEFAULT '#2563eb' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  work_time_factor NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (work_time_factor BETWEEN 0 AND 1),
  credits_target BOOLEAN NOT NULL DEFAULT FALSE,
  required_qualification_ids UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code),
  CHECK ((category = 'ABSENCE') = (absence_kind IS NOT NULL)),
  CHECK (start_time <> end_time)
);

-- Mindestbesetzung je Wochentag (1 = Montag) oder für ein Datum (überschreibt den Wochentag).
CREATE TABLE IF NOT EXISTS carecore_staffing_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  shift_type_id UUID NOT NULL REFERENCES carecore_shift_types(id) ON DELETE CASCADE,
  weekday SMALLINT CHECK (weekday BETWEEN 1 AND 7),
  date DATE,
  min_count SMALLINT NOT NULL CHECK (min_count BETWEEN 0 AND 50),
  max_count SMALLINT CHECK (max_count IS NULL OR max_count BETWEEN 0 AND 50),
  min_qualified SMALLINT CHECK (min_qualified IS NULL OR min_qualified BETWEEN 0 AND 50),
  qualification_id UUID REFERENCES carecore_qualifications(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((weekday IS NULL) <> (date IS NULL)),
  CHECK (max_count IS NULL OR max_count >= min_count),
  CHECK ((min_qualified IS NULL) = (qualification_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_staffing_weekday_idx
  ON carecore_staffing_requirements (care_unit_id, shift_type_id, weekday) WHERE weekday IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carecore_staffing_date_idx
  ON carecore_staffing_requirements (care_unit_id, shift_type_id, date) WHERE date IS NOT NULL;

CREATE TABLE IF NOT EXISTS carecore_schedule_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE RESTRICT,
  year SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (care_unit_id, year, month)
);

-- Ein Dienst = eine Person an einem Tag. "date" ist der lokale Kalendertag des Dienstbeginns.
CREATE TABLE IF NOT EXISTS carecore_roster_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES carecore_schedule_periods(id) ON DELETE RESTRICT,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE RESTRICT,
  shift_type_id UUID NOT NULL REFERENCES carecore_shift_types(id) ON DELETE RESTRICT,
  category VARCHAR(12) NOT NULL CHECK (category IN ('WORK', 'STANDBY', 'ON_CALL', 'ABSENCE')),
  date DATE NOT NULL,
  planned_start TIMESTAMPTZ(3) NOT NULL,
  planned_end TIMESTAMPTZ(3) NOT NULL,
  break_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 240),
  source VARCHAR(12) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'DRAG_DROP', 'AI', 'SWAP', 'SEED', 'IMPORT')),
  notes TEXT,
  last_swap_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  CONSTRAINT carecore_roster_shift_time_order CHECK (planned_end > planned_start)
);
CREATE INDEX IF NOT EXISTS carecore_roster_shifts_unit_date_idx ON carecore_roster_shifts (care_unit_id, date);
CREATE INDEX IF NOT EXISTS carecore_roster_shifts_employee_date_idx ON carecore_roster_shifts (employee_id, date);
CREATE INDEX IF NOT EXISTS carecore_roster_shifts_period_idx ON carecore_roster_shifts (period_id);

-- Wunschfrei (Urlaub, Krankheit, Fortbildung sind Abwesenheitsdienste).
CREATE TABLE IF NOT EXISTS carecore_time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  priority VARCHAR(8) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  reason VARCHAR(200),
  comment VARCHAR(1000),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decided_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_comment VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS carecore_time_off_unit_idx ON carecore_time_off_requests (care_unit_id, start_date);
CREATE INDEX IF NOT EXISTS carecore_time_off_employee_idx ON carecore_time_off_requests (employee_id, start_date);

CREATE TABLE IF NOT EXISTS carecore_shift_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('PREFER_SHIFT_TYPE', 'AVOID_SHIFT_TYPE', 'PREFER_WEEKDAY', 'AVOID_WEEKDAY', 'AVOID_CATEGORY')),
  shift_type_id UUID REFERENCES carecore_shift_types(id) ON DELETE CASCADE,
  weekday SMALLINT CHECK (weekday BETWEEN 1 AND 7),
  category VARCHAR(12) CHECK (category IN ('NIGHT', 'STANDBY', 'ON_CALL')),
  date DATE,
  valid_from DATE,
  valid_until DATE,
  comment VARCHAR(300),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS carecore_shift_preferences_employee_idx ON carecore_shift_preferences (employee_id) WHERE active;

CREATE TABLE IF NOT EXISTS carecore_shift_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  target_employee_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  source_shift_id UUID NOT NULL REFERENCES carecore_roster_shifts(id) ON DELETE CASCADE,
  target_shift_id UUID REFERENCES carecore_roster_shifts(id) ON DELETE CASCADE,
  source_shift_version INTEGER NOT NULL,
  target_shift_version INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING_TARGET' CHECK (status IN (
    'PENDING_TARGET', 'PENDING_APPROVAL', 'EXECUTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'REJECTED', 'FAILED')),
  message VARCHAR(500),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ,
  failure_code VARCHAR(40),
  failure_message VARCHAR(500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (requester_id <> target_employee_id),
  CHECK ((target_shift_id IS NULL) = (target_shift_version IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_shift_swap_one_active_per_source
  ON carecore_shift_swaps (source_shift_id) WHERE status IN ('PENDING_TARGET', 'PENDING_APPROVAL');
CREATE INDEX IF NOT EXISTS carecore_shift_swaps_target_idx ON carecore_shift_swaps (target_employee_id, status);
CREATE INDEX IF NOT EXISTS carecore_shift_swaps_unit_idx ON carecore_shift_swaps (care_unit_id, requested_at DESC);

ALTER TABLE carecore_roster_shifts ADD CONSTRAINT carecore_roster_shifts_last_swap_fk
  FOREIGN KEY (last_swap_id) REFERENCES carecore_shift_swaps(id) ON DELETE SET NULL;

-- Zeiterfassung. Offene Einträge (Status OPEN) höchstens einer pro Person.
CREATE TABLE IF NOT EXISTS carecore_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE RESTRICT,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE RESTRICT,
  shift_id UUID REFERENCES carecore_roster_shifts(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ(3) NOT NULL,
  clock_out TIMESTAMPTZ(3),
  break_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 600),
  break_started_at TIMESTAMPTZ(3),
  source VARCHAR(12) NOT NULL DEFAULT 'CLOCK' CHECK (source IN ('CLOCK', 'MANUAL', 'CORRECTION', 'IMPORT', 'SEED')),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETE', 'INCOMPLETE', 'APPROVED')),
  actual_minutes INTEGER,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  handover_status VARCHAR(24) CHECK (handover_status IN ('complete', 'partial', 'pending')),
  check_in_note TEXT,
  check_out_note TEXT,
  missing_notified_at TIMESTAMPTZ,
  deviation_notified_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  CHECK (clock_out IS NULL OR clock_out > clock_in),
  CHECK (status <> 'OPEN' OR clock_out IS NULL),
  CHECK (status NOT IN ('COMPLETE', 'APPROVED') OR clock_out IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_time_entry_one_open_per_employee
  ON carecore_time_entries (employee_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS carecore_time_entry_one_per_shift ON carecore_time_entries (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carecore_time_entries_employee_date_idx ON carecore_time_entries (employee_id, date);
CREATE INDEX IF NOT EXISTS carecore_time_entries_unit_date_idx ON carecore_time_entries (care_unit_id, date);

CREATE TABLE IF NOT EXISTS carecore_time_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  time_entry_id UUID NOT NULL REFERENCES carecore_time_entries(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  requested_clock_in TIMESTAMPTZ(3),
  requested_clock_out TIMESTAMPTZ(3),
  requested_break_minutes SMALLINT CHECK (requested_break_minutes IS NULL OR requested_break_minutes BETWEEN 0 AND 600),
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED')),
  decided_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_comment VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_time_corrections_entry_idx ON carecore_time_corrections (time_entry_id);

CREATE TABLE IF NOT EXISTS carecore_public_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, date)
);

CREATE TABLE IF NOT EXISTS carecore_ai_planning_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES carecore_schedule_periods(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('GENERATE', 'OPTIMIZE')),
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  model VARCHAR(80) NOT NULL,
  input_hash CHAR(64) NOT NULL,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  result JSONB,
  violations JSONB,
  error TEXT,
  applied_at TIMESTAMPTZ,
  applied_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_ai_runs_requester_idx ON carecore_ai_planning_runs (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS carecore_ai_runs_period_idx ON carecore_ai_planning_runs (period_id, created_at DESC);

-- Audit-Log des Dienstplans: append-only, ohne Fremdschlüssel (der Name der handelnden
-- Person wird als Text festgehalten, damit Löschungen den Eintrag nie verändern).
CREATE TABLE IF NOT EXISTS carecore_roster_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  actor_id UUID,
  actor_label VARCHAR(160) NOT NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  care_unit_id UUID,
  before_data JSONB,
  after_data JSONB,
  reason TEXT,
  source VARCHAR(12) NOT NULL CHECK (source IN ('UI', 'SWAP', 'AI', 'SYSTEM', 'SEED', 'IMPORT')),
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_roster_audit_entity_idx ON carecore_roster_audit (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS carecore_roster_audit_unit_idx ON carecore_roster_audit (care_unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carecore_roster_audit_org_idx ON carecore_roster_audit (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION carecore_roster_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog ist unveränderlich (append-only)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER carecore_roster_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON carecore_roster_audit
  FOR EACH ROW EXECUTE FUNCTION carecore_roster_audit_immutable();

CREATE TRIGGER carecore_roster_audit_no_truncate
  BEFORE TRUNCATE ON carecore_roster_audit
  FOR EACH STATEMENT EXECUTE FUNCTION carecore_roster_audit_immutable();

ALTER TABLE carecore_notifications ADD COLUMN IF NOT EXISTS entity_type VARCHAR(40);
ALTER TABLE carecore_notifications ADD COLUMN IF NOT EXISTS entity_id UUID;
CREATE INDEX IF NOT EXISTS carecore_notifications_user_read_idx ON carecore_notifications (user_id, read_at);

-- Grunddaten je Organisation: Regelwerk (Beispielwerte), Qualifikationen und Diensttypen.
INSERT INTO carecore_rule_sets (organization_id, timezone)
SELECT id, timezone FROM carecore_organizations
ON CONFLICT DO NOTHING;

INSERT INTO carecore_qualifications (organization_id, code, name)
SELECT o.id, q.code, q.name FROM carecore_organizations o
CROSS JOIN (VALUES ('HF', 'Pflegefachperson HF'), ('FAGE', 'Fachperson Gesundheit'), ('SRK', 'Pflegehelfer:in SRK')) AS q(code, name)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO carecore_shift_types (organization_id, name, code, category, absence_kind, start_time, end_time, break_minutes, color, work_time_factor, credits_target, sort_order)
SELECT o.id, t.name, t.code, t.category, t.absence_kind, t.start_time, t.end_time, t.break_minutes, t.color, t.factor, t.credits, t.sort_order
FROM carecore_organizations o
CROSS JOIN (VALUES
  ('Frühdienst', 'F', 'WORK', NULL, '07:00', '15:30', 30, '#2563eb', 1.0, FALSE, 10),
  ('Zwischendienst', 'Z', 'WORK', NULL, '08:00', '16:30', 30, '#0f766e', 1.0, FALSE, 20),
  ('Spätdienst', 'S', 'WORK', NULL, '13:30', '22:00', 30, '#b45309', 1.0, FALSE, 30),
  ('Nachtdienst', 'N', 'WORK', NULL, '21:45', '07:15', 30, '#4338ca', 1.0, FALSE, 40),
  ('Bereitschaft', 'B', 'STANDBY', NULL, '07:00', '19:00', 0, '#64748b', 1.0, FALSE, 50),
  ('Rufbereitschaft', 'R', 'ON_CALL', NULL, '19:00', '07:00', 0, '#7c3aed', 0.0, FALSE, 60),
  ('Urlaub', 'U', 'ABSENCE', 'VACATION', '08:00', '16:24', 0, '#15803d', 1.0, TRUE, 70),
  ('Krank', 'K', 'ABSENCE', 'SICK', '08:00', '16:24', 0, '#be123c', 1.0, TRUE, 80),
  ('Fortbildung', 'FB', 'ABSENCE', 'TRAINING', '08:00', '16:24', 0, '#0369a1', 1.0, TRUE, 90),
  ('Abwesend', 'A', 'ABSENCE', 'OTHER', '08:00', '16:24', 0, '#6b7280', 1.0, FALSE, 100)
) AS t(name, code, category, absence_kind, start_time, end_time, break_minutes, color, factor, credits, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

-- Personen: Beschäftigungsprofil und Zugehörigkeit zum Stammwohnbereich.
INSERT INTO carecore_employee_profiles (user_id, active)
SELECT u.id, u.active FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
WHERE p.organization_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
SELECT p.user_id, p.primary_care_unit_id, TRUE, FALSE FROM carecore_user_profiles p
WHERE p.primary_care_unit_id IS NOT NULL
ON CONFLICT (user_id, care_unit_id) DO NOTHING;

-- Wer bisher Dienste planen durfte, leitet zunächst alle Wohnbereiche der Organisation.
INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
SELECT u.id, cu.id, FALSE, TRUE
FROM carecore_users u
JOIN carecore_user_profiles p ON p.user_id = u.id
JOIN carecore_roles r ON r.key = u.role
JOIN carecore_sites si ON si.organization_id = p.organization_id
JOIN carecore_care_units cu ON cu.site_id = si.id
WHERE r.permissions ? 'schedule.manage'
ON CONFLICT (user_id, care_unit_id) DO UPDATE SET is_lead = TRUE;

-- Qualifikationen aus der Funktionsbezeichnung ableiten, wo sie eindeutig ist.
INSERT INTO carecore_employee_qualifications (user_id, qualification_id, valid_from)
SELECT p.user_id, q.id, DATE '2000-01-01'
FROM carecore_user_profiles p
JOIN carecore_qualifications q ON q.organization_id = p.organization_id
WHERE (q.code = 'HF' AND p.job_title ILIKE '%HF%')
   OR (q.code = 'FAGE' AND p.job_title ILIKE '%Fachperson Gesundheit%')
   OR (q.code = 'SRK' AND p.job_title ILIKE '%SRK%')
ON CONFLICT DO NOTHING;

-- Übernahme des bisherigen Dienstplans ------------------------------------------------

-- Wohnbereich und lokaler Tag jeder bisherigen Einteilung.
CREATE TEMP TABLE carecore_legacy_duties ON COMMIT DROP AS
SELECT a.id AS assignment_id, a.user_id, s.organization_id, s.name, s.note, s.created_by, s.starts_at, s.ends_at,
  a.checked_in_at, a.checked_out_at, a.checklist, a.handover_status, a.check_in_note, a.check_out_note,
  o.timezone,
  (s.starts_at AT TIME ZONE o.timezone)::date AS local_date,
  COALESCE(s.care_unit_id, p.primary_care_unit_id, (
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE si.organization_id = s.organization_id ORDER BY cu.created_at, cu.id LIMIT 1)) AS care_unit_id
FROM carecore_shift_assignments a
JOIN carecore_shifts s ON s.id = a.shift_id
JOIN carecore_organizations o ON o.id = s.organization_id
LEFT JOIN carecore_user_profiles p ON p.user_id = a.user_id
WHERE s.status <> 'cancelled' AND a.status <> 'absent';

DELETE FROM carecore_legacy_duties WHERE care_unit_id IS NULL;

-- Unbekannte Dienstnamen werden als eigene Diensttypen übernommen.
INSERT INTO carecore_shift_types (organization_id, name, code, category, start_time, end_time, break_minutes, color, sort_order)
SELECT organization_id, LEFT(name, 80), 'X' || LPAD(ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY name)::text, 3, '0'),
  'WORK', start_time, CASE WHEN end_time = start_time THEN LEFT((end_time::time + INTERVAL '1 minute')::time::text, 5) ELSE end_time END,
  30, '#475569', 200
FROM (
  SELECT DISTINCT ON (organization_id, name) organization_id, name,
    to_char(starts_at AT TIME ZONE timezone, 'HH24:MI') AS start_time,
    to_char(ends_at AT TIME ZONE timezone, 'HH24:MI') AS end_time
  FROM carecore_legacy_duties
  WHERE name NOT IN ('Frühdienst', 'Spätdienst', 'Nachtwache', 'Tagdienst')
  ORDER BY organization_id, name, starts_at
) unknown
ON CONFLICT (organization_id, code) DO NOTHING;

ALTER TABLE carecore_legacy_duties ADD COLUMN shift_type_id UUID;
UPDATE carecore_legacy_duties d SET shift_type_id = t.id
FROM carecore_shift_types t
WHERE t.organization_id = d.organization_id AND t.code = CASE d.name
  WHEN 'Frühdienst' THEN 'F' WHEN 'Spätdienst' THEN 'S' WHEN 'Nachtwache' THEN 'N' WHEN 'Tagdienst' THEN 'Z' ELSE NULL END;
UPDATE carecore_legacy_duties d SET shift_type_id = t.id
FROM carecore_shift_types t
WHERE d.shift_type_id IS NULL AND t.organization_id = d.organization_id AND t.code LIKE 'X%' AND t.name = LEFT(d.name, 80);
DELETE FROM carecore_legacy_duties WHERE shift_type_id IS NULL;

-- Bewilligte Abwesenheiten werden zu Abwesenheitsdiensten (Montag bis Freitag).
CREATE TEMP TABLE carecore_legacy_absences ON COMMIT DROP AS
SELECT ab.user_id, ab.organization_id, o.timezone, day::date AS local_date, t.id AS shift_type_id, t.start_time, t.end_time,
  COALESCE(p.primary_care_unit_id, (
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE si.organization_id = ab.organization_id ORDER BY cu.created_at, cu.id LIMIT 1)) AS care_unit_id
FROM carecore_absences ab
JOIN carecore_organizations o ON o.id = ab.organization_id
LEFT JOIN carecore_user_profiles p ON p.user_id = ab.user_id
CROSS JOIN LATERAL generate_series(ab.starts_on, ab.ends_on, INTERVAL '1 day') AS day
JOIN carecore_shift_types t ON t.organization_id = ab.organization_id AND t.code = CASE ab.kind
  WHEN 'vacation' THEN 'U' WHEN 'sick' THEN 'K' WHEN 'training' THEN 'FB' ELSE 'A' END
WHERE ab.status = 'approved' AND EXTRACT(ISODOW FROM day) < 6;

DELETE FROM carecore_legacy_absences WHERE care_unit_id IS NULL;

INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
SELECT DISTINCT user_id, care_unit_id, TRUE, FALSE FROM (
  SELECT user_id, care_unit_id FROM carecore_legacy_duties
  UNION SELECT user_id, care_unit_id FROM carecore_legacy_absences) people
ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = TRUE;

INSERT INTO carecore_employee_profiles (user_id)
SELECT DISTINCT user_id FROM (
  SELECT user_id FROM carecore_legacy_duties UNION SELECT user_id FROM carecore_legacy_absences) people
ON CONFLICT (user_id) DO NOTHING;

-- Übernommene Monate gelten als veröffentlicht.
INSERT INTO carecore_schedule_periods (organization_id, care_unit_id, year, month, status, published_at)
SELECT DISTINCT organization_id, care_unit_id, EXTRACT(YEAR FROM local_date)::smallint, EXTRACT(MONTH FROM local_date)::smallint,
  'PUBLISHED', NOW()
FROM (
  SELECT organization_id, care_unit_id, local_date FROM carecore_legacy_duties
  UNION SELECT organization_id, care_unit_id, local_date FROM carecore_legacy_absences) months
ON CONFLICT (care_unit_id, year, month) DO NOTHING;

INSERT INTO carecore_roster_shifts (id, organization_id, period_id, care_unit_id, employee_id, shift_type_id, category, date,
  planned_start, planned_end, break_minutes, source, notes, created_by)
SELECT d.assignment_id, d.organization_id, pe.id, d.care_unit_id, d.user_id, d.shift_type_id, 'WORK', d.local_date,
  d.starts_at, d.ends_at, t.break_minutes, 'IMPORT', d.note, d.created_by
FROM carecore_legacy_duties d
JOIN carecore_shift_types t ON t.id = d.shift_type_id
JOIN carecore_schedule_periods pe ON pe.care_unit_id = d.care_unit_id
  AND pe.year = EXTRACT(YEAR FROM d.local_date) AND pe.month = EXTRACT(MONTH FROM d.local_date);

INSERT INTO carecore_roster_shifts (organization_id, period_id, care_unit_id, employee_id, shift_type_id, category, date,
  planned_start, planned_end, break_minutes, source)
SELECT DISTINCT ON (a.user_id, a.local_date) a.organization_id, pe.id, a.care_unit_id, a.user_id, a.shift_type_id, 'ABSENCE', a.local_date,
  (a.local_date + a.start_time::time) AT TIME ZONE a.timezone,
  (a.local_date + a.end_time::time) AT TIME ZONE a.timezone, 0, 'IMPORT'
FROM carecore_legacy_absences a
JOIN carecore_schedule_periods pe ON pe.care_unit_id = a.care_unit_id
  AND pe.year = EXTRACT(YEAR FROM a.local_date) AND pe.month = EXTRACT(MONTH FROM a.local_date)
ORDER BY a.user_id, a.local_date;

-- Überschneidende Arbeitsdienste derselben Person: der früher beginnende bleibt.
DELETE FROM carecore_roster_shifts later
USING carecore_roster_shifts earlier
WHERE later.source = 'IMPORT' AND later.employee_id = earlier.employee_id AND later.id <> earlier.id
  AND later.category <> 'ABSENCE' AND earlier.category <> 'ABSENCE'
  AND tstzrange(later.planned_start, later.planned_end, '[)') && tstzrange(earlier.planned_start, earlier.planned_end, '[)')
  AND (later.planned_start, later.id) > (earlier.planned_start, earlier.id);

-- Check-ins werden Zeiteinträge; offen bleibt höchstens der jüngste pro Person.
INSERT INTO carecore_time_entries (organization_id, employee_id, care_unit_id, shift_id, date, clock_in, clock_out, break_minutes,
  source, status, actual_minutes, checklist, handover_status, check_in_note, check_out_note)
SELECT d.organization_id, d.user_id, d.care_unit_id, rs.id, d.local_date, d.checked_in_at, d.checked_out_at,
  CASE WHEN d.checked_out_at IS NULL THEN 0 ELSE LEAST(rs.break_minutes, GREATEST(FLOOR(EXTRACT(EPOCH FROM d.checked_out_at - d.checked_in_at) / 60)::int - 1, 0)) END,
  'IMPORT',
  CASE WHEN d.checked_out_at IS NOT NULL THEN 'COMPLETE'
    WHEN ROW_NUMBER() OVER (PARTITION BY d.user_id, d.checked_out_at IS NULL ORDER BY d.checked_in_at DESC) = 1
      AND d.ends_at > NOW() - INTERVAL '6 hours' THEN 'OPEN'
    ELSE 'INCOMPLETE' END,
  CASE WHEN d.checked_out_at IS NULL THEN NULL
    ELSE GREATEST(FLOOR(EXTRACT(EPOCH FROM d.checked_out_at - d.checked_in_at) / 60)::int
      - LEAST(rs.break_minutes, GREATEST(FLOOR(EXTRACT(EPOCH FROM d.checked_out_at - d.checked_in_at) / 60)::int - 1, 0)), 0) END,
  COALESCE(d.checklist, '[]'::jsonb), d.handover_status, d.check_in_note, d.check_out_note
FROM carecore_legacy_duties d
JOIN carecore_roster_shifts rs ON rs.id = d.assignment_id
WHERE d.checked_in_at IS NOT NULL AND (d.checked_out_at IS NULL OR d.checked_out_at > d.checked_in_at);

-- Keine überlappenden Arbeitsdienste pro Person (Abwesenheiten ausgenommen). DEFERRABLE, damit
-- ein Tausch innerhalb einer Transaktion kurzzeitig überlappen darf.
ALTER TABLE carecore_roster_shifts ADD CONSTRAINT carecore_roster_shift_no_overlap
  EXCLUDE USING gist (employee_id WITH =, tstzrange(planned_start, planned_end, '[)') WITH &&)
  WHERE (category <> 'ABSENCE')
  DEFERRABLE INITIALLY DEFERRED;
