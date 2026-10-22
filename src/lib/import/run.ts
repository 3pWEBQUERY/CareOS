import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notifyT } from '@/lib/notify-t'
import { invalidateTaskGeneration } from '@/lib/tasks'
import { dateKey, dbDate, fmtDate, parseDateKey } from '@/lib/time'
import { LOCALES } from '@/i18n/core'
import { MAX_IMPORT_ROWS, headerKey, type CsvTable } from './csv'
import { SPECS, mapHeader, parseQualificationCell, validateRow, type ImportKind, type Issue, type RowValues } from './specs'

/**
 * Abgleich mit den Stammdaten und Ausführung der CSV-Importe (Admin → Datenimport).
 * prepare(): Trockenlauf – prüft jede Zeile, schreibt nichts. commit(): prüft erneut (Daten können sich
 * seit der Vorschau geändert haben) und schreibt alle gültigen Zeilen in einer Transaktion.
 */

export type RowStatus = 'create' | 'update' | 'skip' | 'error'
export type RowResult = { line: number; status: RowStatus; label: string; issues: Issue[]; warnings: Issue[] }
export type ImportReport = {
  kind: ImportKind
  digest: string
  total: number
  counts: Record<RowStatus, number>
  rows: RowResult[]
  /** Fehler, die den ganzen Import verhindern (fehlende Pflichtspalten, leere Datei). */
  fileIssues: Issue[]
  fileWarnings: Issue[]
  /** erkannte Felder in Dateireihenfolge */
  columns: string[]
}

type Op = (tx: Prisma.TransactionClient) => Promise<{ unitId?: string | null; userId?: string | null }>
type Planned = { row: RowResult; op?: Op }

/** Wer welche Importart ausführen darf (Bereichsprüfung zusätzlich je Zeile). */
export function allowedKinds(ctx: Ctx): ImportKind[] {
  const out: ImportKind[] = []
  if (ctx.can('resident.create')) out.push('residents')
  if (ctx.can('admin.users')) out.push('staff')
  if (ctx.can('schedule.manage')) out.push('shifts')
  return out
}

export const digestOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32)

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && headerKey(a) === headerKey(b)
const todayIso = () => dateKey(new Date())

async function orgUnits(ctx: Ctx) {
  return db.unit.findMany({ where: { orgId: ctx.org.id }, select: { id: true, name: true, shortName: true, locationId: true } })
}
const findUnit = (units: Awaited<ReturnType<typeof orgUnits>>, v: string | null) => (v ? units.find((u) => same(u.name, v) || same(u.shortName, v)) ?? null : null)

const holdsOrgWide = (ctx: Ctx, perm: string) => ctx.grants.some((g) => !g.unitId && !g.locationId && g.permissions.includes(perm))

export async function prepare(ctx: Ctx, kind: ImportKind, table: CsvTable, digest: string): Promise<{ report: ImportReport; plan: Planned[] }> {
  const map = mapHeader(kind, table.header)
  const fileIssues: Issue[] = []
  const fileWarnings: Issue[] = []
  if (!table.header.length || !table.rows.length) fileIssues.push({ code: 'empty' })
  if (map.missing.length) fileIssues.push({ code: 'headerMissing', vars: { cols: map.missing.join(', ') } })
  if (table.rows.length > MAX_IMPORT_ROWS) fileIssues.push({ code: 'tooManyRows', vars: { max: MAX_IMPORT_ROWS } })
  if (map.unknown.length) fileWarnings.push({ code: 'headerUnknown', vars: { cols: map.unknown.join(', ') } })
  if (map.duplicate.length) fileWarnings.push({ code: 'headerDuplicate', vars: { cols: map.duplicate.join(', ') } })
  const columns = Object.entries(map.index).sort((a, b) => a[1] - b[1]).map(([k]) => k)

  let plan: Planned[] = []
  if (!fileIssues.length) {
    const today = todayIso()
    const parsed = table.rows.map((r) => ({ line: r.line, ...validateRow(kind, map, r.cells, today) }))
    plan = kind === 'residents' ? await planResidents(ctx, parsed) : kind === 'staff' ? await planStaff(ctx, parsed) : await planShifts(ctx, parsed)
  }
  const rows = plan.map((p) => p.row)
  const counts: Record<RowStatus, number> = { create: 0, update: 0, skip: 0, error: 0 }
  for (const r of rows) counts[r.status]++
  return { report: { kind, digest, total: table.rows.length, counts, rows, fileIssues, fileWarnings, columns }, plan }
}

