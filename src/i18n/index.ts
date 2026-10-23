import type { Locale, Tree } from './core'
import common from './messages/common'
import nav from './messages/nav'
import auth from './messages/auth'
import home from './messages/home'
import residents from './messages/residents'
import care from './messages/care'
import chart from './messages/chart'
import meds from './messages/meds'
import tasks from './messages/tasks'
import schedule from './messages/schedule'
import team from './messages/team'
import docs from './messages/docs'
import learn from './messages/learn'
import quality from './messages/quality'
import insights from './messages/insights'
import admin from './messages/admin'
import profile from './messages/profile'
import forms from './messages/forms'
import visit from './messages/visit'
import platform from './messages/platform'
import people from './messages/people'
import imports from './messages/imports'
import design from './messages/design'
import register from './messages/register'
import tenancy from './messages/tenancy'
import developer from './messages/developer'
import md from './messages/md'
import therapy from './messages/therapy'
import portal from './messages/portal'
import residentPortal from './messages/resident-portal'
import roster from './messages/roster'
import spitex from './messages/spitex'

const NAMESPACES = { common, nav, auth, home, residents, care, chart, meds, tasks, schedule, team, docs, learn, quality, insights, admin, profile, forms, visit, people, platform, imports, design, register, tenancy, md, developer, therapy, portal, residentPortal, roster, spitex }

export type Namespace = keyof typeof NAMESPACES

const cache = new Map<Locale, Tree>()

/** Vollständiges Wörterbuch einer Sprache, gruppiert nach Namespace (z. B. "residents.tabs.overview"). */
export function dictionary(locale: Locale): Tree {
  let d = cache.get(locale)
  if (!d) {
    d = {}
    for (const [ns, m] of Object.entries(NAMESPACES)) d[ns] = m[locale]
    cache.set(locale, d)
  }
  return d
}
