'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx, residentInScope, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { dbDate, fmtDate, parseDateKey, startOfDay } from '@/lib/time'
import { countSchema, orderSchema, receiptSchema, stockAfter } from '@/lib/pharmacy'

/** Apotheke (PRD §13.1, §40): Bestellung, Wareneingang, Zählung. Recht resident.medication.stock im Bereich der Person. */
async function stockMed(ctx: Ctx, medicationId: string) {
  if (!ctx.hasModule('medication')) throw new ForbiddenError('resident.medication.stock')
  const med = await db.medication.findUnique({ where: { id: medicationId } })
  const r = med ? await residentInScope(ctx, med.residentId, 'resident.medication.read') : null
  if (!med || !r || !ctx.can('resident.medication.stock', { unitId: r.unitId, locationId: r.unit.locationId })) throw new ForbiddenError('resident.medication.stock')
  return { med, r }
}
const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

/** Create: Bestellpositionen (Bestellvorschlag übernehmen oder Menge anpassen). */
export async function orderAction(items: { medicationId: string; quantity: string | number }[]): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const list = z.array(orderSchema).max(200).parse((Array.isArray(items) ? items : []).filter((i) => String(i?.quantity ?? '').trim() !== '' && String(i.quantity) !== '0'))
    if (!list.length) return err('meds.pharmacy.errors.none')
    const created: string[] = []
    for (const it of list) {
      const { med, r } = await stockMed(ctx, it.medicationId)
      if (!med.active) return err('meds.pharmacy.errors.inactive')
      if (med.stock == null) return err('meds.pharmacy.errors.noStock')
      const open = await db.medicationStockEntry.findFirst({ where: { medicationId: med.id, kind: 'order', status: 'open' } })
      if (open) continue // bereits bestellt (Doppelklick, zweites Gerät)
      const e = await db.medicationStockEntry.create({ data: { orgId: ctx.org.id, unitId: r.unitId, medicationId: med.id, residentId: r.id, kind: 'order', status: 'open', quantity: it.quantity, byId: ctx.user.id } })
      await audit(ctx, { action: 'medication.stock.order', entityType: 'MedicationStockEntry', entityId: e.id, after: e, context: { residentId: r.id, medicationId: med.id } })
      created.push(e.id)
    }
    refresh()
    return { ok: true, message: ctx.t('meds.pharmacy.toast.ordered', { n: created.length }) }
  })
}

export async function cancelOrderAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const e = await db.medicationStockEntry.findFirst({ where: { id: String(id), orgId: ctx.org.id, kind: 'order' } })
    if (!e) return err('common.notFound')
    await stockMed(ctx, e.medicationId)
    const res = await db.medicationStockEntry.updateMany({ where: { id: e.id, status: 'open' }, data: { status: 'cancelled' } })
    if (!res.count) return err('meds.pharmacy.errors.notOpen')
    await audit(ctx, { action: 'medication.stock.order.cancel', entityType: 'MedicationStockEntry', entityId: e.id, before: { status: 'open' }, after: { status: 'cancelled' }, context: { residentId: e.residentId, medicationId: e.medicationId } })
    refresh()
    return { ok: true, message: ctx.t('meds.pharmacy.toast.cancelled') }
  })
}