type Parsed = { line: number; values: RowValues; issues: Issue[] }
const str = (v: RowValues[string]) => (typeof v === 'string' && v ? v : null)
const list = (v: RowValues[string]) => (Array.isArray(v) ? v : [])
const result = (p: Parsed, label: string, extra: Issue[] = [], warnings: Issue[] = []): RowResult => {
  const issues = [...p.issues, ...extra]
  return { line: p.line, status: issues.length ? 'error' : 'create', label, issues, warnings }
}

// ───────── Bewohnende ─────────

async function planResidents(ctx: Ctx, rows: Parsed[]): Promise<Planned[]> {
  const units = await orgUnits(ctx)
  const [rooms, existing] = await Promise.all([
    db.room.findMany({ where: { unit: { orgId: ctx.org.id } }, select: { id: true, unitId: true, number: true, beds: true, _count: { select: { residents: { where: { status: { in: ['active', 'absent'] } } } } } } }),
    db.resident.findMany({ where: { orgId: ctx.org.id, anonymisedAt: null }, select: { id: true, firstName: true, lastName: true, birthDate: true, insuranceNo: true, status: true } }),
  ])
  const occupied = new Map(rooms.map((r) => [r.id, r._count.residents]))
  const personKey = (last: string, first: string, birth: string) => headerKey(last) + '|' + headerKey(first) + '|' + birth
  const known = new Map(existing.map((r) => [personKey(r.lastName, r.firstName, dateKey(new Date(r.birthDate.getUTCFullYear(), r.birthDate.getUTCMonth(), r.birthDate.getUTCDate()))), r]))
  const byInsurance = new Map(existing.filter((r) => r.insuranceNo).map((r) => [headerKey(r.insuranceNo!), r]))
  const seen = new Map<string, number>()

  return rows.map((p): Planned => {
    const v = p.values
    const extra: Issue[] = []
    const last = str(v.lastName) ?? ''
    const first = str(v.firstName) ?? ''
    const birth = str(v.birthDate)
    const unit = findUnit(units, str(v.unit))
    if (str(v.unit) && !unit) extra.push({ code: 'unitUnknown', col: 'unit', vars: { value: str(v.unit)! } })
    if (unit && !ctx.can('resident.create', { unitId: unit.id, locationId: unit.locationId })) extra.push({ code: 'notAllowedUnit', col: 'unit', vars: { value: unit.name } })
    let roomId: string | null = null
    if (unit && str(v.room)) {
      const room = rooms.find((r) => r.unitId === unit.id && same(r.number, str(v.room)))
      if (!room) extra.push({ code: 'roomUnknown', col: 'room', vars: { value: str(v.room)!, unit: unit.name } })
      else if ((occupied.get(room.id) ?? 0) >= room.beds) extra.push({ code: 'roomFull', col: 'room', vars: { value: room.number } })
      else roomId = room.id
    }
    const label = [`${last} ${first}`.trim(), birth ? fmtDate(parseDateKey(birth), ctx.locale) : null, [unit?.shortName ?? unit?.name ?? str(v.unit), str(v.room)].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')
    let dup: (typeof existing)[number] | undefined
    if (birth && last && first) {
      const k = personKey(last, first, birth)
      const ins = str(v.insuranceNo)
      dup = known.get(k) ?? (ins ? byInsurance.get(headerKey(ins)) : undefined)
      const prev = seen.get(k) ?? (ins ? seen.get('ins:' + headerKey(ins)) : undefined)
      if (prev) extra.push({ code: 'duplicateInFile', vars: { line: prev } })
      seen.set(k, p.line)
      if (ins) seen.set('ins:' + headerKey(ins), p.line)
    }
    if (dup && !p.issues.length) {
      if (dup.status === 'active' || dup.status === 'absent') return { row: { line: p.line, status: 'skip', label, issues: [], warnings: [{ code: 'residentExists' }] } }
      extra.push({ code: 'residentDischarged' })
    }
    const row = result(p, label, extra)
    if (row.status === 'error' || !unit || !birth) return { row }
    if (roomId) occupied.set(roomId, (occupied.get(roomId) ?? 0) + 1)
    const data = {
      orgId: ctx.org.id, unitId: unit.id, roomId, firstName: first, lastName: last, birthDate: dbDate(parseDateKey(birth)),
      sex: str(v.sex), careLevel: typeof v.careLevel === 'number' ? v.careLevel : null, insuranceNo: str(v.insuranceNo), physician: str(v.physician),
      rea: (str(v.rea) ?? 'unknown') as 'yes' | 'no' | 'unknown', allergies: list(v.allergies), diet: str(v.diet), mobility: str(v.mobility),
      admittedAt: str(v.admittedAt) ? parseDateKey(str(v.admittedAt)!) : new Date(), status: 'active' as const,
    }
    return {
      row,
      op: async (tx) => {
        const r = await tx.resident.create({ data: { ...data, nutrition: { create: {} } } })
        const { orgId: _o, ...after } = data
        void _o
        await audit(ctx, { action: 'resident.create', entityType: 'Resident', entityId: r.id, after, context: { residentId: r.id, import: true, line: p.line } }, tx)
        return { unitId: unit.id }
      },
    }
  })
}

// ───────── Personal ─────────

async function planStaff(ctx: Ctx, rows: Parsed[]): Promise<Planned[]> {
  const emails = rows.map((r) => str(r.values.email)).filter((x): x is string => !!x)
  const [units, roles, quals, users] = await Promise.all([
    orgUnits(ctx),
    db.role.findMany({ where: { orgId: ctx.org.id }, select: { id: true, key: true, name: true, permissions: true } }),
    db.qualification.findMany({ where: { orgId: ctx.org.id }, select: { id: true, name: true } }),
    db.user.findMany({
      where: { email: { in: emails } },
      include: { roles: { include: { role: { select: { permissions: true } } } }, qualifications: true },
    }),
  ])
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]))
  const canRoles = ctx.can('admin.roles')
  const seen = new Map<string, number>()

  return rows.map((p): Planned => {
    const v = p.values
    const extra: Issue[] = []
    const email = str(v.email) ?? ''
    const first = str(v.firstName) ?? ''
    const last = str(v.lastName) ?? ''
    const label = [`${last} ${first}`.trim(), email].filter(Boolean).join(' · ')
    if (email && seen.has(email)) extra.push({ code: 'duplicateInFile', vars: { line: seen.get(email)! } })
    if (email) seen.set(email, p.line)
    const existing = email ? byEmail.get(email) : undefined
    if (existing && existing.orgId !== ctx.org.id) extra.push({ code: 'emailOtherOrg', col: 'email' })
    if (existing && existing.id === ctx.user.id) extra.push({ code: 'self', col: 'email' })
    if (existing && existing.orgId === ctx.org.id && !canRoles) {
      const perms = new Set(existing.roles.flatMap((r) => r.role.permissions))
      if ([...perms].some((x) => !holdsOrgWide(ctx, x))) extra.push({ code: 'outranks', col: 'email' })
    }
    const unit = findUnit(units, str(v.unit))
    if (str(v.unit) && !unit) extra.push({ code: 'unitUnknown', col: 'unit', vars: { value: str(v.unit)! } })
    const roleCell = str(v.role)
    const role = roleCell ? roles.find((r) => same(r.key, roleCell) || same(r.name, roleCell)) ?? null : null
    if (roleCell && !role) extra.push({ code: 'roleUnknown', col: 'role', vars: { value: roleCell } })
    if (role && !canRoles && role.permissions.some((x) => !holdsOrgWide(ctx, x))) extra.push({ code: 'roleEscalation', col: 'role', vars: { value: role.name } })
    const scope = (str(v.roleScope) ?? (unit ? 'unit' : 'org')) as 'unit' | 'location' | 'org'
    if (role && scope !== 'org' && !unit) extra.push({ code: 'scopeNeedsUnit', col: 'roleScope' })
    if (!role && str(v.roleScope)) extra.push({ code: 'scopeWithoutRole', col: 'roleScope' })
    const qualItems = list(v.qualifications).map(parseQualificationCell)
    const qualIds: { id: string; validUntil: string | null }[] = []
    for (const q of qualItems) {
      const hit = quals.find((x) => same(x.name, q.name))
      if (!hit) extra.push({ code: 'qualificationUnknown', col: 'qualifications', vars: { value: q.name } })
      else if (q.bad) extra.push({ code: 'date', col: 'qualifications', vars: { value: q.name } })
      else qualIds.push({ id: hit.id, validUntil: q.validUntil })
    }

    const row = result(p, label, extra)
    if (row.status === 'error') return { row }
    const locale = (str(v.locale) ?? ctx.org.defaultLocale) as (typeof LOCALES)[number]
    const master = {
      firstName: first, lastName: last,
      initials: (str(v.initials) ?? ((first[0] ?? '') + (last[0] ?? ''))).toUpperCase().slice(0, 4),
      jobTitle: str(v.jobTitle), employeeNo: str(v.employeeNo), workPhone: str(v.workPhone), phone: str(v.phone),
      primaryUnitId: unit?.id ?? null, locale,
    }
    const assignment = role ? { roleId: role.id, unitId: scope === 'unit' ? unit!.id : null, locationId: scope === 'location' ? unit!.locationId : null } : null

    if (existing) {
      // Nur ausgefüllte Zellen überschreiben; leere Zellen lassen bestehende Angaben stehen.
      const changes: Record<string, unknown> = {}
      const before: Record<string, unknown> = {}
      const setIf = (k: keyof typeof master, present: boolean) => {
        if (!present) return
        const cur = (existing as unknown as Record<string, unknown>)[k] ?? null
        if (cur !== master[k]) { changes[k] = master[k]; before[k] = cur }
      }
      setIf('firstName', true)
      setIf('lastName', true)
      setIf('initials', !!str(v.initials))
      setIf('jobTitle', !!str(v.jobTitle))
      setIf('employeeNo', !!str(v.employeeNo))
      setIf('workPhone', !!str(v.workPhone))
      setIf('phone', !!str(v.phone))
      setIf('primaryUnitId', !!unit)
      setIf('locale', !!str(v.locale))
      const newRole = assignment && !existing.roles.some((r) => r.roleId === assignment.roleId && r.unitId === assignment.unitId && r.locationId === assignment.locationId)
      const qualChanges = qualIds.filter((q) => {
        const cur = existing.qualifications.find((x) => x.qualificationId === q.id)
        return !cur || (q.validUntil ?? null) !== (cur.validUntil ? dateKey(cur.validUntil) : null)
      })
      const warnings: Issue[] = existing.active ? [] : [{ code: 'inactive' }]
      if (!Object.keys(changes).length && !newRole && !qualChanges.length) return { row: { ...row, status: 'skip', warnings: [{ code: 'unchanged' }, ...warnings] } }
      return {
        row: { ...row, status: 'update', warnings },
        op: async (tx) => {
          if (Object.keys(changes).length) {
            await tx.user.update({ where: { id: existing.id }, data: changes })
            await audit(ctx, { action: 'admin.user.update', entityType: 'User', entityId: existing.id, before, after: changes, context: { import: true, line: p.line } }, tx)
          }
          if (newRole && assignment) {
            const a = await tx.roleAssignment.create({ data: { userId: existing.id, ...assignment } })
            await audit(ctx, { action: 'admin.user.role_assign', entityType: 'RoleAssignment', entityId: a.id, after: { userId: existing.id, role: role!.key, unitId: assignment.unitId, locationId: assignment.locationId }, context: { import: true } }, tx)
          }
          for (const q of qualChanges) {
            const validUntil = q.validUntil ? parseDateKey(q.validUntil) : null
            await tx.userQualification.upsert({ where: { userId_qualificationId: { userId: existing.id, qualificationId: q.id } }, create: { userId: existing.id, qualificationId: q.id, validUntil }, update: { validUntil } })
            await audit(ctx, { action: 'admin.user.qualification_set', entityType: 'User', entityId: existing.id, after: { qualification: quals.find((x) => x.id === q.id)?.name, validUntil }, context: { import: true } }, tx)
          }
          return { userId: existing.id }
        },
      }
    }
    return {
      row,
      op: async (tx) => {
        const u = await tx.user.create({ data: { ...master, email, orgId: ctx.org.id, active: true } })
        if (assignment) await tx.roleAssignment.create({ data: { userId: u.id, ...assignment } })
        for (const q of qualIds) await tx.userQualification.create({ data: { userId: u.id, qualificationId: q.id, validUntil: q.validUntil ? parseDateKey(q.validUntil) : null } })
        await audit(ctx, {
          action: 'admin.user.create', entityType: 'User', entityId: u.id,
          after: { email, ...master, role: role?.key ?? null, roleUnitId: assignment?.unitId ?? null, roleLocationId: assignment?.locationId ?? null, qualifications: qualIds.length, mode: 'import' },
          context: { import: true, line: p.line },
        }, tx)
        return { userId: u.id }
      },
    }
  })
}

