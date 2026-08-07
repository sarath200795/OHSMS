import { useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, LogOut } from 'lucide-react'
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../shared/firebase'
import { useAuth } from '../../shared/auth/AuthContext'
import { Button, Field, Input } from '../../shared/ui'

/**
 * Full-screen gate shown after first login for provisioned employees
 * (profile.mustChangePassword). They must replace the temporary password
 * before reaching the app.
 *
 * This screen used to re-authenticate with a hardcoded TEMP_PASSWORD constant.
 * Temporary passwords are unique per account now, so there is nothing to
 * re-authenticate with implicitly — the user is asked for the one they were
 * given. That is also the honest flow: proving you know the current password is
 * the point of a re-auth, and a constant proved nothing.
 */
export default function ForcePasswordChange() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 8) return toast.error('Password must be at least 8 characters')
    if (current && pw === current) return toast.error('Choose a different password than the temporary one')
    if (pw !== pw2) return toast.error('Passwords do not match')
    setBusy(true)
    try {
      const u = auth.currentUser
      try {
        await updatePassword(u, pw)
      } catch (err) {
        if (err?.code === 'auth/requires-recent-login') {
          // Session is stale — re-authenticate with the password they just used.
          if (!current) {
            setBusy(false)
            return toast.error('Enter the temporary password you were given')
          }
          await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current))
          await updatePassword(u, pw)
        } else {
          throw err
        }
      }
      await updateDoc(doc(db, 'users', u.uid), { mustChangePassword: false })
      await refreshProfile()
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
          <img src="/wehs.svg" alt="WEHS" className="mb-3 h-16 w-16 rounded-2xl drop-shadow-lg" />
          <h1 className="text-2xl font-bold tracking-tight text-white">Set your password</h1>
          <p className="mt-1 text-sm text-white/70">
            {profile?.name ? `Hi ${profile.name.split(' ')[0]} — ` : ''}replace the temporary password to continue.
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6 sm:p-8">
          <Field label="Temporary password" htmlFor="cpw" hint="The one you were given">
            <Input id="cpw" type="password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor="npw" hint="At least 8 characters">
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
