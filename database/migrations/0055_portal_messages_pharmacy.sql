-- Portal: Nachrichten zwischen Portal-Zugängen und der Pflege sowie das Apothekenportal (Zugangsart „Apotheke“ mit
-- Bestellungen der Einrichtung).
ALTER TABLE carecore_portal_accounts DROP CONSTRAINT IF EXISTS carecore_portal_accounts_kind_check;
ALTER TABLE carecore_portal_accounts ADD CONSTRAINT carecore_portal_accounts_kind_check
  CHECK (kind IN ('relative', 'physician', 'pharmacy'));

CREATE TABLE IF NOT EXISTS carecore_portal_threads (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES carecore_portal_accounts(id) ON DELETE CASCADE,
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE SET NULL,
  subject VARCHAR(160) NOT NULL,
  started_by VARCHAR(10) NOT NULL CHECK (started_by IN ('portal', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  portal_read_at TIMESTAMPTZ,
  staff_read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS carecore_portal_threads_org_idx ON carecore_portal_threads (organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS carecore_portal_threads_account_idx ON carecore_portal_threads (account_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS carecore_portal_messages (
  id UUID PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES carecore_portal_threads(id) ON DELETE CASCADE,
  sender VARCHAR(10) NOT NULL CHECK (sender IN ('portal', 'staff')),
  sender_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (LENGTH(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_portal_messages_thread_idx ON carecore_portal_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS carecore_pharmacy_orders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES carecore_portal_accounts(id) ON DELETE CASCADE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE SET NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'confirmed', 'delivered', 'rejected', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  pharmacy_note TEXT NOT NULL DEFAULT '',
  expected_on DATE,
  requested_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_pharmacy_orders_org_idx ON carecore_pharmacy_orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carecore_pharmacy_orders_account_idx ON carecore_pharmacy_orders (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS carecore_pharmacy_order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES carecore_pharmacy_orders(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL,
  medication VARCHAR(220) NOT NULL,
  strength VARCHAR(80) NOT NULL DEFAULT '',
  quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(40) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS carecore_pharmacy_order_items_order_idx ON carecore_pharmacy_order_items (order_id, position);
