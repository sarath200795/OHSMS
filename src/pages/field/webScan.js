// The camera lives in shared/mobile so the LOTO tag scanner and this page
// start it the same way. This file remains so a field-page import does not
// fork a second copy.
export {
  canUseBarcodeDetector,
  cameraErrorMessage,
  cameraErrorName,
  cameraUnavailableReason,
  openScanner,
  startBarcodeDetector,
  startHtml5Scanner,
} from '../../shared/mobile/webScan'
