import type { TFn } from '@/i18n/core'

/** Systemerzeugte Aufgaben tragen Schlüssel statt Text, damit sie in jeder Sprache lesbar sind. */
export function taskTitle(t: TFn, task: { title: string; dueAt: Date | string }) {
  if (task.title === 'medication.slot') return t('tasks.medSlot')
  if (task.title.startsWith('assessment.')) return t('tasks.assessmentDue', { name: t('care.assessments.names.' + task.title.slice(11)) })
  if (task.title.startsWith('incident.')) return t('quality.workflow.' + task.title.slice(9))
  if (task.title.startsWith('visit.order.')) return t('visit.task.' + task.title.slice(12))
  return task.title
}
