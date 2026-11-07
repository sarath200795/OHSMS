// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { error: () => {}, success: () => {} } }))

const LOCAL = {
  VITE_CONTROL_PLANE: 'local',
  VITE_DATA_DRIVER: 'postgres',
  VITE_DATA_GATEWAY: 'http://127.0.0.1:8787',
  VITE_STORAGE_DRIVER: 's3',
  VITE_AUTH_METHOD: 'saml',
  VITE_AUTH_ISSUER: 'http://127.0.0.1:8080/realms/ohsms',
  VITE_AUTH_CLIENT_ID: 'ohsms',
  VITE_S3_PRESIGN_ENDPOINT: 'http://127.0.0.1:8787/presign',
}

const HTTPS_ISSUER = /issuer URL has to be an https address/
const HTTPS_PRESIGN = /presign endpoint has to be an https address/

async function renderForm() {
  vi.resetModules()
  const { default: OwnStackRequest } = await import('./OwnStackRequest.jsx')
  return render(
    <MemoryRouter>
      <OwnStackRequest />
    </MemoryRouter>
  )
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText('Organization name'), {
    target: { value: 'Test Org' },
  })
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } })
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'asha@local.test' } })
}

afterEach(() => {
  cleanup()
  delete globalThis.__OHSMS_STACK__
  vi.unstubAllGlobals()
})

describe('own-stack registration on the local host', () => {
  it('files the injected loopback issuer and presign', async () => {
    globalThis.__OHSMS_STACK__ = LOCAL
    const calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, opts) => {
        calls.push({ url: String(url), body: opts.body })
        return {
          ok: true,
          json: async () => ({
            ok: true,
            status: 'live',
            dedicatedUrl: 'http://127.0.0.1:8787',
            requestId: 'reqLocalHost1',
          }),
        }
      })
    )
    await renderForm()
    expect(screen.getByLabelText('Issuer URL').value).toBe('http://127.0.0.1:8080/realms/ohsms')
    expect(screen.getByLabelText('Presign endpoint URL').value).toBe(
      'http://127.0.0.1:8787/presign'
    )
    fillIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'File provisioning request' }))
    expect(await screen.findByText('Request filed')).toBeTruthy()
    expect(screen.queryByText(HTTPS_ISSUER)).toBeNull()
    expect(screen.queryByText(HTTPS_PRESIGN)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:8787/requests')
    const body = JSON.parse(calls[0].body)
    expect(body.authIssuer).toBe('http://127.0.0.1:8080/realms/ohsms')
    expect(body.presignUrl).toBe('http://127.0.0.1:8787/presign')
    expect(body.contactEmail).toBe('asha@local.test')
    expect(calls[0].body).not.toMatch(/postgres:\/\//)
    expect(calls[0].body).not.toMatch(/password/i)
  })

  it('still refuses a non-loopback issuer when local mode is on', async () => {
    globalThis.__OHSMS_STACK__ = LOCAL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await renderForm()
    fireEvent.change(screen.getByLabelText('Issuer URL'), {
      target: { value: 'http://169.254.169.254/latest/meta-data' },
    })
    fillIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'File provisioning request' }))
    expect(await screen.findByText(HTTPS_ISSUER)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses the same loopback URLs when the page is not the local control plane', async () => {
    delete globalThis.__OHSMS_STACK__
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await renderForm()
    fillIdentity()
    fireEvent.change(screen.getByLabelText('Hosting'), { target: { value: 'bring' } })
    fireEvent.change(screen.getByLabelText('Database engine'), { target: { value: 'postgres' } })
    fireEvent.change(screen.getByLabelText('Sign-in'), { target: { value: 'saml' } })
    fireEvent.change(screen.getByLabelText('Issuer URL'), {
      target: { value: 'http://127.0.0.1:8080/realms/ohsms' },
    })
    fireEvent.change(screen.getByLabelText('Client id'), { target: { value: 'ohsms' } })
    fireEvent.change(screen.getByLabelText('File store'), { target: { value: 'bring' } })
    fireEvent.change(screen.getByLabelText('Bucket name'), { target: { value: 'ohsms' } })
    fireEvent.change(screen.getByLabelText('Bucket region'), { target: { value: 'us-east-1' } })
    fireEvent.change(screen.getByLabelText('Presign endpoint URL'), {
      target: { value: 'http://127.0.0.1:8787/presign' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'File provisioning request' }))
    expect(await screen.findByText(HTTPS_ISSUER)).toBeTruthy()
    expect(screen.getByText(HTTPS_PRESIGN)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
