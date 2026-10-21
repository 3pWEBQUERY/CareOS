'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { saveUpload, UploadError } from '@/lib/files'
import { actionResident } from '../../_lib/resident'

const CATEGORIES = ['report', 'lab', 'imaging', 'prescription', 'directive', 'consent', 'insurance', 'other']

export async function uploadResidentFile(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'residents.files.errors.empty', field: 'file' }
    const category = CATEGORIES.includes(fd(form, 'category')) ? fd(form, 'category') : 'other'
    const title = (fd(form, 'title') || file.name.replace(/\.[^.]+$/, '')).slice(0, 200)
    let obj
    try {
      obj = await saveUpload(ctx, file, 'resident', true)
    } catch (e) {
      if (e instanceof UploadError) return { ok: false, error: 'residents.files.errors.' + (['storage_not_configured', 'empty', 'too_large', 'type'].includes(e.message) ? e.message : 'generic'), field: 'file' }
      throw e
    }
    const rf = await db.residentFile.create({ data: { residentId: r.id, fileId: obj.id, title, category } })
    await audit(ctx, { action: 'resident.file.attach', entityType: 'ResidentFile', entityId: rf.id, after: { title, category, fileId: obj.id, filename: obj.filename }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { file: rf.id } })
    refresh()
  })
}
