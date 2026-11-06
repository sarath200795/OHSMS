import { describe, expect, it } from 'vitest'
import { PUBLIC_STACK_KEYS } from '../../stack/publicEnv.mjs'
import { STACK_ENV_KEYS, publicStackValue } from './stackPublicEnv'

describe('dedicated host public env', () => {
  it('publishes the same keys the page knows how to read', () => {
    expect(STACK_ENV_KEYS).toEqual(PUBLIC_STACK_KEYS)
  })

  it('uses the host injection and drops anything that is not a public flag', () => {
    globalThis.__OHSMS_STACK__ = {
      VITE_DATA_DRIVER: 'postgres',
      VITE_DATA_GATEWAY: 'https://northwind.example',
      databaseUrl: 'postgres://secret.example/northwind',
    }
    try {
      expect(publicStackValue('VITE_DATA_DRIVER')).toBe('postgres')
      expect(publicStackValue('VITE_DATA_GATEWAY')).toBe('https://northwind.example')
      expect(publicStackValue('databaseUrl')).toBe('')
      expect(publicStackValue('VITE_AUTH_METHOD')).toBe('')
    } finally {
      delete globalThis.__OHSMS_STACK__
    }
  })

  it('selects postgres from the injection without rebuilding the bundle', async () => {
    globalThis.__OHSMS_STACK__ = {
      VITE_DATA_DRIVER: 'postgres',
      VITE_DATA_GATEWAY: 'https://northwind.example',
    }
    try {
      const mod = await import('./data/index.js?dedicated-host=1')
      expect(mod.dataDriver).toBe('postgres')
    } finally {
      delete globalThis.__OHSMS_STACK__
    }
  })
})
