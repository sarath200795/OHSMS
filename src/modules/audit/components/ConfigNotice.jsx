import { AlertTriangle } from 'lucide-react'

/**
 * Shown when Firebase env vars are missing, so the app explains setup instead
 * of throwing. Pure UI — safe to render without any Firebase connection.
 */
export default function ConfigNotice() {
  return (
    <div className="grid min-h-screen place-items-center bg-auth-panel p-6 text-white">
      <div className="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-400/20 text-amber-300">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-2xl font-extrabold">Firebase isn’t configured yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          This portal needs a Firebase project to handle authentication and data.
          To get it running:
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>
            Copy <code className="rounded bg-black/30 px-1.5 py-0.5">.env.example</code>{' '}
            to <code className="rounded bg-black/30 px-1.5 py-0.5">.env</code>.
          </li>
          <li>
            Fill in your <code className="rounded bg-black/30 px-1.5 py-0.5">VITE_FIREBASE_*</code>{' '}
            values from the Firebase console.
          </li>
          <li>Enable Email/Password auth and Firestore in the console.</li>
          <li>Restart the dev server.</li>
        </ol>
        <p className="mt-4 text-xs text-slate-400">
          See <code className="rounded bg-black/30 px-1.5 py-0.5">README.md</code>{' '}
          for the full walkthrough.
        </p>
      </div>
    </div>
  )
}
