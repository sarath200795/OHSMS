import { safeSrc } from '../../../shared/safeUrl'
import { useFileUrl } from '../../../shared/storage/useFileUrl'
// Course card thumbnail — uploaded image when set, otherwise category art
// (kraft-toned gradient + icon) so every course reads well in the grid.
const ART = {
  'Fire Safety': ['🔥', '#dd5a41'],
  'First Aid': ['⛑️', '#e8877c'],
  'Work at Height': ['🪜', '#e8a33d'],
  'Electrical Safety': ['⚡', '#d9a441'],
  LOTO: ['🔒', '#7189a0'],
  'Chemical Handling': ['🧪', '#8fbc74'],
  'Confined Space': ['🛢️', '#a98e6b'],
  'Emergency Response': ['🚨', '#c94f43'],
  'Manual Handling': ['📦', '#b29470'],
  PPE: ['🦺', '#e8a33d'],
  Induction: ['🎓', '#7fc4bb'],
  Statutory: ['📜', '#a98e6b'],
  Refresher: ['🔁', '#7fc4bb'],
  Other: ['📘', '#8ba7bd'],
}

export default function CourseThumb({ course, className = '' }) {
  // Resolved by PATH, not by the stored url: uploads no longer mint a
  // permanent download URL (audit finding M-5), so thumbnailPath is what a new
  // course has. The hook falls back to the stored url for courses uploaded
  // before the change, so nothing that renders today stops rendering.
  //
  // Called unconditionally, above the early return the category art used to
  // sit behind: a hook after a conditional return is the rules-of-hooks
  // violation that makes the art and the photo swap places on re-render.
  const { src } = useFileUrl({ url: course?.thumbnail, path: course?.thumbnailPath })
  if (src) {
    return <img src={safeSrc(src)} alt="" className={`aspect-video w-full rounded-xl object-cover ${className}`} />
  }
  const [emoji, color] = ART[course?.category] || ART.Other
  return (
    <div
      className={`grid aspect-video w-full place-items-center rounded-xl ${className}`}
      style={{ background: `linear-gradient(135deg, ${color}2e, ${color}73)` }}
    >
      <span className="text-4xl drop-shadow-sm">{emoji}</span>
    </div>
  )
}
