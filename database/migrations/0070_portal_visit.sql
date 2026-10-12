-- Visite im Portal: die Ärztin bzw. der Arzt erfasst die Rückmeldung zu einer offenen Frage selbst im Portal.
-- Portal-Zugänge sind keine Mitarbeitenden; die Rückmeldung verweist deshalb auf den Portal-Zugang.
ALTER TABLE carecore_visit_resolutions
  ADD COLUMN IF NOT EXISTS resolved_by_portal_account_id UUID REFERENCES carecore_portal_accounts(id) ON DELETE SET NULL;
