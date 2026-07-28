import { PlugZap, Terminal } from 'lucide-react'

export default function SetupNeeded() {
  return (
    <div className="aurora grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/wehs.svg" alt="WEHS" className="mb-3 h-16 w-16 rounded-2xl drop-shadow-lg" />
          <h1 className="text-2xl font-bold tracking-tight text-white">Connect Firebase</h1>
          <p className="mt-1 text-sm text-white/70">One step to start WEHS</p>
        </div>
        <div className="card space-y-4 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 shadow-clay-sm">
              <PlugZap size={22} />
            </span>
            <div>
              <h2 className="font-semibold text-ink-900">No Firebase configuration detected</h2>
              <p className="mt-1 text-sm text-ink-500">
                Copy the example env file and start the local emulators — no cloud project required.
              </p>
            </div>
          </div>
          <div className="clay-inset space-y-2 p-4 font-mono text-sm text-ink-700">
            <p className="flex items-center gap-2">
              <Terminal size={14} className="text-ink-400" /> cp .env.example .env
            </p>
            <p className="flex items-center gap-2">
              <Terminal size={14} className="text-ink-400" /> npm install
            </p>
            <p className="flex items-center gap-2">
              <Terminal size={14} className="text-ink-400" /> npm run dev:full
            </p>
          </div>
          <p className="text-xs text-ink-400">
            The emulator flow works out of the box with the demo project id in{' '}
            <span className="font-semibold">.env.example</span>. To use a real project, set{' '}
            <span className="font-mono">VITE_USE_EMULATORS=false</span> and add your web config.
          </p>
        </div>
      </div>
    </div>
  )
}
