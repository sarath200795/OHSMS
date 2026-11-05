// The shell's Firebase session is local persistence: IndexedDB under the
// WebView directory app_webview, which Auto Backup treats as the root domain,
// plus localStorage in that same directory. allowBackup false does not cover
// device-to-device transfer on some Android 12+ manufacturers. These parse the
// manifest and both rule files and check that every domain the platform
// documents is excluded for the OS versions this app can actually run.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStringPromise } from 'xml2js'

const read = (path) => readFileSync(path, 'utf8')

// Domains from the Auto Backup XML reference. root is the private data
// directory and therefore app_webview. The device_* domains are
// device-protected storage, present since API 24, which is this app's minSdk.
const DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
]

const MANIFEST = 'android/app/src/main/AndroidManifest.xml'
const FULL_BACKUP = 'android/app/src/main/res/xml/backup_rules.xml'
const EXTRACTION = 'android/app/src/main/res/xml/data_extraction_rules.xml'

async function parsed(path) {
  return parseStringPromise(read(path), { explicitArray: true })
}

function rules(node) {
  const excludes = (node.exclude || []).map((entry) => ({
    domain: entry.$.domain,
    path: entry.$.path,
  }))
  return { excludes, includes: node.include || [] }
}

function expectWholeDomainExcluded(node) {
  const { excludes, includes } = rules(node)
  expect(includes).toEqual([])
  expect(excludes.map((rule) => rule.domain).sort()).toEqual([...DOMAINS].sort())
  for (const rule of excludes) expect(rule.path).toBe('.')
}

describe('Android backup is off for every version this app can install on', () => {
  it('reads minSdk 24 and a target of 31 or newer from variables.gradle', () => {
    const gradle = read('android/variables.gradle')
    const min = Number(gradle.match(/minSdkVersion\s*=\s*(\d+)/)[1])
    const target = Number(gradle.match(/targetSdkVersion\s*=\s*(\d+)/)[1])
    // Below 23 there is no Auto Backup file. Below 31 there is no
    // dataExtractionRules. The two rule files are split on that line.
    expect(min).toBeGreaterThanOrEqual(24)
    expect(min).toBeLessThan(31)
    expect(target).toBeGreaterThanOrEqual(31)
  })

  it('parses a manifest that refuses backup and replaces a library that disagrees', async () => {
    const manifest = await parsed(MANIFEST)
    const application = manifest.manifest.application[0].$
    expect(application['android:allowBackup']).toBe('false')
    expect(application['android:fullBackupContent']).toBe('@xml/backup_rules')
    expect(application['android:dataExtractionRules']).toBe('@xml/data_extraction_rules')
    const replaced = application['tools:replace'].split(',').map((part) => part.trim())
    expect(replaced).toEqual(
      expect.arrayContaining([
        'android:allowBackup',
        'android:fullBackupContent',
        'android:dataExtractionRules',
      ])
    )
    const permissions = manifest.manifest['uses-permission'].map((entry) => entry.$['android:name'])
    expect(permissions.sort()).toEqual(
      ['android.permission.CAMERA', 'android.permission.INTERNET'].sort()
    )
  })

  it('excludes every domain on Android 7–11 and on both Android 12+ transports', async () => {
    const full = await parsed(FULL_BACKUP)
    expectWholeDomainExcluded(full['full-backup-content'])

    const extraction = await parsed(EXTRACTION)
    const root = extraction['data-extraction-rules']
    // A missing device-transfer section is "transfer everything", which is the
    // manufacturer case allowBackup false does not close.
    expect(root['device-transfer']).toHaveLength(1)
    expect(root['cloud-backup']).toHaveLength(1)
    expectWholeDomainExcluded(root['device-transfer'][0])
    expectWholeDomainExcluded(root['cloud-backup'][0])
    expect(root['cloud-backup'][0].$['disableIfNoEncryptionCapabilities']).toBe('true')
    expect(root['device-transfer'][0].$).toBeUndefined()
  })

  it('does not let the Capacitor libraries turn backup back on', async () => {
    const settings = read('android/capacitor.settings.gradle')
    const dirs = [...settings.matchAll(/projectDir = new File\('([^']+)'\)/g)].map((match) =>
      join('android', match[1])
    )
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const path = join(dir, 'src/main/AndroidManifest.xml')
      expect(existsSync(path), path).toBe(true)
      const library = await parsed(path)
      const application = library.manifest.application?.[0]?.$
      expect(application?.['android:allowBackup'], path).toBeUndefined()
      expect(application?.['android:fullBackupContent'], path).toBeUndefined()
      expect(application?.['android:dataExtractionRules'], path).toBeUndefined()
    }
  })

  it('leaves the application id and the release signing block alone', () => {
    const gradle = read('android/app/build.gradle')
    expect(gradle).toMatch(/applicationId "org\.weehs\.ohsms"/)
    expect(gradle).not.toMatch(/debuggable\s+true/)
    expect(gradle).not.toMatch(/storePassword\s+['"][^'"]+['"]/)
  })
})
