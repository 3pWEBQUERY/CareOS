import type { TFn } from '@/i18n/core'

/** «<key>» oder «<key>:<Name>» (organisationseigene Instrumente und Pflegebereiche tragen ihren Namen mit). */
function keyAndName(rest: string) {
  const i = rest.indexOf(':')
  return i < 0 ? { key: rest, name: null } : { key: rest.slice(0, i), name: rest.slice(i + 1) }
}

/** Systemerzeugte Aufgaben tragen Schlüssel statt Text, damit sie in jeder Sprache lesbar sind. */
export function taskTitle(t: TFn, task: { title: string; dueAt: Date | string }) {
  if (task.title === 'medication.slot') return t('tasks.medSlot')
  if (task.title.startsWith('assessment.')) {
    const { key, name } = keyAndName(task.title.slice(11))
    return t('tasks.assessmentDue', { name: name ?? t('care.assessments.names.' + key) })
  }
  if (task.title.startsWith('evaluation.')) {
    const { key, name } = keyAndName(task.title.slice(11))
    return t('tasks.evaluationDue', { name: name ?? t('care.domains.' + key) })
  }
  if (task.title.startsWith('rule.')) return t('tasks.rules.' + task.title.slice(5) + '.task')
  if (task.title.startsWith('incident.')) return t('quality.workflow.' + task.title.slice(9))
  if (task.title.startsWith('visit.order.')) return t('visit.task.' + task.title.slice(12))
  return task.title
}
