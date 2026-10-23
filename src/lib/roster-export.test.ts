import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absenceDays, payrollRows, type PayrollHeader } from './roster-export'
import { toCsv } from './import/csv'
import type { PersonStats } from './roster/evaluate'

const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']
const header: PayrollHeader = { person: 'Person', employeeNo: 'Personalnummer', pct: 'Pensum (%)', soll: 'Soll (h)', ist: 'Geplant (h)', diff: 'Saldo (h)', nights: 'Nachtdienste', weekends: 'Wochenendtage', absence: (k) => `${k} (Tage)` }
const stat = (soll: number, ist: number, nights = 0, weekends = 0): PersonStats => ({ soll, ist, diff: Math.round((ist - soll) * 10) / 10, shifts: 0, nights, weekends, freeWeekends: 0 })

test('Lohnexport: genehmigte Abwesenheitstage je Art, beantragte zählen nicht', () => {
  const abs = {
    'u1|2026-11-02': { kind: 'vacation', status: 'approved' },
    'u1|2026-11-03': { kind: 'vacation', status: 'approved' },
    'u1|2026-11-04': { kind: 'sick', status: 'requested' },
    'u1|2026-10-31': { kind: 'vacation', status: 'approved' },
    'u2|2026-11-02': { kind: 'unbekannt', status: 'approved' },
  }
  assert.deepEqual(absenceDays(days, abs, 'u1'), { vacation: 2, sick: 0, training: 0, compensation: 0, other: 0 })
  assert.deepEqual(absenceDays(days, abs, 'u2'), { vacation: 0, sick: 0, training: 0, compensation: 0, other: 1 })
})

test('Lohnexport: Zeilen mit Soll, Geplant, Saldo, Nächten, Wochenenden und Abwesenheiten', () => {
  const rows = payrollRows(
    header,
    [{ id: 'u1', name: 'Huber Lea', employeeNo: 'P-104', pct: 80 }, { id: 'u2', name: 'Meier Jonas', employeeNo: null, pct: 100 }],
    { u1: stat(20.16, 24, 1, 1), u2: stat(25.2, 16.5) },
    days,
    { 'u1|2026-11-02': { kind: 'training', status: 'approved' } },
  )
  assert.deepEqual(rows[0], ['Person', 'Personalnummer', 'Pensum (%)', 'Soll (h)', 'Geplant (h)', 'Saldo (h)', 'Nachtdienste', 'Wochenendtage', 'vacation (Tage)', 'sick (Tage)', 'training (Tage)', 'compensation (Tage)', 'other (Tage)'])
  assert.deepEqual(rows[1], ['Huber Lea', 'P-104', '80', '20.16', '24.00', '3.80', '1', '1', '0', '0', '1', '0', '0'])
  assert.deepEqual(rows[2], ['Meier Jonas', '', '100', '25.20', '16.50', '-8.70', '0', '0', '0', '0', '0', '0', '0'])
  const csv = toCsv(rows)
  assert.ok(csv.startsWith('﻿Person;Personalnummer;'), 'UTF-8 BOM und Semikolon')
  assert.ok(csv.includes('\r\nMeier Jonas;;100;25.20;16.50;-8.70;'), 'negativer Saldo bleibt eine Zahl')
})
