// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QR_FRAME_INK } from '../../../shared/print/qrFrame'

const fleet = {
  extinguishers: [
    {
      id: 'e1',
      qrToken: 'tok-ext',
      serialNo: 'FE-100',
      type: 'ABC',
      capacity: '6kg',
      entity: 'Plant',
      centerName: 'Bay C',
    },
  ],
  aeds: [],
  fas: [],
}

const { printOpts, location } = vi.hoisted(() => ({
  printOpts: [],
  // A fresh object on every useLocation() call makes the effect that copies
  // location.state into selection re-render forever.
  location: { state: { ids: ['e1'] } },
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props) => (
    <svg data-testid="qr-svg" className={props.className} style={props.style} />
  ),
}))
vi.mock('react-router-dom', () => ({ useLocation: () => location }))
vi.mock('react-to-print', () => ({
  useReactToPrint: (opts) => {
    printOpts.push(opts)
    return () => {}
  },
}))
vi.mock('../context/FleetContext', () => ({ useFleet: () => fleet }))

import QRPrint from './QRPrint'

describe('fire QR label print', () => {
  it('strokes the QR itself, outside the quiet zone, and gives the card a real border', () => {
    const { getByTestId } = render(<QRPrint />)
    const qr = getByTestId('qr-svg')
    expect(qr.getAttribute('class')).toContain('qr-print-code')
    expect(qr.style.border).toMatch(/solid/)
    expect(qr.style.border).toMatch(/26211a|rgb\(38,\s*33,\s*26\)/i)
    expect(qr.style.boxSizing).toBe('content-box')
    expect(qr.style.padding).toBe('')

    const card = qr.closest('.qr-print-card')
    expect(card.className).toMatch(/border/)
    expect(card.className).not.toMatch(/ring-/)
    const caption = screen.getAllByText('FE-100').find((el) => el.tagName === 'P')
    expect(caption.className).toMatch(/break-words/)
    expect(caption.className).not.toMatch(/truncate/)

    // The print stylesheet is what react-to-print actually applies. A ring
    // would be stripped by box-shadow: none; the rule has to be a border.
    expect(printOpts[0].pageStyle).toContain(`solid ${QR_FRAME_INK}`)
    expect(printOpts[0].pageStyle).toContain('0.55mm solid #26211a')
    expect(printOpts[0].pageStyle).toContain('content-box')
    expect(printOpts[0].pageStyle).toContain('box-shadow: none')
    expect(printOpts[0].pageStyle).toContain('overflow-wrap: anywhere')
  })
})
