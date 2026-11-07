// A company SAML identity provider small enough to read in one sitting.
//
// The dedicated host is only ever the service provider (stack/saml.mjs). To
// prove it accepts a real signed response, and refuses a replayed, unsolicited
// or foreign-signed one, something has to play the company's IdP. This does,
// for the unit suite and for the recorded walkthrough. It signs both the
// Response and the Assertion, because node-saml requires both by default, and
// answers the AuthnRequest id it was given, because the host refuses anything
// else. The key is generated per run and never leaves the temp directory.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { SignedXml } from 'xml-crypto'

const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

/** A throwaway self-signed IdP key pair. */
export function makeIdpKeys(cn = 'test-idp') {
  const dir = mkdtempSync(join(tmpdir(), 'saml-idp-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-nodes',
      '-subj',
      `/CN=${cn}`,
    ],
    { stdio: 'ignore' }
  )
  const out = { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') }
  // The private key is throwaway, but it is still a private key: do not leave
  // one on disk per run.
  rmSync(dir, { recursive: true, force: true })
  return out
}

/** The fields of a redirect-binding AuthnRequest the IdP needs to answer it. */
export function readAuthnRequest(samlRequest) {
  const xml = inflateRawSync(Buffer.from(String(samlRequest), 'base64')).toString('utf8')
  const attr = (name) => xml.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] || ''
  const issuer = xml.match(/<(?:saml2?:)?Issuer[^>]*>([^<]*)</)?.[1] || ''
  return { id: attr('ID'), acs: attr('AssertionConsumerServiceURL'), issuer }
}

function escape(value) {
  return String(value).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
}

function sign(xml, { key, cert }, element, after) {
  const sig = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  })
  sig.addReference({
    xpath: `//*[local-name(.)='${element}']`,
    transforms: [ENVELOPED, EXC_C14N],
    digestAlgorithm: SHA256,
  })
  sig.computeSignature(xml, { location: { reference: after, action: 'after' } })
  return sig.getSignedXml()
}

/**
 * A base64 SAMLResponse answering `request`, signed by `keys`.
 * @param {{ keys: {key:string, cert:string}, request: {id:string, acs:string, issuer:string},
 *           idpEntityId: string, email: string, name?: string }} input
 */
export function signedResponse({ keys, request, idpEntityId, email, name = '' }) {
  const now = new Date()
  const iso = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString()
  const id = (p) => `_${p}${randomBytes(12).toString('hex')}`
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id('a')}" Version="2.0" IssueInstant="${iso(0)}"><saml:Issuer>${escape(idpEntityId)}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escape(email)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${escape(request.id)}" NotOnOrAfter="${iso(300000)}" Recipient="${escape(request.acs)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(-60000)}" NotOnOrAfter="${iso(300000)}"><saml:AudienceRestriction><saml:Audience>${escape(request.issuer)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="${id('s')}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${escape(email)}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>${escape(name || email)}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id('r')}" Version="2.0" IssueInstant="${iso(0)}" Destination="${escape(request.acs)}" InResponseTo="${escape(request.id)}"><saml:Issuer>${escape(idpEntityId)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`
  const assertionSigned = sign(
    response,
    keys,
    'Assertion',
    "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']"
  )
  const signed = sign(
    assertionSigned,
    keys,
    'Response',
    "/*[local-name(.)='Response']/*[local-name(.)='Issuer']"
  )
  return Buffer.from(signed, 'utf8').toString('base64')
}
