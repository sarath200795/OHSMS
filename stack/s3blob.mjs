// S3-compatible blob store. MinIO is the self-hosted bucket.
//
// The dedicated host used to keep bytes in a Map. A restart forgot every
// file, and a presign URL that pointed at MinIO was never called. This
// speaks the same has/get/set/delete shape, over HTTP, with SigV4. The
// access key stays in the process. The browser still only sees /presign
// and /blob.

import { createHash, createHmac } from 'node:crypto'

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest()
}

function signingKey(secret, date, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request')
}

function amzDate(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export function s3Blobs({
  endpoint,
  bucket,
  accessKeyId,
  secretAccessKey,
  region = 'us-east-1',
  now = () => new Date(),
  fetchImpl = fetch,
}) {
  const base = new URL(endpoint)

  async function call(method, key, body, contentType) {
    const stamp = amzDate(now())
    const day = stamp.slice(0, 8)
    const payload = body ? Buffer.from(body) : Buffer.alloc(0)
    const payloadHash = sha256(payload)
    const encoded = key ? key.split('/').map(encodeURIComponent).join('/') : ''
    const canonicalUri = encoded ? `/${bucket}/${encoded}` : `/${bucket}`
    const headers = {
      host: base.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
    }
    const names = Object.keys(headers).sort()
    const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('')
    const signedHeaders = names.join(';')
    const canonical = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join(
      '\n'
    )
    const scope = `${day}/${region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')
    const signature = createHmac('sha256', signingKey(secretAccessKey, day, region))
      .update(toSign)
      .digest('hex')
    const res = await fetchImpl(`${base.origin}${canonicalUri}`, {
      method,
      headers: {
        ...headers,
        ...(contentType ? { 'content-type': contentType } : {}),
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : payload,
    })
    return res
  }

  return {
    async ensureBucket() {
      const res = await call('PUT', '')
      if (res.status === 200 || res.status === 409) return
      throw new Error(`bucket was not created (${res.status})`)
    },
    async has(path) {
      const res = await call('HEAD', path)
      if (res.status === 404) return false
      return res.ok
    },
    async get(path) {
      const res = await call('GET', path)
      if (res.status === 404) return undefined
      if (!res.ok) throw new Error(`object read failed (${res.status})`)
      const body = Buffer.from(await res.arrayBuffer())
      return {
        body,
        contentType: res.headers.get('content-type') || 'application/octet-stream',
        size: body.length,
      }
    },
    async set(path, value) {
      const res = await call('PUT', path, value.body, value.contentType)
      if (!res.ok) throw new Error(`object write failed (${res.status})`)
    },
    async delete(path) {
      const res = await call('DELETE', path)
      if (res.status === 404 || res.ok) return
      throw new Error(`object delete failed (${res.status})`)
    },
  }
}
