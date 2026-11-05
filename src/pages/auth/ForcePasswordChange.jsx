import { useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, LogOut } from 'lucide-react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../shared/firebase'
import { useAuth } from '../../shared/auth/AuthContext'
import { Button, Field, Input } from '../../shared/ui'
import { validatePassword, MIN_PASSWORD_LENGTH } from '../../shared/auth/passwordPolicy'
import { completePasswordChange } from '../../shared/functions'
import BrandMark from '../../shared/branding/BrandMark'

/**
 * Full-screen gate shown after first login for provisioned employees
 * (profile.mustChangePassword). They must replace the temporary password
 * before reaching the app.
 *
 * The flag is not cleared here. A client write of mustChangePassword was the
 * bypass: knowing the temporary password was enough to lift it. completePasswordChange
 * checks that password with Identity Toolkit and sets a different one with the
 * Admin SDK before the flag moves. updateUser revokes the current session, so
 * a success signs in again with the password that was just set.
 *
 * Temporary passwords are unique per account. The user types the one they were
 * given; there is no shared constant to re-authenticate with.
 */

function gateReason(err) {
  return err?.details?.reason || err?.customData?.details?.reason || ''
}

// The org claim is stamped by a trigger on the profile write, a moment after
// the flag clears. Storage reads that claim and nothing else. Same race
// registerOrganization already waits out.
async function awaitOrgClaim(user) {
  for (let i = 0; i < 4; i += 1) {
    try {
      const { claims } = await user.getIdTokenResult(true)
      if (claims?.orgId) return
    } catch {
      // The new session is a moment behind the claim write. Try again.
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 300 * (i + 1)) })
  }
}

export default function ForcePasswordChange() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const email = auth.currentUser?.email || ''
    const pwError = validatePassword(pw, { email, name: profile?.name })
    if (pwError) return toast.error(pwError)
    if (!current) return toast.error('Enter the temporary password you were given')
    if (pw === current) return toast.error('Choose a different password than the temporary one')
    if (pw !== pw2) return toast.error('Passwords do not match')
    setBusy(true)
    try {
      let outcome
      try {
        outcome = await completePasswordChange({ current, password: pw })
      } catch (err) {
        // updateUser succeeded and the flag write did not. The password on the
        // account is the new one; signing in with it is what finishes the clear
        // (the committed marker matches, and the temporary password no longer does).
        if (gateReason(err) !== 'flag-unchanged') throw err
        await signInWithEmailAndPassword(auth, email, pw)
        outcome = await completePasswordChange({ current: pw, password: pw })
      }
      if (outcome?.reason === 'replaced') {
        await signInWithEmailAndPassword(auth, email, pw)
      }
      if (auth.currentUser) await awaitOrgClaim(auth.currentUser)
      await refreshProfile(auth.currentUser?.uid)
      toast.success('Password set — welcome!')
    } catch (err) {
      toast.error(err?.message || 'Could not update the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="aurora grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="mb-3" alt="WEHS" />
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Set your password</h1>
          <p className="mt-1 text-sm text-ink-500">
            {profile?.name ? `Hi ${profile.name.split(' ')[0]} — ` : ''}replace the temporary
            password to continue.
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6 sm:p-8">
          <Field label="Temporary password" htmlFor="cpw" hint="The one you were given">
            <Input
              id="cpw"
              type="password"
              // This screen interrupts sign-in and the user cannot leave it. See
              // the no-autofocus note in eslint.config.js.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="npw" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
            <Input id="npw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="npw2">
            <Input id="npw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} icon={KeyRound} className="w-full">
            Save password &amp; continue
          </Button>
          <button
            type="button"
            onClick={signOut}
            className="mx-auto flex items-center gap-1.5 text-xs font-semibold text-ink-400 transition hover:text-ink-700"
          >
            <LogOut size={13} /> Log out
          </button>
        </form>
      </div>
    </div>
  )
}
