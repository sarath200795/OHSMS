// Splice data.json into the page template.
//
// The template stays readable — a placeholder where a megabyte and a half of
// JSON goes — and the published file is generated. Editing the generated file
// by hand would be lost on the next refresh, which is why it is not the thing
// anyone opens.
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8')
const data = fs.readFileSync(path.join(here, 'data.json'), 'utf8')

const TOKEN = '/*__DATA__*/'
if (!tpl.includes(TOKEN)) throw new Error(`template.html has no ${TOKEN} placeholder`)

// </script> inside the JSON would close the host <script type="application/json">
// early and drop the rest of the page. The escape survives JSON.parse because
// "<\/script>" and "</script>" are the same string to a JSON reader.
const safe = data.replace(/<\//g, '<\\/')

const out = path.join(here, 'fls-dashboard.html')
fs.writeFileSync(out, tpl.replace(TOKEN, safe))
console.log(`fls-dashboard.html  ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`)
