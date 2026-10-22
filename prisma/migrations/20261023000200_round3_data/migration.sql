-- Neue Berechtigung Diktat für bestehende Systemrollen
UPDATE "Role" SET "permissions" = array_append("permissions", 'resident.chart.dictate')
WHERE "system" AND "key" IN ('nurse', 'specialist', 'ward_lead', 'nursing_director', 'sysadmin')
  AND NOT ('resident.chart.dictate' = ANY("permissions"));

-- Pflegeepisoden für bestehende Bewohnende (Eintritt bis Austritt)
INSERT INTO "CareEpisode" ("id", "residentId", "start", "end", "reason")
SELECT 'ep_' || r."id", r."id", r."admittedAt", r."dischargedAt", 'Eintritt'
FROM "Resident" r
WHERE NOT EXISTS (SELECT 1 FROM "CareEpisode" e WHERE e."residentId" = r."id");
