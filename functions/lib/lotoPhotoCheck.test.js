import { describe, expect, it } from 'vitest'
import { LOTO_LOCK_PHOTO_SECRET, checkLockPhoto, judgePhotoCheck } from './lotoPhotoCheck.js'

describe('judgePhotoCheck', () => {
  it('passes only when a lock, a tag and the tag on the lock are all present', () => {
    expect(judgePhotoCheck({
      lock_present: true, tag_present: true, tag_attached_to_lock: true, confidence: 0.9, reason: 'ok',
    }).status).toBe('pass')
    expect(judgePhotoCheck({ lock_present: true, tag_present: true, tag_attached_to_lock: false }).status).toBe('fail')
    expect(judgePhotoCheck({ lock_present: false, tag_present: true, tag_attached_to_lock: true }).status).toBe('fail')
  })
})

describe('checkLockPhoto', () => {
  it('does not call the network when the secret is missing', async () => {
    let called = false
    const out = await checkLockPhoto({
      apiKey: '',
      imageBase64: 'aa',
      fetchImpl: async () => { called = true; return { ok: true } },
    })
    expect(called).toBe(false)
    expect(out.status).toBe('unavailable')
    expect(out.reason).toContain(LOTO_LOCK_PHOTO_SECRET)
  })

  it('sends the image to the model and does not put the key in the result', async () => {
    const seen = []
    const out = await checkLockPhoto({
      apiKey: 'secret-key',
      imageBase64: 'abcd',
      fetchImpl: async (url, init) => {
        seen.push({ url, body: JSON.parse(init.body) })
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"lock_present":true,"tag_present":true,"tag_attached_to_lock":true,"confidence":0.8,"reason":"hung"}' }] } }],
          }),
        }
      },
    })
    expect(out).toMatchObject({ status: 'pass', lock: true, tag: true, attached: true })
    expect(JSON.stringify(out)).not.toContain('secret-key')
    expect(seen[0].url).toContain('key=secret-key')
    expect(seen[0].body.contents[0].parts[1].inline_data.data).toBe('abcd')
  })
})