/** Complete: Wareneingang mit Charge und Verfall, Bestand +Menge (Transaktion, Bestellung erledigt). */
export async function receiveAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = receiptSchema.parse({ medicationId: fd(form, 'medicationId'), orderId: fd(form, 'orderId'), quantity: fd(form, 'quantity'), batch: fd(form, 'batch'), expiry: fd(form, 'expiry') })
    const { med, r } = await stockMed(ctx, p.medicationId)
    const expiry = parseDateKey(p.expiry)
    if (expiry < startOfDay()) return err('meds.pharmacy.errors.expiryPast', 'expiry')
    const order = p.orderId ? await db.medicationStockEntry.findFirst({ where: { id: p.orderId, medicationId: med.id, kind: 'order' } }) : null
    if (p.orderId && (!order || order.status !== 'open')) return err('meds.pharmacy.errors.notOpen')
    const t = ctx.t
    const res = await db.$transaction(async (tx) => {
      // Aktuellen Bestand in der Transaktion lesen (Abgaben laufen parallel)
      const cur = await tx.medication.findUniqueOrThrow({ where: { id: med.id }, select: { stock: true } })
      const after = stockAfter(cur.stock, p.quantity)
      await tx.medication.update({ where: { id: med.id }, data: { stock: after } })
      const e = await tx.medicationStockEntry.create({ data: { orgId: ctx.org.id, unitId: r.unitId, medicationId: med.id, residentId: r.id, kind: 'receipt', quantity: p.quantity, orderId: order?.id ?? null, batch: p.batch, expiry: dbDate(expiry), stockAfter: after, byId: ctx.user.id } })
      if (order) await tx.medicationStockEntry.update({ where: { id: order.id }, data: { status: 'received' } })
      await audit(ctx, { action: 'medication.stock.receipt', entityType: 'MedicationStockEntry', entityId: e.id, before: { stock: cur.stock }, after: { stock: after, batch: p.batch, expiry: p.expiry }, context: { residentId: r.id, medicationId: med.id, orderId: order?.id } }, tx)
      return after
    })
    await emit({ orgId: ctx.org.id, type: 'medication.changed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { medicationId: med.id, stock: res } })
    refresh()
    return { ok: true, message: t('meds.pharmacy.toast.received', { drug: med.name, stock: `${res} ${med.stockUnit ?? ''}`.trim() }) }
  })
}

/** Bestand zählen: Korrektur mit Begründung (Differenz wird gebucht). */
export async function countAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = countSchema.parse({ medicationId: fd(form, 'medicationId'), counted: fd(form, 'counted'), note: fd(form, 'note') })
    const { med, r } = await stockMed(ctx, p.medicationId)
    if (med.stock == null) return err('meds.pharmacy.errors.noStock')
    const delta = await db.$transaction(async (tx) => {
      const cur = await tx.medication.findUniqueOrThrow({ where: { id: med.id }, select: { stock: true } })
      const d = p.counted - (cur.stock ?? 0)
      await tx.medication.update({ where: { id: med.id }, data: { stock: p.counted } })
      const e = await tx.medicationStockEntry.create({ data: { orgId: ctx.org.id, unitId: r.unitId, medicationId: med.id, residentId: r.id, kind: 'correction', quantity: d, note: p.note, stockAfter: p.counted, byId: ctx.user.id } })
      await audit(ctx, { action: 'medication.stock.correct', entityType: 'MedicationStockEntry', entityId: e.id, before: { stock: cur.stock }, after: { stock: p.counted }, context: { residentId: r.id, medicationId: med.id, note: p.note } }, tx)
      return d
    })
    await emit({ orgId: ctx.org.id, type: 'medication.changed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { medicationId: med.id, delta } })
    refresh()
    return { ok: true, message: ctx.t('meds.pharmacy.toast.counted', { drug: med.name, stock: `${p.counted} ${med.stockUnit ?? ''}`.trim() }) }
  })
}

/** Zeile für die Bestellliste (Kopieren, Übergabe an die Apotheke bis ein Adapter angebunden ist). */
export async function orderListText(): Promise<ActionResult<{ text: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    if (!ctx.unit || !ctx.canHere('resident.medication.stock')) return err('common.notAllowed') as ActionResult<{ text: string }>
    const rows = await db.medicationStockEntry.findMany({ where: { orgId: ctx.org.id, unitId: ctx.unit.id, kind: 'order', status: 'open' }, include: { medication: { select: { name: true, stockUnit: true, gtin: true, resident: { select: { firstName: true, lastName: true } } } } }, orderBy: { at: 'asc' } })
    const t = ctx.t
    const lines = [t('meds.pharmacy.listHead', { unit: ctx.unit.name, date: fmtDate(new Date(), ctx.locale) }), ...rows.map((e) => t('meds.pharmacy.listLine', { drug: e.medication.name + (e.medication.gtin ? ` (GTIN ${e.medication.gtin})` : ''), qty: e.quantity, unit: e.medication.stockUnit ?? '', name: `${e.medication.resident.lastName} ${e.medication.resident.firstName}` }))]
    await audit(ctx, { action: 'medication.stock.order.export', entityType: 'Unit', entityId: ctx.unit.id, context: { n: rows.length } })
    return { ok: true, data: { text: lines.join('\n') } }
  })
}
