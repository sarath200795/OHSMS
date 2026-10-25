// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QR_FRAME_INK } from '../../../shared/print/qrFrame'
import { LABELS_PER_PAGE } from '../lib/qrSheetLayout'

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
      location: 'Lobby',
    },
    ...Array.from({ length: 15 }, (_, i) => ({
      id: `e${i + 2}`,
      qrToken: `tok-ext-${i + 2}`,
      serialNo: `FE-${200 + i}`,
      type: 'ABC',
      capacity: '6kg',
      entity: 'Plant',
      centerName: `Depot ${i + 2}`,
      location: `Bay ${i + 2}`,
    })),
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

beforeEach(() => {
  printOpts.length = 0
  location.state = { ids: ['e1'] }
})

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
    // The card frame is a real border in the print stylesheet. A Tailwind
    // ring is a box-shadow, and the stylesheet turns shadows off.
    expect(card.className).not.toMatch(/ring-/)
    expect(printOpts[0].pageStyle).toContain(`border: 0.4mm solid ${QR_FRAME_INK}`)
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
    expect(screen.getByText('Lobby')).toBeTruthy()
    expect(document.querySelectorAll('.qr-sheet-paper')).toHaveLength(1)
  })

  it('lays a full selection out as fifteen labels per A4 sheet', () => {
    location.state = { ids: fleet.extinguishers.map((e) => e.id) }
    render(<QRPrint />)
    const sheets = document.querySelectorAll('.qr-sheet-paper')
    expect(LABELS_PER_PAGE).toBe(15)
    expect(sheets).toHaveLength(2)
    expect(sheets[0].querySelectorAll('.qr-print-card')).toHaveLength(15)
    expect(sheets[1].querySelectorAll('.qr-print-card')).toHaveLength(1)
    expect(printOpts.at(-1).pageStyle).toContain('repeat(5,')
    expect(printOpts.at(-1).pageStyle).toContain('repeat(3,')
    expect(printOpts.at(-1).pageStyle).toContain('margin: 0')
    expect(screen.getByText('Bay 2')).toBeTruthy()
  })
})
