// ─────────────────────────────────────────────────────────────────────────────
// Firebase Storage adapter.
//
// Implements the storage driver contract (see ../index.js):
//   put(path, blob)  -> { url } or null when the backend is unavailable
//   remove(path)     -> void (best-effort)
//
// The SDK is imported dynamically so projects that never upload a file never
// pay for the firebase/storage chunk.
// ─────────────────────────────────────────────────────────────────────────────
import app from '../../firebase'

const USE_EMULATORS = String(import.meta.env.VITE_USE_EMULATORS).trim() === 'true'
const EMU_HOST = (import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1').trim()
const EMU_STORAGE_PORT = Number(import.meta.env.VITE_EMULATOR_STORAGE_PORT) || 9199

let storagePromise = null
function loadStorage() {
  if (!app) return Promise.resolve(null)
  if (!storagePromise) {
    storagePromise = import('firebase/storage')
      .then((mod) => {
        const storage = mod.getStorage(app)
        if (USE_EMULATORS) mod.connectStorageEmulator(storage, EMU_HOST, EMU_STORAGE_PORT)
        return { mod, storage }
      })
      .catch(() => null)
  }
  return storagePromise
}

export default {
  name: 'firebase',

  async put(path, blob) {
    const loaded = await loadStorage()
    if (!loaded) return null
    const ref = loaded.mod.ref(loaded.storage, path)
    await loaded.mod.uploadBytes(ref, blob, { contentType: blob.type || undefined })
    const url = await loaded.mod.getDownloadURL(ref)
    return { url }
  },

  async remove(path) {
    const loaded = await loadStorage()
    if (!loaded) return
    await loaded.mod.deleteObject(loaded.mod.ref(loaded.storage, path))
  },
}
