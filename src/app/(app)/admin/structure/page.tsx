import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { UNIT_KINDS } from '@/lib/admin-shared'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn, FormDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import {
  addTeamMemberAction, deleteLocationAction, deleteRoomAction, deleteTeamAction, deleteUnitAction,
  removeTeamMemberAction, saveLocationAction, saveRoomAction, saveTeamAction, saveUnitAction,
} from './actions'
import { NumberField, Select, TextField } from '@/components/ui/fields'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.structure')} · ${t('nav.admin')}` }
}

export default async function StructurePage({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.org')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const [locations, units, teams, users] = await Promise.all([
    db.location.findMany({ where: { orgId: org.id }, include: { _count: { select: { units: true } } }, orderBy: { name: 'asc' } }),
    db.unit.findMany({
      where: { orgId: org.id },
      include: { location: true, _count: { select: { rooms: true, residents: { where: { status: { in: ['active', 'absent'] } } } } } },
      orderBy: [{ location: { name: 'asc' } }, { name: 'asc' }],
    }),
    db.team.findMany({ where: { orgId: org.id }, include: { unit: true, members: { include: { user: { select: { id: true, firstName: true, lastName: true, initials: true, active: true } } } } }, orderBy: { name: 'asc' } }),
    db.user.findMany({ where: { orgId: org.id, active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ])
  const unit = units.find((u) => u.id === sp.unit) ?? units[0] ?? null
  const rooms = unit
    ? await db.room.findMany({ where: { unitId: unit.id }, include: { residents: { where: { status: { in: ['active', 'absent'] } }, select: { id: true } } }, orderBy: { number: 'asc' } })
    : []
  const save = t('common.save')
  const del = t('common.delete')

  const locationFields = (l?: (typeof locations)[number]) => (
    <div className="form-grid">
      {l && <input type="hidden" name="id" value={l.id} />}
      <TextField label={t('admin.structure.name')} wrapClassName="span-all" name="name" defaultValue={l?.name} required maxLength={120} autoFocus />
      <TextField label={t('admin.structure.address')} wrapClassName="span-all" name="address" defaultValue={l?.address ?? ''} maxLength={200} />
      <TextField label={t('admin.structure.phone')} name="phone" type="tel" defaultValue={l?.phone ?? ''} maxLength={40} />
    </div>
  )
  const unitFields = (u?: (typeof units)[number]) => (
    <div className="form-grid">
      {u && <input type="hidden" name="id" value={u.id} />}
      <TextField label={t('admin.structure.name')} name="name" defaultValue={u?.name} required maxLength={120} autoFocus />
      <TextField label={t('admin.structure.shortName')} name="shortName" defaultValue={u?.shortName ?? ''} maxLength={12} />
      <Select label={t('admin.structure.kind')} name="kind" defaultValue={u?.kind ?? 'ward'}>{UNIT_KINDS.map((k) => <option key={k} value={k}>{t('admin.structure.kinds.' + k)}</option>)}</Select>
      <Select label={t('admin.structure.location')} name="locationId" defaultValue={u?.locationId ?? locations[0]?.id} required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
    </div>
  )
  const teamFields = (tm?: (typeof teams)[number]) => (
    <div className="form-grid">
      {tm && <input type="hidden" name="id" value={tm.id} />}
      <TextField label={t('admin.structure.name')} name="name" defaultValue={tm?.name} required maxLength={120} autoFocus />
      <Select label={t('admin.structure.unit')} name="unitId" defaultValue={tm?.unitId ?? ''}>
          <option value="">{t('admin.structure.noUnit')}</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.location.name}</option>)}
        </Select>
    </div>
  )

  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.structure')} sub={t('admin.structure.sub')} />
      <div className="scroll">
        <div className="tabpanel">
          {/* Standorte */}
          <section className="stack-sm" aria-labelledby="s-loc">
            <div className="sec-head">
              <h2 className="sec" id="s-loc">{t('admin.structure.locations')}</h2>
              <FormDialog label={t('admin.structure.addLocation')} buttonClass="btn sm" title={t('admin.structure.addLocation')} action={saveLocationAction} submit={save} success="common.saved">{locationFields()}</FormDialog>
            </div>
            <div className="tablewrap">
              <table className="stable">
                <thead><tr><th>{t('admin.structure.name')}</th><th>{t('admin.structure.address')}</th><th>{t('admin.structure.phone')}</th><th className="right">{t('admin.structure.units')}</th><th className="right"><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id}>
                      <th scope="row">{l.name}</th>
                      <td className="fg2">{l.address ?? '–'}</td>
                      <td className="num">{l.phone ?? '–'}</td>
                      <td className="num right">{l._count.units}</td>
                      <td className="right nowrap">
                        <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={l.name} action={saveLocationAction} submit={save} success="common.saved">{locationFields(l)}</FormDialog>
                        {l._count.units === 0 && <ActBtn action={deleteLocationAction.bind(null, l.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<strong>{l.name}</strong>}>{del}</ActBtn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Bereiche */}
          <section className="stack-sm" aria-labelledby="s-unit">
            <div className="sec-head">
              <h2 className="sec" id="s-unit">{t('admin.structure.unitsTitle')}</h2>
              {locations.length > 0 && <FormDialog label={t('admin.structure.addUnit')} buttonClass="btn sm" title={t('admin.structure.addUnit')} action={saveUnitAction} submit={save} success="common.saved">{unitFields()}</FormDialog>}
            </div>
            <div className="tablewrap">
              <table className="stable">
                <thead><tr><th>{t('admin.structure.name')}</th><th>{t('admin.structure.shortName')}</th><th>{t('admin.structure.kind')}</th><th>{t('admin.structure.location')}</th><th className="right">{t('admin.structure.rooms')}</th><th className="right">{t('admin.structure.occupants')}</th><th className="right"><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <th scope="row">{u.name}</th>
                      <td className="num">{u.shortName ?? '–'}</td>
                      <td>{t('admin.structure.kinds.' + ((UNIT_KINDS as readonly string[]).includes(u.kind) ? u.kind : 'other'))}</td>
                      <td className="fg2">{u.location.name}</td>
                      <td className="num right">{u._count.rooms}</td>
                      <td className="num right">{u._count.residents}</td>
                      <td className="right nowrap">
                        <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={u.name} action={saveUnitAction} submit={save} success="common.saved">{unitFields(u)}</FormDialog>
                        {u._count.residents === 0 && <ActBtn action={deleteUnitAction.bind(null, u.id)} className="btn sm ghost" confirm="admin.structure.deleteUnitConfirm" context={<strong>{u.name}</strong>} ack={t('admin.ux.deleteUnitAck')}>{del}</ActBtn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Zimmer */}
          <section className="stack-sm" aria-labelledby="s-room">
            <div className="sec-head">
              <h2 className="sec" id="s-room">{t('admin.structure.roomsTitle')}</h2>
              <nav className="chips" aria-label={t('admin.structure.unit')}>
                {units.map((u) => <Link key={u.id} className="chip" href={`/admin/structure?unit=${u.id}#s-room`} aria-current={u.id === unit?.id ? 'page' : undefined} scroll={false}>{u.shortName ?? u.name}</Link>)}
              </nav>
            </div>
            {unit ? (
              <div className="card">
                <div className="card-body">
                  <ActionForm action={saveRoomAction} success="common.saved" className="row">
                    <input type="hidden" name="unitId" value={unit.id} />
                    <TextField label={t('admin.structure.roomNo')} wrapStyle={{ width: 120 }} name="number" required maxLength={12} className="mono" />
                    <NumberField label={t('admin.structure.beds')} wrapStyle={{ width: 90 }} name="beds" min={1} max={8} defaultValue={1} step={1} />
                    <div style={{ alignSelf: 'flex-end' }}><Submit className="btn">{t('admin.structure.addRoom')}</Submit></div>
                  </ActionForm>
                </div>
                {rooms.length ? (
                  <div className="tablewrap" style={{ border: 0, borderTop: '1px solid var(--line)', borderRadius: 0 }}>
                    <table className="stable">
                      <thead><tr><th>{t('admin.structure.roomNo')}</th><th className="right">{t('admin.structure.beds')}</th><th className="right">{t('admin.structure.occupancy')}</th><th className="right"><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                      <tbody>
                        {rooms.map((r) => (
                          <tr key={r.id}>
                            <th scope="row" className="mono">{r.number}</th>
                            <td className="num right">{r.beds}</td>
                            <td className="num right">{r.residents.length > r.beds ? <span className="crit-text">{r.residents.length}/{r.beds} ▲</span> : `${r.residents.length}/${r.beds}`}</td>
                            <td className="right nowrap">
                              <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={t('admin.structure.roomTitle', { n: r.number })} action={saveRoomAction} submit={save} success="common.saved">
                                <input type="hidden" name="id" value={r.id} />
                                <div className="form-grid">
                                  <TextField label={t('admin.structure.roomNo')} name="number" defaultValue={r.number} required maxLength={12} className="mono" />
                                  <NumberField label={t('admin.structure.beds')} name="beds" min={1} max={8} defaultValue={r.beds} step={1} />
                                  <Select label={t('admin.structure.unit')} name="unitId" defaultValue={r.unitId}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                                </div>
                              </FormDialog>
                              {r.residents.length === 0 && <ActBtn action={deleteRoomAction.bind(null, r.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<span>{t('admin.structure.roomNo')} <strong className="mono">{r.number}</strong></span>}>{del}</ActBtn>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="card-body" style={{ paddingTop: 0 }}><Empty title={t('admin.structure.noRooms')} /></div>}
              </div>
            ) : <Empty title={t('admin.structure.noUnits')} />}
          </section>

          {/* Teams */}
          <section className="stack-sm" aria-labelledby="s-team">
            <div className="sec-head">
              <h2 className="sec" id="s-team">{t('admin.structure.teams')}</h2>
              <FormDialog label={t('admin.structure.addTeam')} buttonClass="btn sm" title={t('admin.structure.addTeam')} action={saveTeamAction} submit={save} success="common.saved">{teamFields()}</FormDialog>
            </div>
            {teams.length ? (
              <div className="grid-2">
                {teams.map((tm) => {
                  const memberIds = new Set(tm.members.map((m) => m.userId))
                  return (
                    <div key={tm.id} className="card">
                      <div className="card-head">
                        <div><h3>{tm.name}</h3><span className="small muted">{tm.unit?.name ?? t('admin.structure.noUnit')} · {t('admin.structure.memberCount', { n: tm.members.length })}</span></div>
                        <div className="row" style={{ gap: 4 }}>
                          <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={tm.name} action={saveTeamAction} submit={save} success="common.saved">{teamFields(tm)}</FormDialog>
                          <ActBtn action={deleteTeamAction.bind(null, tm.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<strong>{tm.name}</strong>}>{del}</ActBtn>
                        </div>
                      </div>
                      <div className="card-body stack-sm">
                        <div className="chips">
                          {tm.members.map((m) => (
                            <span key={m.userId} className="chip row" style={{ gap: 6, display: 'inline-flex' }}>
                              {m.user.firstName} {m.user.lastName}{!m.user.active && <span className="tag">{t('admin.users.inactive')}</span>}
                              <ActBtn action={removeTeamMemberAction.bind(null, tm.id, m.userId)} className="linkbtn small" title={t('admin.structure.removeMember')}>✕<span className="sr-only">{t('admin.structure.removeMember')}</span></ActBtn>
                            </span>
                          ))}
                          {!tm.members.length && <span className="small muted">{t('admin.structure.noMembers')}</span>}
                        </div>
                        <ActionForm action={addTeamMemberAction} success="common.saved" className="row">
                          <input type="hidden" name="teamId" value={tm.id} />
                          <Select name="userId" aria-label={t('admin.structure.addMember')} required defaultValue="" style={{ minWidth: 160 }} className="grow">
                            <option value="" disabled>{t('admin.structure.pickPerson')}</option>
                            {users.filter((u) => !memberIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.lastName} {u.firstName}</option>)}
                          </Select>
                          <Submit className="btn sm">{t('admin.structure.addMember')}</Submit>
                        </ActionForm>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : <Empty title={t('admin.structure.noTeams')} />}
          </section>
        </div>
      </div>
    </main>
  )
}