// ───────── Dienste ─────────

async function planShifts(ctx: Ctx, rows: Parsed[]): Promise<Planned[]> {
  const persons = rows.map((r) => str(r.values.person)).filter((x): x is string => !!x)
  const dates = rows.map((r) => str(r.values.date)).filter((x): x is string => !!x).sort()
  const [units, types, quals, people] = await Promise.all([
    orgUnits(ctx),
    db.shiftType.findMany({ where: { orgId: ctx.org.id }, select: { id: true, code: true, name: true } }),
    db.qualification.findMany({ where: { orgId: ctx.org.id }, select: { name: true } }),
    db.user.findMany({
      where: { orgId: ctx.org.id, OR: [{ email: { in: persons.map((x) => x.toLowerCase()) } }, { employeeNo: { in: persons } }] },
      select: { id: true, email: true, employeeNo: true, firstName: true, lastName: true, active: true },
    }),
  ])
  const from = dates[0] ? dbDate(parseDateKey(dates[0])) : null
  const to = dates.length ? dbDate(parseDateKey(dates[dates.length - 1])) : null
  type ShiftRow = { unitId: string; userId: string | null; shiftTypeId: string; date: Date; shiftType: { code: string } }
  let existing: ShiftRow[] = []
  let absences: { userId: string; from: Date; to: Date }[] = []
  if (from && to) {
    ;[existing, absences] = await Promise.all([
      db.shift.findMany({ where: { date: { gte: from, lte: to }, status: { not: 'cancelled' }, unit: { orgId: ctx.org.id } }, select: { unitId: true, userId: true, shiftTypeId: true, date: true, shiftType: { select: { code: true } } } }),
      db.absence.findMany({ where: { status: 'approved', userId: { in: people.map((u) => u.id) }, from: { lte: to }, to: { gte: from } }, select: { userId: true, from: true, to: true } }),
    ])
  }
  const today = todayIso()
  const dk = (d: Date) => d.toISOString().slice(0, 10)
  const seen = new Map<string, number>()

  return rows.map((p): Planned => {
    const v = p.values
    const extra: Issue[] = []
    const warnings: Issue[] = []
    const date = str(v.date)
    const unit = findUnit(units, str(v.unit))
    if (str(v.unit) && !unit) extra.push({ code: 'unitUnknown', col: 'unit', vars: { value: str(v.unit)! } })
    if (unit && !ctx.can('schedule.manage', { unitId: unit.id, locationId: unit.locationId })) extra.push({ code: 'notAllowedUnit', col: 'unit', vars: { value: unit.name } })
    const typeCell = str(v.shift)
    const type = typeCell ? types.find((x) => same(x.code, typeCell) || same(x.name, typeCell)) ?? null : null
    if (typeCell && !type) extra.push({ code: 'shiftTypeUnknown', col: 'shift', vars: { value: typeCell, codes: types.map((x) => x.code).join(', ') } })
    const personCell = str(v.person)
    const person = personCell ? people.find((u) => u.email.toLowerCase() === personCell.toLowerCase() || (!!u.employeeNo && u.employeeNo === personCell)) ?? null : null
    if (personCell && !person) extra.push({ code: 'personUnknown', col: 'person', vars: { value: personCell } })
    if (person && !person.active) extra.push({ code: 'personInactive', col: 'person' })
    const reqQual = str(v.qualification)
    if (reqQual && !quals.some((q) => same(q.name, reqQual))) warnings.push({ code: 'qualificationReqUnknown', col: 'qualification', vars: { value: reqQual } })
    if (date && date < today) warnings.push({ code: 'pastDate', col: 'date' })

    const label = [date ? fmtDate(parseDateKey(date), ctx.locale) : null, type?.code ?? typeCell, unit?.shortName ?? unit?.name ?? str(v.unit), person ? `${person.lastName} ${person.firstName}` : personCell ? personCell : null].filter(Boolean).join(' · ')

    if (date && person) {
      const k = person.id + '|' + date
      if (seen.has(k)) extra.push({ code: 'duplicateInFile', vars: { line: seen.get(k)! } })
      seen.set(k, p.line)
    }
    if (date && unit && type && !extra.length && !p.issues.length) {
      const dupShift = existing.find((s) => dk(s.date) === date && s.unitId === unit.id && s.shiftTypeId === type.id && s.userId === (person?.id ?? null))
      if (dupShift) return { row: { line: p.line, status: 'skip', label, issues: [], warnings: [{ code: 'shiftExists' }] } }
      if (person) {
        const busy = existing.find((s) => dk(s.date) === date && s.userId === person.id)
        if (busy) extra.push({ code: 'personBusy', col: 'person', vars: { code: busy.shiftType.code } })
        if (absences.some((a) => a.userId === person.id && dk(a.from) <= date && dk(a.to) >= date)) warnings.push({ code: 'absent', col: 'person' })
      }
    }
    const row = result(p, label, extra, warnings)
    if (row.status === 'error' || !unit || !type || !date) return { row }
    // Für die weiteren Zeilen derselben Datei gilt der Dienst als geplant (Doppelbelegung in der Datei erkennen).
    existing.push({ unitId: unit.id, userId: person?.id ?? null, shiftTypeId: type.id, date: dbDate(parseDateKey(date)), shiftType: { code: type.code } })
    return {
      row,
      op: async (tx) => {
        const s = await tx.shift.create({
          data: { unitId: unit.id, userId: person?.id ?? null, shiftTypeId: type.id, date: dbDate(parseDateKey(date)), status: person ? 'planned' : 'open', note: str(v.note), requiredQualification: reqQual },
        })
        await audit(ctx, { action: 'shift.create', entityType: 'Shift', entityId: s.id, after: { unitId: unit.id, userId: person?.id ?? null, code: type.code, date, status: s.status }, context: { import: true, line: p.line } }, tx)
        return { unitId: unit.id, userId: person?.id ?? null }
      },
    }
  })
}

