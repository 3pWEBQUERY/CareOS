import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { canModerate, canPostTo, myRoleKeys, visibleChannels } from '../lib'
import { publishPostAction } from '../actions'
import { ackSettings } from '@/lib/acks'
import { Checkbox, CheckboxGroup, DateField, FileField, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'
import { roleOptions } from '@/lib/audience'
import { ACCEPT_UPLOADS, MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.team') }
}

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ ch?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('team.post')) return <Forbidden text={t('common.notAllowed')} />
  const { ch } = await searchParams
  const [channels, roleKeys, roles] = await Promise.all([visibleChannels(ctx), myRoleKeys(ctx.user.id), roleOptions(ctx.org.id)])
  const postable = channels.filter((c) => canPostTo(ctx, c, roleKeys))
  const mayPin = postable.some((c) => canModerate(ctx, c))
  const preset = postable.find((c) => c.id === ch)?.id ?? ''

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('team.label')}</span>
          <h1>{t('team.form.title')}</h1>
          <p className="sub">{t('team.form.sub')}</p>
        </div>
        <Link className="btn ghost" href="/team">← {t('team.post.back')}</Link>
      </div>
      <div className="scroll">
        <div className="tabpanel" style={{ maxWidth: 880 }}>
          {!postable.length ? (
            <div className="alert warn"><span className="grow">{t('team.form.noChannel')}</span></div>
          ) : (
            <ActionForm action={publishPostAction} success="team.form.published" reset={false}>
              <div className="form-grid">
                <Select label={t('team.form.channel')} name="channelId" defaultValue={preset} required>
                    <option value="" disabled>{t('team.form.channelPick')}</option>
                    {postable.map((c) => <option key={c.id} value={c.id}>{c.name} · {t('team.kinds.' + c.kind)}</option>)}
                  </Select>
                <TextField label={t('team.form.fTitle')} wrapClassName="span-all" name="title" maxLength={200} required autoComplete="off" />
                <Textarea label={t('team.form.body')} hint={t('team.form.bodyHint')} wrapClassName="span-all" name="body" rows={8} required />
              </div>

              <fieldset>
                <legend className="lbl">{t('team.form.options')}</legend>
                <div className="row" style={{ gap: 18 }}>
                  <Checkbox name="important" label={t('team.form.important')} />
                  <Checkbox name="requireAck" defaultChecked={ackSettings(ctx.org.settings).postsRequireAckDefault} label={t('team.form.requireAck')} />
                  {mayPin && <Checkbox name="pinned" label={t('team.form.pin')} />}
                </div>
                <p className="small muted" style={{ margin: '6px 0 0' }}>{t('team.form.ackHint')}</p>
              </fieldset>

              <CheckboxGroup label={t('team.audience.label')} hint={t('team.audience.hint')} name="audienceRoles" inline small optional options={roles.map((r) => ({ value: r.key, label: r.name }))} />

              <fieldset>
                <legend className="lbl">{t('team.form.event')}</legend>
                <div className="form-grid">
                  <DateField label={t('team.form.eventDate')} name="eventDate" />
                  <TimeField label={t('team.form.eventTime')} name="eventTime" />
                  <TextField label={t('team.form.eventPlace')} name="eventPlace" maxLength={200} />
                </div>
              </fieldset>

              <div className="form-grid">
                <DateField label={t('team.form.expiresAt')} hint={t('team.form.expiresHint')} name="expiresAt" />
                <FileField label={t('team.form.attachments')} hint={t('team.form.attachHint')} name="files" multiple accept={ACCEPT_UPLOADS} maxSize={MAX_UPLOAD_BYTES} typesLabel="PDF, JPG, PNG, DOCX, XLSX, PPTX" />
              </div>

              <div className="form-actions">
                <Submit>{t('team.form.publish')}</Submit>
                <Link className="btn ghost" href="/team">{t('common.cancel')}</Link>
              </div>
            </ActionForm>
          )}
        </div>
      </div>
    </main>
  )
}
