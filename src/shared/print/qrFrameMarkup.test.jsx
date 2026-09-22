// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('qrcode.react', () => ({
  QRCodeCanvas: (props) => <div data-testid="qr-canvas" data-value={props.value} />,
  QRCodeSVG: (props) => (
    <svg
      data-testid="qr-svg"
      data-value={props.value}
      className={props.className}
      style={props.style}
    />
  ),
}))

import PermitPrintable from '../../modules/ptw/components/PermitPrintable'
import PointTagDialog from '../../modules/loto/components/procedures/PointTagDialog'

const permit = {
  status: 'approved',
  permitNo: 'PTW-1042',
  qrToken: 'tok-permit',
  typeOfWork: 'Hot work',
  date: '2026-01-01',
  time: '08:00',
  validFrom: '2026-01-01T08:00:00.000Z',
  validTo: '2026-01-01T18:00:00.000Z',
  jobLocation: 'Bay C',
  issuingDepartment: 'Operations',
  issuedToName: 'A. Rivera',
  jobDescription: 'Weld the guard',
  createdByName: 'B. Cole',
  hazards: [],
  ppe: [],
  precautions: [],
  participants: [],
}

function inkIsDark(style) {
  const border = style.border || ''
  const color = style.borderColor || ''
  return /26211a|rgb\(38,\s*33,\s*26\)/i.test(`${border} ${color}`)
}

describe('QR frames on printed documents', () => {
  it('puts a solid dark stroke and quiet-zone padding around the permit QR', () => {
    const { getByTestId } = render(<PermitPrintable permit={permit} />)
    const frame = getByTestId('qr-canvas').parentElement
    expect(frame.style.borderStyle || frame.style.border).toMatch(/solid/)
    expect(inkIsDark(frame.style)).toBe(true)
    expect(Number.parseFloat(frame.style.paddingTop || frame.style.padding)).toBeGreaterThanOrEqual(
      4
    )
  })

  it('frames the isolation-point tag QR the same way', () => {
    const { getByTestId } = render(
      <PointTagDialog
        procedure={{ id: 'proc-1', title: 'Hydraulic press' }}
        point={{ key: 'p1', pointId: 'E-1', color: '#b45309', textColor: '#ffffff' }}
        onClose={() => {}}
      />
    )
    const frame = getByTestId('qr-svg').parentElement
    expect(frame.style.borderStyle || frame.style.border).toMatch(/solid/)
    expect(inkIsDark(frame.style)).toBe(true)
    expect(Number.parseFloat(frame.style.paddingTop || frame.style.padding)).toBeGreaterThanOrEqual(
      4
    )
  })
})
