import { describe, it, expect, vi } from 'vitest'
import {
  FAS_CONTROL_PANEL,
  fasControlPanelIsADeviceType,
  fasQrTokenForCreate,
  fasQrTokenForUpdate,
  isFasControlPanel,
  planFasPanelQrBackfill,
} from './fasQr'

const mint = () => 'minted-token'

describe('FAS control panel QR', () => {
  it('uses the device type the register already offers', () => {
    expect(fasControlPanelIsADeviceType()).toBe(true)
    expect(FAS_CONTROL_PANEL).toBe('Control Panel')
  })

  it('treats only a control panel as scannable', () => {
    expect(isFasControlPanel({ deviceType: 'Control Panel' })).toBe(true)
    expect(isFasControlPanel({ deviceType: '  Control Panel  ' })).toBe(true)
    // A repeater is a panel in the English sense and still not this one.
    expect(isFasControlPanel({ deviceType: 'Repeater Panel' })).toBe(false)
    expect(isFasControlPanel({ deviceType: 'Smoke Detector' })).toBe(false)
    expect(isFasControlPanel({ deviceType: 'Manual Call Point' })).toBe(false)
    expect(isFasControlPanel({})).toBe(false)
  })

  it('mints a token when a control panel is created without one', () => {
    const next = vi.fn(mint)
    expect(fasQrTokenForCreate({ deviceType: 'Control Panel' }, next)).toBe('minted-token')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('keeps a token the panel was created with', () => {
    const next = vi.fn(mint)
    expect(
      fasQrTokenForCreate({ deviceType: 'Control Panel', qrToken: 'already-on-the-wall' }, next),
    ).toBe('already-on-the-wall')
    expect(
      fasQrTokenForCreate(
        { deviceType: 'Control Panel', qrLink: 'https://example.com/qr/printed-label' },
        next,
      ),
    ).toBe('printed-label')
    expect(next).not.toHaveBeenCalled()
  })

  it('does not mint a token for a detector, a call point or a hooter', () => {
    const next = vi.fn(mint)
    for (const deviceType of ['Smoke Detector', 'Heat Detector', 'Manual Call Point', 'Sounder / Hooter', 'Other']) {
      expect(fasQrTokenForCreate({ deviceType, qrToken: 'stray' }, next)).toBe('')
    }
    expect(next).not.toHaveBeenCalled()
  })

  it('mints when an edit saves a control panel that has no code', () => {
    const next = vi.fn(mint)
    expect(fasQrTokenForUpdate('', { deviceType: 'Control Panel' }, next)).toEqual({
      qrToken: 'minted-token',
      minted: true,
    })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does not replace a code already stored, even one create would have refused', () => {
    const next = vi.fn(mint)
    // A space would fail tokenFromQrValue. It is still the code on the sticker.
    expect(fasQrTokenForUpdate('old code', { deviceType: 'Control Panel' }, next)).toEqual({
      qrToken: 'old code',
      minted: false,
    })
    expect(fasQrTokenForUpdate('kept-token', { deviceType: 'Smoke Detector' }, next)).toEqual({
      qrToken: 'kept-token',
      minted: false,
    })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('planFasPanelQrBackfill', () => {
  const rows = [
    { id: 'p1', deviceType: 'Control Panel', qrToken: '' },
    { id: 'p2', deviceType: 'Control Panel', qrToken: 'already-printed' },
    { id: 'p3', deviceType: 'Smoke Detector' },
    { id: 'p4', deviceType: 'Control Panel', qrToken: 'retired', deletedAt: new Date() },
    { id: 'p5', deviceType: 'Control Panel', qrToken: '  odd token  ' },
    { deviceType: 'Control Panel' },
  ]

  it('assigns only live control panels that have no code', () => {
    const plan = planFasPanelQrBackfill(rows)
    expect(plan.assign.map((r) => r.id)).toEqual(['p1'])
    expect(plan.kept.map((r) => r.qrToken)).toEqual(['already-printed', 'odd token'])
  })

  it('is idempotent: a second pass over the written tokens assigns nothing', () => {
    const first = planFasPanelQrBackfill(rows)
    const after = rows.map((row) =>
      first.assign.some((a) => a.id === row.id) ? { ...row, qrToken: 'minted-for-p1' } : row,
    )
    const second = planFasPanelQrBackfill(after)
    expect(second.assign).toEqual([])
    expect(second.kept.map((r) => r.id)).toEqual(['p1', 'p2', 'p5'])
    expect(second.kept.find((r) => r.id === 'p2').qrToken).toBe('already-printed')
    expect(second.kept.find((r) => r.id === 'p5').qrToken).toBe('odd token')
  })

  it('does nothing with an empty register', () => {
    expect(planFasPanelQrBackfill(undefined)).toEqual({ assign: [], kept: [] })
    expect(planFasPanelQrBackfill([])).toEqual({ assign: [], kept: [] })
  })
})
