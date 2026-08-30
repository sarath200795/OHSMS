// A static server for previewing the built dashboard. Preview only — the
// shipped artifact is a single self-contained file and needs no server.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = import.meta.dirname
const PORT = Number(process.env.PORT || 5199)
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = path.join(ROOT, rel === '/' ? 'fls-dashboard.html' : rel)
  // Never serve outside the scratchpad, whatever the path traversal says.
  if (!path.resolve(file).startsWith(path.resolve(ROOT))) { res.writeHead(403).end('no'); return }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(buf)
  })
}).listen(PORT, () => console.log(`preview on http://localhost:${PORT}`))
