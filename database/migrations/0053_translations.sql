-- Sprachen der Oberfläche: Übersetzungen der Texte aus locales/catalog.json (deutscher Ausgangstext als Schlüssel),
-- mit Prüfstatus. Mitarbeitende sehen nur geprüfte Übersetzungen, und eine Sprache erst, wenn die Administration sie
-- freigegeben hat; ungeprüfte Entwürfe sieht nur die Administration zum Prüfen.
CREATE TABLE IF NOT EXISTS carecore_translations (
  locale VARCHAR(8) NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  status VARCHAR(12) NOT NULL CHECK (status IN ('draft', 'reviewed')),
  origin VARCHAR(12) NOT NULL CHECK (origin IN ('ai', 'manual')),
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  PRIMARY KEY (locale, source)
);

CREATE TABLE IF NOT EXISTS carecore_languages (
  locale VARCHAR(8) PRIMARY KEY,
  released BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
