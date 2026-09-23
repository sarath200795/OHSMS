import { describe, it, expect } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  decodeDataUrl,
  loadReportAttachments,
  permitObjectPath,
  prepareAttachments,
  reportObjectPath,
  reportPdfName,
} from './mailAttachments.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function pdf(marker = 'marker') {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n`)
}

describe('reportPdfName', () => {
  it('uses a readable reference and refuses a sealed one', () => {
    expect(reportPdfName('Mock-Drill-Report', 'DR-1')).toBe('Mock-Drill-Report-DR-1.pdf')
    expect(reportPdfName('Permit-to-Work', SEALED)).toBe('Permit-to-Work.pdf')
    expect(reportPdfName('Permit-to-Work', SEALED)).not.toContain('enc')
  })

  it('strips a newline so the filename cannot split a MIME header', () => {
    expect(reportPdfName('Incident-Report', 'IRA\r\nBcc: x')).not.toMatch(/[\r\n]/)
  })
})

describe('reportObjectPath', () => {
  const ok = 'orgs/orgA/mailed-reports/ab12cd34-Mock-Drill-Report.pdf'

  it('accepts this org mailed-reports prefix only', () => {
    expect(reportObjectPath('orgA', ok)).toBe(ok)
    expect(reportObjectPath('orgA', 'orgs/orgB/mailed-reports/ab-secret.pdf')).toBe('')
    expect(reportObjectPath('orgA', 'orgs/orgA/permit-documents/ab-method.pdf')).toBe('')
    expect(reportObjectPath('orgA', 'orgs/orgA/medical-records/ab-letter.pdf')).toBe('')
    expect(reportObjectPath('orgA', 'orgs/orgA/mailed-reports/../orgB/secret.pdf')).toBe('')
    expect(reportObjectPath('orgA', 'orgs/orgA/mailed-reports/nested/x.pdf')).toBe('')
    expect(reportObjectPath('orgA', 'orgs/orgA/mailed-reports/ab-file.pdf.enc')).toBe('')
    expect(reportObjectPath('orgA', 'https://storage.example/orgs/orgA/mailed-reports/a.pdf')).toBe(
      ''
    )
    expect(reportObjectPath('orgA', SEALED)).toBe('')
  })
})

describe('permitObjectPath', () => {
  it('accepts this org permit-documents prefix only', () => {
    expect(permitObjectPath('orgA', 'orgs/orgA/permit-documents/ab-method.pdf')).toBe(
      'orgs/orgA/permit-documents/ab-method.pdf'
    )
  })

  it('refuses another org, another kind, a traversal, and a sealed object', () => {
    expect(permitObjectPath('orgA', 'orgs/orgB/permit-documents/ab-secret.pdf')).toBe('')
    expect(permitObjectPath('orgA', 'orgs/orgA/incident-photos/ab-photo.jpg')).toBe('')
    expect(permitObjectPath('orgA', 'orgs/orgA/permit-documents/../orgB/secret.pdf')).toBe('')
    expect(permitObjectPath('orgA', 'orgs/orgA/permit-documents/nested/x.pdf')).toBe('')
    expect(permitObjectPath('orgA', 'orgs/orgA/permit-documents/ab-file.pdf.enc')).toBe('')
    expect(
      permitObjectPath('orgA', 'https://storage.example/orgs/orgA/permit-documents/a.pdf')
    ).toBe('')
  })
})

describe('prepareAttachments', () => {
  it('keeps a PDF and drops a sealed buffer, an HTML file, and an oversize part', () => {
    const ok = pdf('kept')
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)
    big.write('%PDF-1.4')
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    const { accepted, skipped } = prepareAttachments([
      { filename: 'report.pdf', content: ok },
      { filename: 'secret.pdf', content: Buffer.from(SEALED) },
      { filename: 'page.pdf', content: html },
      { filename: 'huge.pdf', content: big },
      { filename: `${SEALED}.pdf`, content: pdf('named') },
    ])
    expect(accepted.map((file) => file.filename)).toEqual(['report.pdf', 'attachment.pdf'])
    expect(accepted[1].filename).not.toContain('enc')
    expect(skipped.map((skip) => skip.reason)).toEqual(['sealed', 'type', 'size'])
  })

  it('does not forward a path or a URL even when the bytes are fine', () => {
    const { accepted } = prepareAttachments([
      {
        filename: 'a.pdf',
        content: pdf('a'),
        path: '/etc/passwd',
        href: 'https://evil.example/a.pdf',
      },
    ])
    expect(accepted[0]).toEqual({
      filename: 'a.pdf',
      content: expect.any(Buffer),
      contentType: 'application/pdf',
    })
    expect(accepted[0].path).toBeUndefined()
    expect(accepted[0].href).toBeUndefined()
  })
})

describe('decodeDataUrl', () => {
  it('decodes a base64 PDF and refuses an envelope', () => {
    const bytes = pdf('inline')
    const decoded = decodeDataUrl(`data:application/pdf;base64,${bytes.toString('base64')}`)
    expect(decoded.content.equals(bytes)).toBe(true)
    expect(decodeDataUrl(SEALED)).toBeNull()
  })
})

describe('loadReportAttachments', () => {
  it('returns nothing when building throws, instead of throwing into the send', async () => {
    const errors = []
    const files = await loadReportAttachments(
      () => {
        throw new Error('generator blew up')
      },
      { info() {}, error: (_msg, extra) => errors.push(extra) },
      { docId: 'd1' }
    )
    expect(files).toEqual([])
    expect(errors[0]).toMatchObject({ docId: 'd1', reason: 'build-failed' })
  })
})
