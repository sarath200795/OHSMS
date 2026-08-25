import { useEffect, useState } from 'react'
import { Boxes, ArrowRight, Link2 } from 'lucide-react'
import { Modal, Spinner, Badge } from './ui'

/**
 * The site links of the extinguisher register: the ones already made, and the
 * ones the matcher is proposing.
 *
 * The proposal used to be a window.confirm carrying three numbers and up to
 * twelve center names. It asked the reader to approve a write across the whole
 * register while showing them none of it — and the one thing they needed to
 * check, whether "Sunrise Miyapur" really is the site the matcher thinks it is,
 * was the one thing it would not show.
 *
 * The linked tab exists because that was only half the question. Once the
 * linking has run there is nothing left to propose, and the answer to "which
 * units are attached to a site?" was nowhere in the module — the button that
 * would have told you disappears precisely when the data is healthy.
 *
 * Used by all three registers, so the noun and the id column are props: an
 * extinguisher is identified by its serial, an AED by its asset id, a
 * fire-alarm device by its device id.
 *
 * Props: open, onClose, plan (from planSiteLinks), linkedRows (from
 * listLinkedAssets), initialTab, onConfirm, busy, noun, nounPlural, idLabel
 */

// Whichever id the register uses. Kept here so the pending rows label the same
// way listLinkedAssets already does for the linked ones.
const assetLabel = (a) => (a?.serialNo || a?.assetId || a?.deviceId || '').trim() || '—'

const HOW_LABEL = {
  exact: 'Exact name',
  normalised: 'Normalised',
  override: 'Mapped by hand',
}
const HOW_TONE = {
  exact: 'green',
  normalised: 'blue',
  override: 'amber',
}

export default function LinkSitesModal({
  open,
  onClose,
  plan,
  linkedRows = [],
  initialTab = 'linked',
  onConfirm,
  busy = false,
  noun = 'extinguisher',
  nounPlural,
  idLabel = 'Serial',
}) {
  const plural = nounPlural || `${noun}s`
  const unit = (n) => `${n} ${n === 1 ? noun : plural}`
  const [tab, setTab] = useState(initialTab)

  // Each opening starts on the tab the caller asked for — pending work when
  // there is any, the linked list when there is not.
  useEffect(() => { if (open) setTab(initialTab) }, [open, initialTab])

  const { linked = [], unmatched = [], unmatchedCenters = [], entityChanges = 0, nameChanges = 0 } = plan || {}
  const showing = tab === 'pending' ? 'pending' : 'linked'

  const TABS = [
    { key: 'linked', label: `Linked (${linkedRows.length})`, icon: Link2 },
    { key: 'pending', label: `To link (${linked.length})`, icon: Boxes },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${plural[0].toUpperCase()}${plural.slice(1)} and their sites`}
      subtitle={
        showing === 'pending'
          ? `${unit(linked.length)} will be attached to a site in the registry`
          : `${unit(linkedRows.length)} attached to a site in the registry`
      }
      maxWidth="max-w-4xl"
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'inline-flex items-center gap-2 rounded-2xl px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-emil',
              showing === t.key
                ? 'bg-clay-surface text-ink-900 shadow-clay-pressed'
                : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800 active:scale-[0.98]',
            ].join(' ')}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {showing === 'linked' ? (
        linkedRows.length === 0 ? (
          <p className="rounded-2xl bg-clay-100/70 px-4 py-8 text-center text-sm text-ink-500">
            No {noun} is attached to a site yet.
          </p>
        ) : (
          <div className="max-h-[45vh] overflow-auto rounded-2xl border border-clay-200/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-clay-100 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2">{idLabel}</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Region</th>
                  <th className="px-3 py-2">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {linkedRows.map(({ asset, site, label }) => (
                  <tr key={asset.id} className="hover:bg-clay-100/40">
                    <td className="px-3 py-2 font-semibold text-ink-900">{label}</td>
                    <td className="px-3 py-2 text-ink-800">{site.name || site.id}</td>
                    <td className="px-3 py-2 text-ink-500">{site.region || '—'}</td>
                    <td className="px-3 py-2 text-ink-500">{site.entity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : linked.length === 0 ? (
        <p className="rounded-2xl bg-clay-100/70 px-4 py-8 text-center text-sm text-ink-500">
          Nothing left to link — every {noun} whose center name matches a site is already attached.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {entityChanges > 0 && (
              <span className="rounded-xl bg-clay-100 px-2.5 py-1 text-ink-600">
                {entityChanges} will take a corrected <strong className="font-semibold text-ink-800">Entity</strong> from the site registry
              </span>
            )}
            {nameChanges > 0 && (
              <span className="rounded-xl bg-clay-100 px-2.5 py-1 text-ink-600">
                {nameChanges} will take the registry&rsquo;s <strong className="font-semibold text-ink-800">site name</strong>
              </span>
            )}
          </div>

          <div className="max-h-[40vh] overflow-auto rounded-2xl border border-clay-200/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-clay-100 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2">{idLabel}</th>
                  <th className="px-3 py-2">Name on the asset</th>
                  <th className="px-3 py-2">Links to site</th>
                  <th className="px-3 py-2">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {linked.map(({ asset, site, how, entityChanged, nameChanged }) => (
                  <tr key={asset.id} className="hover:bg-clay-100/40">
                    <td className="px-3 py-2 font-semibold text-ink-900">{assetLabel(asset)}</td>
                    <td className="px-3 py-2 text-ink-600">{asset.centerName || <span className="text-ink-300">(no name)</span>}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-ink-900">
                        <ArrowRight size={13} className="text-ink-400" />
                        {site.name}
                      </span>
                      {(entityChanged || nameChanged) && (
                        <span className="ml-2 text-[11px] text-ink-400">
                          {[entityChanged && 'entity', nameChanged && 'name'].filter(Boolean).join(' + ')} updated
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={HOW_TONE[how] || 'gray'}>{HOW_LABEL[how] || how}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unmatched.length > 0 && (
            <div className="mt-4 rounded-2xl bg-clay-100/70 p-3">
              <p className="text-xs font-semibold text-ink-700">
                Left alone — {unmatched.length} unit{unmatched.length === 1 ? '' : 's'} across {unmatchedCenters.length} name
                {unmatchedCenters.length === 1 ? '' : 's'} with no site to match
              </p>
              <p className="mt-1 max-h-24 overflow-auto text-xs leading-relaxed text-ink-500">
                {unmatchedCenters.join(' · ')}
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        {showing === 'pending' && linked.length > 0 && (
          <button className="btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner size={18} /> : (<><Boxes size={16} /> Link {linked.length} to sites</>)}
          </button>
        )}
      </div>
    </Modal>
  )
}
