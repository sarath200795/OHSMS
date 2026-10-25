/**
 * The "this is scanning" layer. It sits on the preview box, which already has
 * a size, so it shows during the permission prompt and while the stream is
 * starting — the stretch where the video element itself may still be black.
 */
export default function ScanFrame({ status }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-scan-frame="">
      <div
        aria-hidden="true"
        className="qr-scan-frame absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2 border-white"
      />
      {status ? (
        <p
          role="status"
          className="absolute inset-x-3 bottom-3 rounded-full bg-black/80 px-3 py-2 text-center text-sm font-semibold text-white"
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}
