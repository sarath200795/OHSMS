import { useState } from 'react'
import toast from 'react-hot-toast'
import { Link2Off, Send } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { logAudit } from '../../shared/org/orgData'
import { telegramLinkStatus, startTelegramLink, unlinkTelegram } from '../../shared/functions'
import { Button, Badge } from '../../shared/ui'
import { TELEGRAM_SITE_LOOKUP_USERNAME } from '../admin/whatsappConnectApi.js'

/**
 * Settings → Security → Telegram site lookup.
 *
 * The code is the proof of possession: the app knows who asked, and the
 * webhook knows which private chat sent LINK back. The chat id never comes
 * back to this page. There is no field for typing someone else's id.
 */
export default function TelegramLink() {
  const { user, profile } = useAuth()
  const [status, setStatus] = useState(null)
  const [issued, setIssued] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = async () => {
    try {
      setStatus(await telegramLinkStatus())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  const actor = { uid: user?.uid, name: profile?.name }

  const begin = async () => {
    setBusy(true)
    try {
      const out = await startTelegramLink()
      setIssued(out)
      await logAudit(profile?.orgId, actor, 'tg.link_code', {
        module: 'core',
        target: 'telegram',
        summary: 'Requested a Telegram link code',
      })
    } catch (err) {
      toast.error(err?.message || 'Could not create a code')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    try {
      await unlinkTelegram()
      await logAudit(profile?.orgId, actor, 'tg.unlink', {
        module: 'core',
        target: 'telegram',
        summary: 'Unlinked Telegram site lookup',
      })
      toast.success('Telegram unlinked')
      setIssued(null)
      await refresh()
    } catch (err) {
      toast.error(err?.message || 'Could not unlink')
    } finally {
      setBusy(false)
    }
  }

  if (failed || (status && !status.available && !status.linked)) {
    return (
      <section className="card mt-4 max-w-2xl space-y-2 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-800">
          <Send size={14} /> Telegram site lookup
        </h2>
        <p className="text-xs text-ink-500">
          {failed
            ? 'Could not check Telegram linking right now.'
            : 'Not switched on for this system yet.'}
        </p>
      </section>
    )
  }
  if (!status) {
    return (
      <section className="card mt-4 max-w-2xl space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-800">
          <Send size={14} /> Telegram site lookup
        </h2>
        <p className="max-w-[56ch] text-xs leading-relaxed text-ink-500">
          Link this account to your own Telegram chat. The bot then answers only for sites you can
          already open in the app.
        </p>
        <Button
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            await refresh()
            setBusy(false)
          }}
        >
          Set up or check Telegram
        </Button>
      </section>
    )
  }

  const minutes = issued ? Math.max(1, Math.round((issued.expiresAtMs - Date.now()) / 60000)) : 0

  return (
    <section className="card mt-4 max-w-2xl space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-800">
            <Send size={14} /> Telegram site lookup
          </h2>
          <p className="mt-0.5 max-w-[56ch] text-xs leading-relaxed text-ink-500">
            Send a site code to {TELEGRAM_SITE_LOOKUP_USERNAME} and get that site&apos;s safety
            summary back, for sites you can already open in the app.
          </p>
        </div>
        {status.linked ? <Badge tone="green">Linked</Badge> : <Badge tone="amber">Not linked</Badge>}
      </div>

      {status.linked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
          <span className="text-sm text-ink-800">
            This account has a linked chat
            {status.linkedAt && (
              <span className="text-xs text-ink-500">
                {' '}
                · since {new Date(status.linkedAt).toLocaleDateString()}
              </span>
            )}
          </span>
          <Button variant="ghost" className="px-2 py-1" icon={Link2Off} onClick={unlink} disabled={busy}>
            Unlink
          </Button>
        </div>
      )}

      {issued ? (
        <div className="space-y-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p>
            From your own private chat with {TELEGRAM_SITE_LOOKUP_USERNAME}, send:
          </p>
          <p className="font-mono text-lg tracking-widest">LINK {issued.code}</p>
          <p className="text-xs">
            Single use. Expires in about {minutes} minute{minutes === 1 ? '' : 's'}. The code works
            only for the chat that sends it.
          </p>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={refresh}>
            I&apos;ve sent it — refresh
          </Button>
        </div>
      ) : (
        status.available && (
          <Button onClick={begin} loading={busy}>
            {status.linked ? 'Link a different chat' : 'Link Telegram'}
          </Button>
        )
      )}

      <p className="max-w-[64ch] text-[11px] leading-relaxed text-ink-500">
        What is kept: the chat id of the chat that sent the code (until you unlink) and a log of
        which site you looked up and when. Message text is not stored. Send UNLINK in the chat or
        use Unlink here to withdraw at any time.
      </p>
    </section>
  )
}
