import { describe, it, expect } from 'vitest'
import {
  attachmentShape, shapeAttachments, isUsable, referenceHref, describeReference, attachmentSummary,
  ATTACHMENT_KINDS,
} from './attachments'

const file = (o = {}) => ({ mode: 'file', name: 'clip.mp4', url: 'https://cdn.test/clip.mp4', size: 900, ...o })
const ref = (o = {}) => ({ mode: 'reference', cameraRef: 'CAM-01', recordedAt: '2026-08-09T14:30', ...o })

describe('attachmentShape', () => {
  it('defaults every field, because Firestore rejects undefined', () => {
    const a = attachmentShape({})
    expect(Object.values(a).every((v) => v !== undefined)).toBe(true)
    expect(a).toMatchObject({ mode: 'file', name: '', url: '', size: 0 })
  })

  it('mints an id when none was given, and keeps one that was', () => {
    expect(attachmentShape({}).id).toMatch(/^att-/)
    expect(attachmentShape({ id: 'keep-me' }).id).toBe('keep-me')
  })

  it('only recognises the two modes', () => {
    expect(attachmentShape({ mode: 'reference' }).mode).toBe('reference')
    expect(attachmentShape({ mode: 'nonsense' }).mode).toBe('file')
  })

  it('coerces a non-numeric size rather than storing NaN', () => {
    expect(attachmentShape({ size: 'big' }).size).toBe(0)
  })

  // The shape never varies, so a reader never branches on mode just to read.
  it('carries the reference fields on a file attachment too', () => {
    expect(attachmentShape(file())).toMatchObject({ cameraRef: '', recordedAt: '', location: '' })
  })
})

describe('isUsable', () => {
  // A file row with no url renders as a dead link.
  it('drops a file attachment whose upload produced no url', () => {
    expect(isUsable(attachmentShape(file()))).toBe(true)
    expect(isUsable(attachmentShape(file({ url: '' })))).toBe(false)
  })

  // A reference with nothing identifying it cannot lead anyone to the footage.
  it('keeps a reference that identifies the footage somehow', () => {
    expect(isUsable(attachmentShape(ref()))).toBe(true)
    expect(isUsable(attachmentShape({ mode: 'reference', location: 'https://drive.test/x' }))).toBe(true)
    expect(isUsable(attachmentShape({ mode: 'reference', note: 'On the Hosur DVR, bay 3' }))).toBe(true)
  })

  it('drops an empty reference', () => {
    expect(isUsable(attachmentShape({ mode: 'reference' }))).toBe(false)
  })

  it('survives null', () => {
    expect(isUsable(null)).toBe(false)
  })
})

describe('shapeAttachments', () => {
  it('shapes and filters a list in one pass', () => {
    const out = shapeAttachments([file(), file({ url: '' }), ref(), { mode: 'reference' }])
    expect(out).toHaveLength(2)
  })

  it('handles a missing list', () => {
    expect(shapeAttachments()).toEqual([])
    expect(shapeAttachments('not a list')).toEqual([])
  })
})

describe('referenceHref', () => {
  it('passes an ordinary link through', () => {
    expect(referenceHref({ location: 'https://drive.test/clip' })).toBe('https://drive.test/clip')
  })

  // This field is typed by hand — exactly where a javascript: URL arrives.
  it('refuses a script URL', () => {
    expect(referenceHref({ location: 'javascript:alert(1)' })).toBeUndefined()
  })

  it('returns nothing when there is no location', () => {
    expect(referenceHref({})).toBeUndefined()
    expect(referenceHref(null)).toBeUndefined()
  })
})

describe('describeReference', () => {
  // Camera first: it is the part that still works when the link does not.
  it('leads with the camera and time', () => {
    expect(describeReference(ref({ location: 'https://x.test' }))).toBe('CAM-01 · 2026-08-09T14:30 · link')
  })

  it('falls back to the note when nothing else is set', () => {
    expect(describeReference({ note: 'Ask the Hosur guard' })).toBe('Ask the Hosur guard')
  })

  it('never returns an empty string', () => {
    expect(describeReference({})).toBe('Reference')
  })
})

describe('attachmentSummary', () => {
  it('counts both kinds', () => {
    const s = attachmentSummary({ attachments: { cctv: [file(), ref()], ethics: [file()] } })
    expect(s).toMatchObject({ cctv: 2, ethics: 1, total: 3 })
  })

  // "We hold the clip" and "we know where it is" are different levels of
  // readiness for a dispute.
  it('separates held footage from footage merely pointed at', () => {
    const s = attachmentSummary({ attachments: { cctv: [file(), ref(), ref()] } })
    expect(s).toMatchObject({ cctvFiles: 1, cctvReferences: 2 })
  })

  it('is all zeroes for an escalation with nothing attached', () => {
    expect(attachmentSummary({})).toMatchObject({ total: 0, cctv: 0, ethics: 0 })
  })
})

describe('ATTACHMENT_KINDS', () => {
  it('lets CCTV be referenced but requires an ethics report to be a file', () => {
    expect(ATTACHMENT_KINDS.cctv.allowsReference).toBe(true)
    expect(ATTACHMENT_KINDS.ethics.allowsReference).toBe(false)
  })

  it('accepts the containers a DVR actually exports to', () => {
    expect(ATTACHMENT_KINDS.cctv.accept).toContain('.dav')
    expect(ATTACHMENT_KINDS.cctv.accept).toContain('video/*')
  })
})
