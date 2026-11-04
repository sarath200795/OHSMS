import { alertCopy } from '../utils/permitCompliance'

/** A short tone. No-ops where the browser has no audio. */
export function playPermitAlert() {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctx) return
  try {
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.05
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  } catch {
    // Autoplay policies refuse a tone until a gesture. The banner still shows.
  }
}

export function desktopPermitAlert(stats) {
  const body = alertCopy(stats)
  if (!body || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification('Permit alert', { body })
  } catch {
    // A denied or unsupported notification is not a failed permit.
  }
}
