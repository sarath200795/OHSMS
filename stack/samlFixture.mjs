// A local IdP so ACS and the session can be proven without a company directory.
//
// The private key never enters the intake allowlist and is never written into
// the SPA. The certificate and the entry point are the two secrets the handoff
// already accepts. The route that signs assertions exists only when this
// process was given the key. A host that only has the certificate cannot mint
// a response.

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { SignedXml } from 'xml-crypto'
import { escapeHtml } from './handoffPage.mjs'

export function createFixtureIdp(dir = mkdtempSync(join(tmpdir(), 'saml-idp-'))) {
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=ohsms-fixture-idp',
    ],
    { stdio: 'ignore' }
  )
  return {
    key: readFileSync(keyPath, 'utf8'),
    cert: readFileSync(certPath, 'utf8'),
  }
}

export function readAuthnRequest(samlRequest) {
  const raw = Buffer.from(String(samlRequest || ''), 'base64')
  let xml = ''
  try {
    xml = inflateRawSync(raw).toString('utf8')
  } catch {
    xml = raw.toString('utf8')
  }
  return {
    id: xml.match(/\bID="([^"]+)"/)?.[1] || '',
    issuer: xml.match(/<(?:[\w]+:)?Issuer[^>]*>([^<]*)<\/(?:[\w]+:)?Issuer>/)?.[1] || '',
    acs: xml.match(/\bAssertionConsumerServiceURL="([^"]*)"/)?.[1] || '',
  }
}

function attr(value) {
  return escapeHtml(value)
}

export function signSamlResponse({
  key,
  cert,
  audience,
  acsUrl,
  nameId,
  inResponseTo,
  issuer = 'urn:ohsms:fixture-idp',
}) {
  const now = Date.now()
  const instant = new Date(now).toISOString()
  const notBefore = new Date(now - 60 * 1000).toISOString()
  const notAfter = new Date(now + 5 * 60 * 1000).toISOString()
  const assertionId = `_${randomBytes(16).toString('hex')}`
  const responseId = `_${randomBytes(16).toString('hex')}`
  const responseTo = inResponseTo ? ` InResponseTo="${attr(inResponseTo)}"` : ''
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${attr(responseId)}" Version="2.0" IssueInstant="${instant}" Destination="${attr(acsUrl)}"${responseTo}>
  <saml:Issuer>${attr(issuer)}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${attr(assertionId)}" Version="2.0" IssueInstant="${instant}">
    <saml:Issuer>${attr(issuer)}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${attr(nameId)}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${notAfter}" Recipient="${attr(acsUrl)}"${responseTo}/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notAfter}">
      <saml:AudienceRestriction><saml:Audience>${attr(audience)}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${instant}" SessionIndex="${attr(assertionId)}">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
  </saml:Assertion>
</samlp:Response>`
  const sig = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  })
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    uri: `#${assertionId}`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  })
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  })
  return Buffer.from(sig.getSignedXml()).toString('base64')
}

export function renderFixtureLogin({ action, samlRequest, relayState }) {
  return `<!doctype html><html lang="en"><body><form method="post" action="${attr(action)}"><input type="hidden" name="SAMLRequest" value="${attr(samlRequest)}"><input type="hidden" name="RelayState" value="${attr(relayState)}"><label>Work email <input name="email" type="email" autocomplete="username" required></label><button type="submit">Continue</button></form></body></html>`
}

export function renderFixturePost({ acsUrl, samlResponse, relayState }) {
  return `<!doctype html><html lang="en"><body><form method="post" action="${attr(acsUrl)}"><input type="hidden" name="SAMLResponse" value="${attr(samlResponse)}"><input type="hidden" name="RelayState" value="${attr(relayState)}"><button type="submit">Continue</button></form><script src="/fixture/saml/continue.js"></script></body></html>`
}

export const FIXTURE_CONTINUE_JS = 'document.forms[0]&&document.forms[0].submit()\n'
