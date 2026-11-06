import { describe, expect, it } from 'vitest'
import { dataDriver, dataProvider } from './index'

// Locks the wiring in index.js: with no VITE_DATA_DRIVER, the build that CI
// and a stock .env.example produce still selects the Firestore adapter.
// supabase must still throw, and that is covered in resolveDriver.test.js
// without depending on this module's driver. Loading this module evaluates
// the driver chosen for the whole test process.
describe('default data driver', () => {
  it('selects the firestore adapter', () => {
    expect(dataDriver).toBe('firestore')
    expect(typeof dataProvider.get).toBe('function')
    expect(typeof dataProvider.createExclusive).toBe('function')
  })
})
