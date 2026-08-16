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

  // Fetch the bytes THROUGH storage.rules, as this signed-in user.
  //
  // getDownloadURL mints a URL carrying a permanent `token` query parameter.
  // That URL is not an authenticated request — it is a bearer credential in a
  // string. It works for anyone who has it, signed in or not, forever, and no
  // rule is ever consulted. Once it lands in a Firestore document it can be
  // copied out by anyone who can read that document and keeps working after
  // they leave the organization.
  //
  // getBlob issues a real authenticated request, so storage.rules decides —
  // which is the whole point of having written them. Returns null rather than
  // throwing; the caller falls back to the stored URL, because a photo that
  // fails to render is a worse outcome than one served the old way.
  async resolve(path) {
    const blob = await this.resolveBlob(path)
    return blob ? URL.createObjectURL(blob) : null
  },

  // The same fetch, stopping one step earlier.
  //
  // resolve() hands back an object URL, which is exactly the wrong shape for an
  // encrypted object: the bytes behind that URL are ciphertext, and a browser
  // asked to render them shows a broken image with no explanation. Anything
  // that may be sealed has to get at the BYTES, decrypt them, and build its own
  // URL from the plaintext — so the two steps are separated here rather than in
  // three callers that each have to remember.
  async resolveBlob(path) {
    const loaded = await loadStorage()
    if (!loaded?.mod.getBlob) return null
    try {
      return await loaded.mod.getBlob(loaded.mod.ref(loaded.storage, path))
    } catch {
      // Denied by rules, gone, or the bucket has no CORS rule for this origin
      // yet (getBlob needs one; <img src> never did). See PRODUCTION.md.
      return null
    }
  },

  async remove(path) {
    const loaded = await loadStorage()
    if (!loaded) return
    await loaded.mod.deleteObject(loaded.mod.ref(loaded.storage, path))
  },
}
