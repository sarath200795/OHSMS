// One A4 grid for every equipment QR sheet.
//
// The PDF download (FAS panels, AEDs) and the Print QR page (extinguishers,
// AEDs, FAS) used to paginate independently. The PDF card was 62mm tall, so
// three columns only left room for four rows — twelve labels, and the location
// line was the one that fell off the bottom. The print stylesheet set a
// minimum height and let the browser decide the row count, which is how a
// "3-across" sheet came out as four or six rows depending on the font.
//
// Fifteen is three by five. The gutter is the same on the outside of the page
// and between cards, so a cut down the middle of a gap leaves each label the
// border it had on the sheet. The page margin itself is 0: a non-zero @page
// margin is where the browser prints its own header and footer, and those
// overlap the outer labels. The 6mm gutter is padding inside the sheet.
import { QR_FRAME_INK, QR_PRINT_CODE_RULE } from '../../../shared/print/qrFrame'

export const PAGE_W = 210
export const PAGE_H = 297
export const COLS = 3
export const ROWS = 5
export const LABELS_PER_PAGE = COLS * ROWS
export const GUTTER = 6

// Tenths of a millimetre. 52.2 is not exact in binary, and a drift of a
// fraction of a millimetre on the last row is what pushes a card onto a
// blank page. Positions are computed in integers and divided once.
const PAGE_W_T = 2100
const PAGE_H_T = 2970
const GUTTER_T = 60
const INNER_W_T = PAGE_W_T - GUTTER_T * 2
const INNER_H_T = PAGE_H_T - GUTTER_T * 2
const CARD_W_T = (INNER_W_T - GUTTER_T * (COLS - 1)) / COLS
const CARD_H_T = (INNER_H_T - GUTTER_T * (ROWS - 1)) / ROWS

const fromTenths = (t) => t / 10

export const INNER_W = fromTenths(INNER_W_T)
export const INNER_H = fromTenths(INNER_H_T)
export const CARD_W = fromTenths(CARD_W_T)
export const CARD_H = fromTenths(CARD_H_T)

// 28mm keeps the modules above half a millimetre even for a long host (a
// 53-module matrix plus the quiet zone the PNG already carries). Smaller than
// the old 34mm, which is what makes the fifth row and the location line fit;
// still large enough that a phone reads it off the paper.
export const QR_SIZE = 28

// Distances from the top of the card, in millimetres. jsPDF's text y is the
// baseline. Worst case is two title lines plus detail, site and location —
// that last baseline has to land on or above `limit`, or the location is the
// line that gets clipped, which is the bug this grid exists to close.
const HEADER_BASELINE = 3.4
const QR_TOP = 5.0
const TEXT_GAP = 1.6
const TITLE_STEP = 3.3
const TITLE_LINES = 2
const META_STEP = 3.0
const META_LINES = 3
const BOTTOM_PAD = 1.2

export function labelContentBox() {
  const textTop = QR_TOP + QR_SIZE + TEXT_GAP
  const lastBaseline = textTop + TITLE_LINES * TITLE_STEP + (META_LINES - 1) * META_STEP
  return {
    headerBaseline: HEADER_BASELINE,
    qrTop: QR_TOP,
    qrSize: QR_SIZE,
    textTop,
    titleStep: TITLE_STEP,
    titleLines: TITLE_LINES,
    metaStep: META_STEP,
    metaLines: META_LINES,
    lastBaseline,
    limit: CARD_H - BOTTOM_PAD,
  }
}

/** Top-left of label `slot` (0 .. LABELS_PER_PAGE - 1) on the current page. */
export function labelOrigin(slot) {
  const col = slot % COLS
  const row = Math.floor(slot / COLS)
  return {
    col,
    row,
    x: fromTenths(GUTTER_T + col * (CARD_W_T + GUTTER_T)),
    y: fromTenths(GUTTER_T + row * (CARD_H_T + GUTTER_T)),
  }
}

function mm(n) {
  const tenths = Math.round(n * 10)
  const whole = Math.trunc(tenths / 10)
  const frac = Math.abs(tenths % 10)
  return frac ? `${whole}.${frac}mm` : `${whole}mm`
}

/**
 * Styles for the Print QR page. Applied in the document (so the on-screen
 * sheets match the paper) and passed to react-to-print as `pageStyle` (that
 * prop replaces the library default, which is the only reason a print can
 * suppress the browser's header and footer — keep the zero page margin).
 */
