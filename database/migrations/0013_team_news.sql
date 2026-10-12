-- Team news: channels, posts with importance and optional read confirmation, per-person read state.

CREATE TABLE IF NOT EXISTS carecore_channels (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  description TEXT,
  color VARCHAR(16) NOT NULL DEFAULT 'blue' CHECK (color IN ('blue', 'green', 'orange', 'purple', 'red', 'gray')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  managers_only BOOLEAN NOT NULL DEFAULT FALSE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS carecore_channel_members (
  channel_id UUID NOT NULL REFERENCES carecore_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS carecore_posts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES carecore_channels(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  importance VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal', 'important', 'critical')),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  requires_ack BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  archive_reason TEXT
);
CREATE INDEX IF NOT EXISTS carecore_posts_org_time_idx ON carecore_posts (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS carecore_post_reads (
  post_id UUID NOT NULL REFERENCES carecore_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (post_id, user_id)
);

-- Every organization gets a house-wide channel that includes everybody.
INSERT INTO carecore_channels (id, organization_id, name, description, color, is_default, managers_only)
SELECT gen_random_uuid(), o.id, 'Haus', 'Informationen der Leitung an alle Mitarbeitenden', 'orange', TRUE, TRUE
FROM carecore_organizations o
WHERE NOT EXISTS (SELECT 1 FROM carecore_channels c WHERE c.organization_id = o.id AND c.is_default);
