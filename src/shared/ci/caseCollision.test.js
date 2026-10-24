import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectFiles, findCaseCollisions } from '../../../scripts/case-collision.mjs'

describe('case-only path collisions', () => {
  it('flags two files whose full paths differ only by case', () => {
    expect(findCaseCollisions(['src/Foo.js', 'src/foo.js'])).toEqual([
      { kind: 'path', paths: ['src/Foo.js', 'src/foo.js'] },
      { kind: 'module', paths: ['src/Foo.js', 'src/foo.js'] },
    ])
  })

  it('flags a parent directory that differs only by case', () => {
    expect(findCaseCollisions(['src/Foo/a.js', 'src/foo/b.js'])).toEqual([
      { kind: 'path', paths: ['src/Foo', 'src/foo'] },
    ])
  })

  it('does not flag the same path listed twice', () => {
    expect(findCaseCollisions(['src/Foo.js', 'src/Foo.js'])).toEqual([])
  })
})

describe('the WhatsApp settings import', () => {
  // The production failure. Extensions differ, so a full-path compare misses
  // it, and '.js' is probed before '.jsx'.
  it('flags WhatsAppConnect.jsx beside whatsappConnect.js', () => {
    expect(
      findCaseCollisions([
        'src/pages/admin/WhatsAppConnect.jsx',
        'src/pages/admin/whatsappConnect.js',
      ])
    ).toEqual([
      {
        kind: 'module',
        paths: ['src/pages/admin/WhatsAppConnect.jsx', 'src/pages/admin/whatsappConnect.js'],
      },
    ])
  })

  it('accepts the renamed helper', () => {
    expect(
      findCaseCollisions([
        'src/pages/admin/WhatsAppConnect.jsx',
        'src/pages/admin/whatsappConnectApi.js',
        'src/pages/admin/WhatsAppConnect.test.jsx',
        'src/pages/admin/whatsappConnectApi.test.js',
      ])
    ).toEqual([])
  })

  it('does not treat a different extension of the same spelling as a case collision', () => {
    expect(findCaseCollisions(['src/foo.js', 'src/foo.jsx'])).toEqual([])
  })

  it('does not treat a test file as the module it tests', () => {
    expect(findCaseCollisions(['src/foo.js', 'src/foo.test.js'])).toEqual([])
  })

  it('does not flag dotenv files that differ by more than case', () => {
    expect(findCaseCollisions(['functions/.env.example', 'functions/.env.staging'])).toEqual([])
  })
})

describe('the working tree', () => {
  it('has no case collision under src/ or functions/', () => {
    expect(findCaseCollisions(collectFiles(['src', 'functions']))).toEqual([])
  })

  it('the lint step runs the guard', () => {
    const yml = readFileSync('.github/workflows/ci.yml', 'utf8')
    const lint = yml.split('- name: Lint')[1].split('- name:')[0]
    expect(lint).toContain('node scripts/case-collision.mjs')
  })
})
