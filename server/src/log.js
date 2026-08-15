// ─────────────────────────────────────────────────────────────────────────────
// Structured logging, shaped for Cloud Run.
//
// Cloud Run's logging agent lifts `severity` and `message` out of a JSON line
// on stdout and turns everything else into queryable fields. A plain string is
// logged at DEFAULT severity, which means a rejected token and a crashed
// process look identical in the console and neither can be alerted on. So
// every line here carries a severity and nothing here ever prints bare text.
//
// WHY THESE FUNCTIONS TAKE A FIELD OBJECT AND NOT A REQUEST. Handed a request,
// the easy thing — and the thing that eventually happens — is to log the whole
// of it, and the whole of it carries the Authorization header. An ID token in
// a log is a credential in a log. The same goes for the request body, which on
// this system carries injuries, illnesses and named people. Callers have to
// name the fields they want, one at a time, on purpose.
// ─────────────────────────────────────────────────────────────────────────────

function write(severity, message, fields) {
  let line
  try {
    line = JSON.stringify({ severity, message, ...fields })
  } catch {
    // A field that cannot be serialised — a cycle, a BigInt — must not take
    // down the request it was describing. Losing the fields is survivable;
    // losing the log line, and with it the reason a request was refused, is
    // how a security decision becomes unauditable.
    line = JSON.stringify({ severity, message, fields: 'unserialisable' })
  }
  if (severity === 'ERROR') console.error(line)
  else console.log(line)
}

export const log = {
  info: (message, fields = {}) => write('INFO', message, fields),
  warn: (message, fields = {}) => write('WARNING', message, fields),
  error: (message, fields = {}) => write('ERROR', message, fields),
}