export function qrSheetCss() {
  const card = mm(CARD_W)
  const cardH = mm(CARD_H)
  const gutter = mm(GUTTER)
  const qr = mm(QR_SIZE)
  return `
    @page qr-sheet { size: A4 portrait; margin: 0; }
    @page { size: A4 portrait; margin: 0; }
    .qr-sheet-paper:last-child { break-after: auto; page-break-after: auto; }
    .qr-print-card p { overflow-wrap: anywhere; word-break: break-word; max-width: 100%; }
    .qr-print-header {
      flex: none;
      margin: 0;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      line-height: 1.15;
    }
    .qr-print-title, .qr-print-meta { flex: none; width: 100%; margin: 0; overflow: hidden; }
    @media screen {
      .qr-sheet-stack { width: 100%; max-width: 100%; }
      .qr-sheet-paper {
        box-sizing: border-box;
        width: 100%;
        max-width: ${mm(PAGE_W)};
        aspect-ratio: ${PAGE_W} / ${PAGE_H};
        height: auto;
        padding: 2.857%;
        margin: 0 auto 16px;
        background: #fff;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(38, 33, 26, 0.12);
      }
      .qr-sheet-page {
        display: grid !important;
        width: 100% !important;
        height: 100% !important;
        grid-template-columns: repeat(${COLS}, 1fr) !important;
        grid-template-rows: repeat(${ROWS}, 1fr) !important;
        gap: 3.03% !important;
      }
      .qr-print-card {
        box-sizing: border-box;
        width: auto;
        height: 100%;
        min-height: 0;
        padding: 2% 3% 1%;
        border: 0.4mm solid ${QR_FRAME_INK} !important;
        border-radius: 2mm;
        background: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        overflow: hidden;
        text-align: center;
        box-shadow: none !important;
      }
      .qr-print-header { font-size: 9px; }
      .qr-print-code { flex: none; width: 46% !important; height: auto !important; aspect-ratio: 1; margin-top: 2%; ${QR_PRINT_CODE_RULE} }
      .qr-print-title { margin-top: 2%; font-size: 11px; font-weight: 800; line-height: 1.15; max-height: 2.3em; }
      .qr-print-meta { font-size: 10px; line-height: 1.15; max-height: 1.15em; }
    }
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        color-adjust: exact;
      }
      .qr-sheet-paper {
        page: qr-sheet;
        box-sizing: border-box !important;
        width: ${mm(PAGE_W)} !important;
        height: ${mm(PAGE_H)} !important;
        padding: ${gutter} !important;
        margin: 0 !important;
        background: #fff !important;
        overflow: hidden !important;
        box-shadow: none !important;
        break-after: page;
        page-break-after: always;
      }
      .qr-sheet-paper:last-child { break-after: auto; page-break-after: auto; }
      .qr-sheet-page {
        display: grid !important;
        grid-template-columns: repeat(${COLS}, ${card}) !important;
        grid-template-rows: repeat(${ROWS}, ${cardH}) !important;
        column-gap: ${gutter} !important;
        row-gap: ${gutter} !important;
        width: ${mm(INNER_W)} !important;
        height: ${mm(INNER_H)} !important;
      }
      .qr-print-card {
        box-sizing: border-box !important;
        width: ${card} !important;
        height: ${cardH} !important;
        padding: 1.1mm 1.6mm 0.6mm !important;
        border: 0.4mm solid ${QR_FRAME_INK} !important;
        border-radius: 2mm;
        background: #fff !important;
        display: flex !important;
        flex-direction: column;
        align-items: center;
        overflow: hidden !important;
        text-align: center;
        box-shadow: none !important;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .qr-print-header { font-size: 7pt; }
      .qr-print-code {
        flex: none;
        width: ${qr} !important;
        height: ${qr} !important;
        margin-top: 0.6mm;
        ${QR_PRINT_CODE_RULE}
      }
      .qr-print-title {
        margin-top: 1.2mm;
        font-size: 9pt;
        font-weight: 800;
        line-height: 3.3mm;
        max-height: 6.6mm;
      }
      .qr-print-meta { font-size: 7pt; line-height: 3mm; max-height: 3mm; }
    }
  `
}
