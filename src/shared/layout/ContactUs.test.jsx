// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ContactUs, { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_TEL } from './ContactUs'

afterEach(cleanup)

describe('ContactUs', () => {
  it('is a telephone link with a readable India number', () => {
    render(<ContactUs />)
    const link = screen.getByRole('link', { name: /Contact us/ })
    expect(link.getAttribute('href')).toBe(CONTACT_PHONE_TEL)
    expect(link.getAttribute('href')).toBe('tel:+917793966625')
    expect(link.textContent).toContain(CONTACT_PHONE_DISPLAY)
    expect(link.textContent).toContain('+91 77939 66625')
    expect(link.textContent).not.toMatch(/whatsapp/i)
  })

  it('is on the portal home and the phone home, outside the module grids', () => {
    const portal = readFileSync('src/pages/portal/Home.jsx', 'utf8')
    const field = readFileSync('src/shared/layout/FieldAppGrid.jsx', 'utf8')
    expect(portal).toContain('<ContactUs')
    expect(field).toContain('<ContactUs')
    // The All Modules tiles centre a fixed square. Contact is a sibling of
    // that grid, not a tile inside it.
    const modulesAt = portal.indexOf('All modules')
    const contactAt = portal.indexOf('<ContactUs')
    expect(contactAt).toBeGreaterThan(-1)
    expect(modulesAt).toBeGreaterThan(contactAt)
    expect(field.indexOf('<ContactUs')).toBeLessThan(field.indexOf('grid-cols-4'))
  })
})
