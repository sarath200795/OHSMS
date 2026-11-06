import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PROVISIONING_FIELDS, validateProvisioningRequest } from './provisioningSchema'

const h = vi.hoisted(() => ({
  findOrgByName: vi.fn(),
  batch: { set: vi.fn(), commit: vi.fn() },
  doc: vi.fn(() => ({ id: 'reqNorthwind1' })),
  getDocs: vi.fn(),
}))

vi.mock('../firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: () => ({ path: 'provisioningRequests' }),
  doc: (...args) => h.doc(...args),
  writeBatch: () => h.batch,
  serverTimestamp: () => ({ __server: true }),
  getDocs: (...args) => h.getDocs(...args),
  query: (...args) => ({ args }),
  orderBy: () => ({}),
  limit: () => ({}),
}))
vi.mock('./orgData', () => ({
  findOrgByName: (...args) => h.findOrgByName(...args),
  orgIndexRef: (name) => ({ index: String(name).trim().toLowerCase() }),
}))

const { fileProvisioningRequest, listProvisioningRequests } = await import('./provisioningRequest')

const bring = {
  orgName: 'Northwind Metals',
  address: 'Pune',
  contactName: 'Asha Rao',
  contactEmail: 'asha@northwind.test',
  handoffContact: 'ops@northwind.test',
  mode: 'bring',
  engine: 'MySQL',
  authMethod: 'oidc',
  authIssuer: 'https://login.northwind.test/realms/staff',
  authClientId: 'ohsms-northwind',
  bucketMode: 'provision',
  bucketName: 'should-be-dropped',
  bucketRegion: 'ap-south-1',
  presignUrl: 'https://files.example/sign',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.doc.mockReturnValue({ id: 'reqNorthwind1' })
  h.batch.commit.mockResolvedValue(undefined)
  h.findOrgByName.mockResolvedValue(null)
})

describe('validateProvisioningRequest', () => {
  it('keeps a brought engine and drops bucket details when WEEHS provisions the bucket', () => {
    const checked = validateProvisioningRequest(bring)
    expect(checked.ok).toBe(true)
    expect(checked.value).toMatchObject({
      status: 'requested',
      engine: 'mysql',
      bucketMode: 'provision',
      bucketName: '',
      bucketRegion: '',
      presignUrl: '',
    })
    expect(checked.value).not.toHaveProperty('createdAt')
    expect(checked.value).not.toHaveProperty('password')
  })

  it('records Postgres for a WEEHS-provisioned mode even if another engine was typed', () => {
    const checked = validateProvisioningRequest({
      ...bring,
      mode: 'company-cloud',
      engine: 'mysql',
    })
    expect(checked.ok).toBe(true)
    expect(checked.value.engine).toBe('postgres')
    expect(checked.value.mode).toBe('company-cloud')
  })

  it('accepts supabase as one engine among others, and does not keep a client id for Supabase Auth', () => {
    const checked = validateProvisioningRequest({
      ...bring,
      engine: 'supabase',
      authMethod: 'supabase',
      authIssuer: 'https://northwind.supabase.co',
      authClientId: 'public-looking-id',
      bucketMode: 'bring',
      bucketName: 'northwind-files',
      bucketRegion: 'ap-south-1',
      presignUrl: '',
    })
    expect(checked.ok).toBe(true)
    expect(checked.value.engine).toBe('supabase')
    expect(checked.value.authClientId).toBe('')
    expect(checked.value.authIssuer).toBe('https://northwind.supabase.co')
    expect(checked.value.bucketName).toBe('northwind-files')
  })

  it('refuses secret fields and secret-shaped values before any write', () => {
    for (const extra of [
      { password: 'hunter2' },
      { DATA_KEY_MASTER: 'abc' },
      { dataKeyMaster: 'abc' },
      { serviceRoleKey: 'abc' },
      { clientSecret: 'abc' },
      { databaseUrl: 'postgres://u:p@db/app' },
      { engine: 'postgres://u:p@db/app' },
      { address: 'BEGIN PRIVATE KEY' },
    ]) {
      const checked = validateProvisioningRequest({ ...bring, ...extra })
      expect(checked.ok).toBe(false)
      expect(checked.errors.form).toMatch(/DATA_KEY_MASTER/)
    }
  })

  it('refuses to mark a request provisioned', () => {
    const checked = validateProvisioningRequest({ ...bring, status: 'provisioned' })
    expect(checked.ok).toBe(false)
    expect(checked.errors.status).toMatch(/requested/)
  })

  it('refuses an issuer that is not a public https URL', () => {
    expect(
      validateProvisioningRequest({ ...bring, authIssuer: 'http://login.example/realms/staff' }).ok
    ).toBe(false)
    expect(
      validateProvisioningRequest({
        ...bring,
        authIssuer: 'https://user:pass@login.example/realms/staff',
      }).ok
    ).toBe(false)
  })

  it('refuses a field the form does not know', () => {
    const checked = validateProvisioningRequest({ ...bring, notes: 'call me' })
    expect(checked.ok).toBe(false)
    expect(checked.errors.form).toMatch(/does not accept/)
  })

  it('matches the fields firestore.rules allows on the request', () => {
    const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8')
    const block = rules.slice(rules.indexOf('match /provisioningRequests/'))
    const listed = block.match(/keys\(\)\.hasOnly\(\[([^\]]+)\]\)/)
    const fields = listed[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1))
    expect(fields).toEqual([...PROVISIONING_FIELDS])
  })
})

