import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { canModerate, canPostTo, myRoleKeys, visibleChannels } from '../lib'
import { publishPostAction } from '../actions'
import { ackSettings } from '@/lib/acks'

export const metadata = { title: 'Team' }

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ ch?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('team.post')) return <Forbidden text={t('common.notAllowed')} />
  const { ch } = await searchParams
  const [channels, roleKeys] = await Promise.all([visibleChannels(ctx), myRoleKeys(ctx.user.id)])
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
                <label className="fld">
                  <span className="lbl">{t('team.form.channel')}</span>
                  <select name="channelId" className="field" defaultValue={preset} required>
                    <option value="" disabled>{t('team.form.channelPick')}</option>
                    {postable.map((c) => <option key={c.id} value={c.id}>{c.name} · {t('team.kinds.' + c.kind)}</option>)}
                  </select>
                </label>
                <label className="fld span-all">
                  <span className="lbl">{t('team.form.fTitle')}</span>
                  <input name="title" className="field" maxLength={200} required autoComplete="off" />
                </label>
                <label className="fld span-all">
                  <span className="lbl">{t('team.form.body')}</span>
                  <textarea name="body" className="field" rows={8} required />
                  <span className="hint">{t('team.form.bodyHint')}</span>
                </label>
              </div>

              <fieldset>
                <legend className="lbl">{t('team.form.options')}</legend>
                <div className="row" style={{ gap: 18 }}>
                  <label className="check"><input type="checkbox" name="important" />{t('team.form.important')}</label>
                  <label className="check"><input type="checkbox" name="requireAck" defaultChecked={ackSettings(ctx.org.settings).postsRequireAckDefault} />{t('team.form.requireAck')}</label>
                  {mayPin && <label className="check"><input type="checkbox" name="pinned" />{t('team.form.pin')}</label>}
                </div>
                <p className="small muted" style={{ margin: '6px 0 0' }}>{t('team.form.ackHint')}</p>
              </fieldset>

              <fieldset>
                <legend className="lbl">{t('team.form.event')}</legend>
                <div className="form-grid">
                  <label className="fld"><span className="lbl">{t('team.form.eventDate')}</span><input type="date" name="eventDate" className="field" /></label>
                  <label className="fld"><span className="lbl">{t('team.form.eventTime')}</span><input type="time" name="eventTime" className="field" /></label>
                  <label className="fld"><span className="lbl">{t('team.form.eventPlace')}</span><input name="eventPlace" className="field" maxLength={200} /></label>
                </div>
              </fieldset>

              <div className="form-grid">
                <label className="fld">
                  <span className="lbl">{t('team.form.expiresAt')}</span>
                  <input type="date" name="expiresAt" className="field" />
                  <span className="hint">{t('team.form.expiresHint')}</span>
                </label>
                <label className="fld">
                  <span className="lbl">{t('team.form.attachments')}</span>
                  <input type="file" name="files" multiple className="field" />
                  <span className="hint">{t('team.form.attachHint')}</span>
                </label>
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
