import { describe, it, expect, vi } from 'vitest'
import {
  REVOKE,
  REVIEW,
  SKIP,
  tokenFromUrl,
  pathFromDownloadUrl,
  classifyPointer,
  classifyDoc,
  planRevoke,
  applyTargets,
  runRevoke,
} from './legacyDownloadUrls'

const TOKEN = '11111111-2222-4333-8444-555555555555'
const downloadUrl = (objectPath = 'orgs/a/incidents/p.jpg') =>
  `https://firebasestorage.googleapis.com/v0/b/ohsms.appspot.com/o/${encodeURIComponent(objectPath)}?alt=media&token=${TOKEN}`

describe('tokenFromUrl', () => {
  it('reads the token off a Firebase download URL', () => {
    expect(tokenFromUrl(downloadUrl())).toBe(TOKEN)
  })

  it('ignores inline data URLs and ordinary https links', () => {
    expect(tokenFromUrl('data:image/png;base64,aaa')).toBe('')
    expect(tokenFromUrl('https://example.com/file.pdf?token=abc')).toBe('')
    expect(tokenFromUrl('')).toBe('')
  })
})

describe('pathFromDownloadUrl is a hint, not a stored path', () => {
  it('decodes the object path from the URL', () => {
    expect(pathFromDownloadUrl(downloadUrl('orgs/a/incidents/p.jpg'))).toBe(
      'orgs/a/incidents/p.jpg'
    )
  })
})

describe('classifyPointer — the safety split', () => {
  it('revokes only when a stored path sits next to the token', () => {
    const row = classifyPointer({ url: downloadUrl(), path: 'orgs/a/incidents/p.jpg' }, 'photos/1')
    expect(row).toMatchObject({ action: REVOKE, path: 'orgs/a/incidents/p.jpg', token: TOKEN })
  })

  it('sends url-only pointers to review, even when the URL itself encodes a path', () => {
    // The encoded path is the trap. Using it to strip the token would break
    // fileUrl's fallback — the only way this record still opens — which is
    // exactly the blind revoke #49 refused to do.
    const row = classifyPointer({ url: downloadUrl('orgs/a/legacy.jpg') }, 'photos/old')
    expect(row.action).toBe(REVIEW)
    expect(row.reason).toBe('url-only')
    expect(row.path).toBeUndefined()
    expect(row.suggestedPath).toBe('orgs/a/legacy.jpg')
  })

  it('accepts fileUrl/filePath and logoUrl/logoPath as the same shape', () => {
    expect(
      classifyPointer({
        fileUrl: downloadUrl(),
        filePath: 'orgs/a/permits/d.pdf',
      }).action
    ).toBe(REVOKE)
    expect(
      classifyPointer({
        logoUrl: downloadUrl(),
        logoPath: 'orgs/a/org-logo/x.png',
      }).action
    ).toBe(REVOKE)
    expect(classifyPointer({ fileUrl: downloadUrl() }).action).toBe(REVIEW)
    expect(classifyPointer({ logoUrl: downloadUrl() }).action).toBe(REVIEW)
  })

  it('skips inline bytes, path-only records, and empty objects', () => {
    expect(classifyPointer({ url: 'data:image/jpeg;base64,/9j/', path: '' }).action).toBe(SKIP)
    expect(classifyPointer({ path: 'orgs/a/incidents/p.jpg' }).action).toBe(SKIP)
    expect(classifyPointer({ url: '', path: '' }).action).toBe(SKIP)
    expect(classifyPointer(null).action).toBe(SKIP)
  })
})

describe('classifyDoc walks nested quotation / photo shapes', () => {
  it('finds a top-level logo and a nested quotation independently', () => {
    const rows = classifyDoc(
      {
        logoUrl: downloadUrl('orgs/a/org-logo/x.png'),
        logoPath: 'orgs/a/org-logo/x.png',
        quotation: { fileUrl: downloadUrl('orgs/a/quotations/q.pdf') },
      },
      { collection: 'organizations', id: 'orgA' }
    )

    const actions = rows.map((r) => r.action).sort()
    expect(actions).toEqual([REVIEW, REVOKE].sort())
    expect(rows.find((r) => r.action === REVIEW).reason).toBe('url-only')
  })
})

describe('applyTargets never includes a review row', () => {
  it('drops url-only rows even if a caller concatenates them onto revoke', () => {
    const mixed = planRevoke([
      classifyPointer({ url: downloadUrl(), path: 'orgs/a/p.jpg' }),
      classifyPointer({ url: downloadUrl() }),
    ])
    mixed.revoke = mixed.revoke.concat(mixed.review)
    const targets = applyTargets(mixed)
    expect(targets).toHaveLength(1)
    expect(targets[0].path).toBe('orgs/a/p.jpg')
    expect(targets.every((t) => t.action === REVOKE && t.path)).toBe(true)
  })

  it('drops a revoke row that lost its path', () => {
    expect(applyTargets({ revoke: [{ action: REVOKE, path: '' }] })).toEqual([])
  })
})

describe('runRevoke is dry by default and never strips a review path', () => {
  it('does not call stripToken unless apply is true', async () => {
    const stripToken = vi.fn()
    const plan = planRevoke([classifyPointer({ url: downloadUrl(), path: 'orgs/a/p.jpg' })])
    const out = await runRevoke(plan, { stripToken })
    expect(out).toMatchObject({ dryRun: true, revoked: 0, wouldRevoke: 1 })
    expect(stripToken).not.toHaveBeenCalled()
  })

  it('refuses apply without an implementation rather than guessing', async () => {
    const plan = planRevoke([classifyPointer({ url: downloadUrl(), path: 'orgs/a/p.jpg' })])
    await expect(runRevoke(plan, { apply: true })).rejects.toThrow(/stripToken/)
  })

  it('strips only stored paths when apply is set', async () => {
    const stripped = []
    const plan = planRevoke([
      classifyPointer({ url: downloadUrl(), path: 'orgs/a/safe.jpg' }),
      classifyPointer({ url: downloadUrl('orgs/a/legacy.jpg') }),
    ])
    const out = await runRevoke(plan, {
      apply: true,
      stripToken: async (path) => {
        stripped.push(path)
      },
    })
    expect(out.dryRun).toBe(false)
    expect(out.revoked).toBe(1)
    expect(stripped).toEqual(['orgs/a/safe.jpg'])
    expect(out.review).toBe(1)
  })
})
