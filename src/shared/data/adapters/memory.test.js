import { defineDataContract } from './contractSuite'
import { createMemoryAdapter } from './memory'

const tick = () => new Promise((r) => setTimeout(r, 0))

defineDataContract(() => createMemoryAdapter(), { tick, nullMatchesMissing: false, isolated: true })
