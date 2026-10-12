-- Persönliche Anordnung einrichtbarer Seiten (Kennzahlen): Reihenfolge, Breite, Stapelung und ausgeblendete Bausteine
-- je Person und Seite. Die Startseite behält ihre eigene Tabelle (carecore_user_dashboard_layouts).
CREATE TABLE IF NOT EXISTS carecore_user_page_layouts (
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  page VARCHAR(40) NOT NULL,
  layout JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, page)
);
