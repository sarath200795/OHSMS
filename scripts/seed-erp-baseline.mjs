// ─────────────────────────────────────────────────────────────────────────────
// Seeds the org-wide BASELINE emergency response library (erpRescuePlans with
// kind: 'baseline'). Sites recall these and adapt them locally.
//
// Procedures are generic, industry-standard emergency response steps, usable by
// any organization in any country — structured role-by-role (DURING / AFTER) in
// the way site ERPs conventionally are.
//
// Two things are deliberately NOT hardcoded, so one library serves everybody:
//
//   ROLES. Every step names a role key ('CM', 'Safety L1', …), never a person
//   and never a job title. Each organization sets what it calls those roles in
//   Org Settings → General, and steps referring to a role in prose use a
//   {{role:KEY}} placeholder that renders in the org's own language.
//
//   PHONE NUMBERS. Steps say "call the site Ambulance contact" rather than
//   naming a national helpline, because 112/999/911 differ by country and the
//   site's own mapped contacts (Emergency Response → Site Repository) already
//   hold the nearest hospital, police and fire numbers. The national helpline
//   still prints on the SOS poster, from Org Settings.
//
// Run:  node scripts/seed-erp-baseline.mjs [--replace]
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDocs, collection, writeBatch, serverTimestamp } from 'firebase/firestore'
import { connect } from './_firebase.mjs'
// Single source of truth — the same library the web app installs. Administrators
// normally do this from Emergency Response → Baseline Plans, with no terminal
// and no production credentials; this script stays for scripted provisioning.
import { BASELINE_LIBRARY as PLANS } from '../src/modules/emergency/lib/baselineLibrary.js'

async function main() {
  const replace = process.argv.includes('--replace')
  const { db, uid, orgId, profile } = await connect()

  const col = collection(db, 'organizations', orgId, 'erpRescuePlans')
  const existing = (await getDocs(col)).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.kind === 'baseline')

  if (replace && existing.length) {
    const del = writeBatch(db)
    for (const p of existing) del.delete(doc(col, p.id))
    await del.commit()
    console.log(`Removed ${existing.length} existing baseline plan(s)`)
  }
  const covered = new Set(replace ? [] : existing.map((p) => p.scenario))

  const todo = PLANS.filter((p) => !covered.has(p.scenario))
  if (!todo.length) {
    console.log('All baseline scenarios already present — nothing to do.')
    process.exit(0)
  }

  const batch = writeBatch(db)
  for (const p of todo) {
    batch.set(doc(col), {
      kind: 'baseline',
      baselineId: '',
      baselineName: '',
      customized: false,
      siteId: '', siteName: '', region: '', entity: '',
      scenario: p.scenario,
      title: p.title,
      description: p.description,
      triggers: p.triggers,
      assemblyPoint: 'Primary Assembly Point (confirm per site)',
      steps: p.steps.map((s, i) => ({ id: `st-${i}`, order: i + 1, action: s.action, responsible: s.responsible })),
      team: p.team.map((role, i) => ({ id: `tm-${i}`, role, name: '', phone: '', uid: '' })),
      equipment: p.equipment,
      status: 'approved',
      reviewedOn: new Date().toISOString().slice(0, 10),
      nextReviewOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      createdAt: serverTimestamp(),
      createdBy: uid,
      createdByName: profile?.name || 'Admin',
    })
  }
  await batch.commit()

  console.log(`✓ Seeded ${todo.length} baseline ERP plan(s) for org ${orgId}:`)
  for (const p of todo) console.log(`   • ${p.scenario} — ${p.title} (${p.steps.length} steps)`)
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
