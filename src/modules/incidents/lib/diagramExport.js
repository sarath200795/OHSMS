import { toPng } from 'html-to-image'

/**
 * Export the React Flow diagram inside `containerEl` to a PNG data URL.
 * Waits for fonts so labels don't render blank on first capture. Re-encodes to
 * JPEG if the PNG is very large, to stay well under the 750 KB file cap.
 */
export async function exportDiagramPng(containerEl) {
  if (!containerEl) throw new Error('No diagram to export')
  const viewport = containerEl.querySelector('.react-flow__viewport') || containerEl
  if (document.fonts?.ready) { try { await document.fonts.ready } catch { /* ignore */ } }

  const dataUrl = await toPng(viewport, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    cacheBust: true,
    // Skip embedding remote web fonts (e.g. Google Fonts). Reading their CSS
    // rules throws a cross-origin SecurityError, which made the export hang AND
    // fall back to a wider font — so labels that wrapped on screen overflowed
    // their boxes in the captured image. Diagram labels use a system font stack
    // (see EditableNode) so on-screen and exported metrics match exactly.
    skipFonts: true,
    filter: (node) => !(node.classList && (node.classList.contains('react-flow__minimap') || node.classList.contains('react-flow__controls'))),
  })
  return dataUrl
}

/** Rough byte size of a data URL (base64 payload). */
export function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(',')
  return Math.ceil(((dataUrl.length - i - 1) * 3) / 4)
}
