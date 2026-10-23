-- Runde 4: Datenupdates für bestehende Organisationen (idempotent). Niemand verliert Zugang oder Daten.

-- ── Module (Paket P/Ä) ──
-- Bisher abgeschaltete Schalter übernehmen; wirkungslosen Schalter «medication» entfernen (Modul Medikation bleibt an)
UPDATE "Organization" o SET "modules" = array_remove(o."modules", 'ai')
 WHERE EXISTS (SELECT 1 FROM "FeatureFlag" f WHERE f."orgId" = o."id" AND f."key" = 'ai' AND f."enabled" = false);
UPDATE "Organization" o SET "modules" = array_remove(o."modules", 'dictation')
 WHERE EXISTS (SELECT 1 FROM "FeatureFlag" f WHERE f."orgId" = o."id" AND f."key" = 'voice' AND f."enabled" = false);
DELETE FROM "FeatureFlag" WHERE "key" = 'medication';
UPDATE "Organization" SET "modules" = array_append("modules", 'therapy') WHERE NOT ('therapy' = ANY("modules"));

-- ── Neue Rechte in bestehenden Systemrollen (entspricht den Ergänzungen in DEFAULT_ROLES) ──
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['resident.medication.phone_order', 'resident.medication.stock', 'therapy.read', 'portal.manage', 'portal.respond']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" IN ('nurse', 'specialist', 'ward_lead', 'nursing_director');
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['therapy.read', 'therapy.manage']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" = 'physician';
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['therapy.read', 'therapy.manage', 'therapy.document']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" = 'therapy';
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['portal.manage', 'portal.respond']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" = 'administration';
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['admin.emergency', 'api.personal']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" = 'sysadmin';

-- ── Kein Zugangsverlust für die Systemadministration (Paket P) ──
-- Personen mit sysadmin erhalten zusätzlich nursing_director organisationsweit (die bestehende sysadmin-Rolle bleibt unverändert)
INSERT INTO "RoleAssignment" ("id", "userId", "roleId", "locationId", "unitId")
SELECT 'mig' || substr(md5(s."userId" || nd."id"), 1, 22), s."userId", nd."id", NULL, NULL
  FROM (SELECT DISTINCT ra."userId", r."orgId" FROM "RoleAssignment" ra JOIN "Role" r ON r."id" = ra."roleId" WHERE r."key" = 'sysadmin') s
  JOIN "Role" nd ON nd."orgId" = s."orgId" AND nd."key" = 'nursing_director'
 WHERE NOT EXISTS (SELECT 1 FROM "RoleAssignment" x WHERE x."userId" = s."userId" AND x."roleId" = nd."id" AND x."unitId" IS NULL AND x."locationId" IS NULL);
INSERT INTO "AuditLog" ("at", "orgId", "userId", "action", "entityType", "entityId", "context")
SELECT now(), r."orgId", ra."userId", 'migration.role_assign', 'User', ra."userId", '{"role":"nursing_director","reason":"least_privilege"}'::jsonb
  FROM "RoleAssignment" ra JOIN "Role" r ON r."id" = ra."roleId"
 WHERE ra."id" LIKE 'mig%' AND r."key" = 'nursing_director'
   AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" = 'migration.role_assign' AND a."entityId" = ra."userId");

-- ── Aufenthalte (Paket K) ──
UPDATE "CareEpisode" e SET "unitId" = r."unitId" FROM "Resident" r
 WHERE e."residentId" = r."id" AND e."kind" = 'stay' AND e."end" IS NULL AND e."unitId" IS NULL;
INSERT INTO "CareEpisode" ("id", "residentId", "start", "reason", "kind")
SELECT gen_random_uuid()::text, r."id", r."updatedAt", 'Abwesend (vor Einführung der Aufenthalte erfasst)', 'absence'
  FROM "Resident" r WHERE r."status" = 'absent'
   AND NOT EXISTS (SELECT 1 FROM "CareEpisode" e WHERE e."residentId" = r."id" AND e."kind" = 'absence' AND e."end" IS NULL);
UPDATE "Task" t SET "status" = 'skipped', "autoClosed" = 'absence', "completedAt" = now(), "completedById" = NULL
  FROM "Resident" r WHERE t."residentId" = r."id" AND r."status" = 'absent'
   AND t."status" IN ('planned', 'ready', 'in_progress', 'escalated') AND t."dueAt" >= now();

-- ── Bestehende Ärzt/innen ihren Patient/innen zuordnen (Paket Ä; Freitext «Hausarzt» ↔ Nachname, Initiale muss passen) ──
INSERT INTO "ResidentPhysician" ("id", "orgId", "residentId", "userId", "role", "from", "createdAt")
SELECT 'rp_' || md5(r."id" || ':' || u."id"), r."orgId", r."id", u."id", 'primary', now(), now()
  FROM "Resident" r JOIN "User" u ON u."orgId" = r."orgId" AND u."active" AND u."pendingSince" IS NULL
 WHERE r."status" IN ('active', 'absent') AND r."physician" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "RoleAssignment" ra JOIN "Role" ro ON ro."id" = ra."roleId" WHERE ra."userId" = u."id" AND ro."key" <> 'sysadmin' AND 'resident.medication.edit' = ANY(ro."permissions"))
   AND r."physician" ~* ('(^|[^[:alpha:]])' || regexp_replace(u."lastName", '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '([^[:alpha:]]|$)')
   AND (r."physician" !~ '(^|\s)[[:upper:]]\.' OR r."physician" ~ ('(^|\s)' || left(u."firstName", 1) || '\.'))
ON CONFLICT ("residentId", "userId") DO NOTHING;