// ───────── Ausführen ─────────

/**
 * Schreibt alle gültigen Zeilen in einer Transaktion (alles oder nichts). Zeilen mit Fehlern werden nur
 * übersprungen, wenn skipErrors gesetzt ist; sonst bricht der Import ab, ohne etwas zu schreiben.
 */
export async function commit(ctx: Ctx, kind: ImportKind, plan: Planned[], meta: { fileName: string; digest: string }) {
  const ops = plan.filter((p) => p.op)
  const touched: { unitId?: string | null; userId?: string | null }[] = []
  await db.$transaction(
    async (tx) => {
      for (const p of ops) touched.push(await p.op!(tx))
      const counts: Record<RowStatus, number> = { create: 0, update: 0, skip: 0, error: 0 }
      for (const p of plan) counts[p.row.status]++
      await audit(ctx, { action: 'import.' + kind, entityType: 'Import', entityId: meta.digest, after: counts, context: { fileName: meta.fileName, rows: plan.length } }, tx)
    },
    { timeout: 120_000, maxWait: 10_000 },
  )
  const unitIds = [...new Set(touched.map((x) => x.unitId).filter((x): x is string => !!x))]
  if (kind === 'residents') {
    for (const unitId of unitIds) {
      invalidateTaskGeneration(unitId)
      await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId, actorId: ctx.user.id, payload: { imported: touched.filter((x) => x.unitId === unitId).length } })
    }
  }
  if (kind === 'shifts') {
    for (const unitId of unitIds) await emit({ orgId: ctx.org.id, type: 'schedule.changed', unitId, actorId: ctx.user.id, payload: { imported: touched.filter((x) => x.unitId === unitId).length } })
    // Je Person eine gebündelte Benachrichtigung statt einer pro Dienst
    const perUser = new Map<string, number>()
    for (const x of touched) if (x.userId) perUser.set(x.userId, (perUser.get(x.userId) ?? 0) + 1)
    for (const [userId, n] of perUser)
      await notifyT({ orgId: ctx.org.id, userIds: [userId], priority: 'info', kind: 'schedule.import', titleKey: 'schedule.imported.notify', vars: { n }, href: '/schedule', groupKey: 'schedule-import:' + meta.digest })
  }
  return { written: ops.length }
}

/** Spalten für die Anzeige der Feldbeschreibung (Reihenfolge der Vorlage). */
export const specKeys = (kind: ImportKind) => SPECS[kind].map((s) => ({ key: s.key, required: !!s.required, type: s.type }))
