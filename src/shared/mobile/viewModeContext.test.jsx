// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { VIEW_MODE_KEY } from './viewMode'
import { ViewModeProvider, ViewModeSwitch } from './viewModeContext'
import FieldHome from '../../pages/field/FieldHome'

function setWidth(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function Probe() {
  const { pathname } = useLocation()
  return <p>{pathname}</p>
}

function renderSwitch(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ViewModeProvider>
        <ViewModeSwitch />
        <Probe />
      </ViewModeProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  localStorage.removeItem(VIEW_MODE_KEY)
  setWidth(1280)
})

describe('ViewModeSwitch', () => {
  it('names the other mode, and shows Use automatic only after a choice is stored', () => {
    setWidth(1280)
    localStorage.setItem(VIEW_MODE_KEY, 'mobile')
    renderSwitch('/portal')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to desktop view' }))
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe('desktop')
    expect(screen.getByRole('button', { name: 'Switch to mobile view' })).toBeTruthy()
    expect(screen.getByText('/portal')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Use automatic' }))
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use automatic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Switch to mobile view' })).toBeTruthy()
  })

  it('opens the portal when desktop view is chosen from the phone home', () => {
    setWidth(390)
    localStorage.setItem(VIEW_MODE_KEY, 'mobile')
    renderSwitch('/field')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to desktop view' }))
    expect(screen.getByText('/portal')).toBeTruthy()
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe('desktop')
  })

  it('returns to automatic and leaves /field when this window is a desktop', () => {
    setWidth(1280)
    localStorage.setItem(VIEW_MODE_KEY, 'mobile')
    renderSwitch('/field')

    fireEvent.click(screen.getByRole('button', { name: 'Use automatic' }))
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBeNull()
    expect(screen.getByText('/portal')).toBeTruthy()
  })
})

describe('FieldHome', () => {
  it('steps aside to the portal when this device is in desktop view', () => {
    localStorage.setItem(VIEW_MODE_KEY, 'desktop')
    render(
      <MemoryRouter initialEntries={['/field']}>
        <ViewModeProvider>
          <Routes>
            <Route path="/field" element={<FieldHome />} />
            <Route path="/portal" element={<h1>Portal</h1>} />
          </Routes>
        </ViewModeProvider>
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: 'Portal' })).toBeTruthy()
  })
})