describe('fileProvisioningRequest', () => {
  it('writes the request and reserves the name, and does not create a WEEHS organization', async () => {
    const filed = await fileProvisioningRequest(bring)
    expect(filed).toMatchObject({
      id: 'reqNorthwind1',
      orgName: 'Northwind Metals',
      engine: 'mysql',
      mode: 'bring',
    })
    expect(h.batch.set).toHaveBeenCalledTimes(2)
    const [requestRef, request] = h.batch.set.mock.calls[0]
    expect(requestRef).toEqual({ id: 'reqNorthwind1' })
    expect(request.status).toBe('requested')
    expect(request.createdAt).toEqual({ __server: true })
    expect(request).not.toHaveProperty('password')
    expect(request).not.toHaveProperty('dataKeyMaster')
    expect(Object.keys(request).sort()).toEqual([...PROVISIONING_FIELDS].sort())
    expect(h.batch.set.mock.calls[1][1]).toEqual({
      name: 'Northwind Metals',
      stack: 'own',
      requestId: 'reqNorthwind1',
    })
    expect(h.batch.commit).toHaveBeenCalledOnce()
  })

  it('does not write when the name is already reserved or already a WEEHS organization', async () => {
    h.findOrgByName.mockResolvedValueOnce({ stack: 'own', name: 'Northwind Metals', id: null })
    await expect(fileProvisioningRequest(bring)).rejects.toThrow(/reserved/)
    h.findOrgByName.mockResolvedValueOnce({ stack: 'weehs', id: 'org-1', name: 'Northwind Metals' })
    await expect(fileProvisioningRequest(bring)).rejects.toThrow(/WEEHS database/)
    expect(h.batch.set).not.toHaveBeenCalled()
  })

  it('reports a refused write as not filed', async () => {
    h.batch.commit.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'permission-denied' })
    )
    await expect(fileProvisioningRequest(bring)).rejects.toThrow(
      /Nothing was created on the WEEHS database/
    )
  })
})

describe('listProvisioningRequests', () => {
  it('returns the allowlisted columns and drops anything else on the document', async () => {
    h.getDocs.mockResolvedValueOnce({
      size: 1,
      docs: [
        {
          id: 'reqNorthwind1',
          data: () => ({
            orgName: 'Northwind Metals',
            status: 'requested',
            engine: 'mysql',
            password: 'hunter2',
            dataKeyMaster: 'nope',
          }),
        },
      ],
    })
    const listed = await listProvisioningRequests()
    expect(listed.rows).toEqual([
      {
        id: 'reqNorthwind1',
        status: 'requested',
        orgName: 'Northwind Metals',
        address: undefined,
        contactName: undefined,
        contactEmail: undefined,
        handoffContact: undefined,
        mode: undefined,
        engine: 'mysql',
        authMethod: undefined,
        authIssuer: undefined,
        authClientId: undefined,
        bucketMode: undefined,
        bucketName: undefined,
        bucketRegion: undefined,
        presignUrl: undefined,
        createdAt: undefined,
      },
    ])
    expect(JSON.stringify(listed)).not.toMatch(/hunter2|nope/)
  })
})

describe('the own-database screen does not call the WEEHS registration path', () => {
  it('keeps registerOrganization out of the request wizard', () => {
    const wizard = readFileSync(
      new URL('../../pages/auth/OwnStackRequest.jsx', import.meta.url),
      'utf8'
    )
    // Comments name the functions so the next edit does not add them. The
    // check is the code: an import or a call would create the WEEHS tenant.
    const code = wizard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(
      /registerOrganization|createOrganization|createUserWithEmailAndPassword/
    )
    const screen = readFileSync(
      new URL('../../pages/auth/RegisterOrg.jsx', import.meta.url),
      'utf8'
    )
    expect(screen).toMatch(/OwnStackRequest/)
    expect(screen).toMatch(/registerOrganization/)
  })
})
