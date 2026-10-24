import { useEffect, useState } from 'react'
import { isNativePlatform } from '../../shared/mobile/native'
import { loadPublicStoreConfig, resolveStoreLinks } from '../../shared/mobile/storeLinks'

// Official artwork, unmodified. Google's PNG already includes its clear space
// and is shown at 60px tall (155px wide), which is the size that keeps the
// words in that file legible. Apple's black "Download on the App Store" lockup
// is the 40px-tall US-UK badge, the size the file is drawn at, on this light
// page. The gap between them is at least a quarter of that 40px.
//
// The files are not recoloured or faded. An unpublished listing is "Coming
// soon" and is not a link; the artwork stays the one the stores publish.

const BADGES = [
  {
    key: 'play',
    src: '/badges/google-play-badge.png',
    alt: 'Get it on Google Play',
    width: 155,
    height: 60,
    className: 'h-[60px] w-auto',
  },
  {
    key: 'appStore',
    src: '/badges/app-store-badge.svg',
    alt: 'Download on the App Store',
    width: 120,
    height: 40,
    className: 'h-10 w-auto',
  },
]

function BadgeArt({ badge, decorative }) {
  return (
    <img
      src={badge.src}
      alt={decorative ? '' : badge.alt}
      width={badge.width}
      height={badge.height}
      draggable="false"
      className={badge.className}
    />
  )
}

export default function StoreBadges({ native, links, load = loadPublicStoreConfig }) {
  const hidden = native ?? isNativePlatform()
  const [resolved, setResolved] = useState(() =>
    links ? resolveStoreLinks({ env: envFrom(links) }) : resolveStoreLinks({ env: import.meta.env })
  )

  useEffect(() => {
    if (hidden || links) return undefined
    const fromEnv = resolveStoreLinks({ env: import.meta.env })
    if (fromEnv.play && fromEnv.appStore) return undefined
    let cancel = false
    load().then((config) => {
      if (!cancel) setResolved(resolveStoreLinks({ env: import.meta.env, config }))
    })
    return () => {
      cancel = true
    }
  }, [hidden, links, load])

  if (hidden) return null

  return (
    <ul
      className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-3"
      aria-label="Get the app"
    >
      {BADGES.map((badge) => {
        const href = resolved[badge.key]
        return (
          <li key={badge.key} className="flex justify-center">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
              >
                <BadgeArt badge={badge} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <div
                role="group"
                aria-disabled="true"
                aria-label={`${badge.alt}. Coming soon.`}
                className="inline-flex flex-col items-center gap-1"
              >
                <BadgeArt badge={badge} decorative />
                <span className="text-[11px] font-semibold text-ink-500">Coming soon</span>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function envFrom(links) {
  return {
    VITE_PLAY_STORE_URL: links.play || '',
    VITE_APP_STORE_URL: links.appStore || '',
  }
}
