// A mailbox this process will hand to the transport.
//
// The address parser has treated a comma, a semicolon, a quote, a parenthesis
// and an angle bracket as syntax and read the rest of the string as another
// recipient. Those characters are not part of an address this app stores.
// Plus-addressing and dots stay. One @, a dot in the domain, no whitespace.
const MAILBOX_RE = /^[^\s@,;<>()[\]"'\\:]+@[^\s@,;<>()[\]"'\\:]+\.[^\s@,;<>()[\]"'\\:]+$/

export function mailboxAddress(value) {
  const email = typeof value === 'string' ? value.trim() : ''
  return MAILBOX_RE.test(email) ? email : ''
}
