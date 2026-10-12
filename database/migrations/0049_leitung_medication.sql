-- Entscheidung: Die Leitung verabreicht Medikamente immer, ohne Qualifikation. Die Rollenverwaltung hält das fest
-- (wie bei der Administration); hier wird der Stand bestehender Installationen angeglichen.
UPDATE carecore_roles
SET permissions = CASE WHEN permissions ? 'medication.administer' THEN permissions
      ELSE permissions || '["medication.administer"]'::jsonb END,
    medication_requires_qualification = FALSE,
    updated_at = NOW()
WHERE key = 'leitung'
  AND (NOT permissions ? 'medication.administer' OR medication_requires_qualification);
