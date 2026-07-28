// ─────────────────────────────────────────────────────────────────────────────
// Shared claymorphism UI kit. One import surface for every module:
//   import { Button, Card, StatCard, Skeleton, Modal, ... } from '@/shared/ui'
//
// Motion follows Emil Kowalski's principles: buttons scale on :active (CSS, in
// index.css), modals fade+scale from 0.96 (center origin), popovers/menus scale
// from their trigger, durations < 300ms, transform/opacity only, reduced-motion
// respected globally in index.css.
// ─────────────────────────────────────────────────────────────────────────────
import { forwardRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Loader2, X, Check } from 'lucide-react'

const cx = (...c) => c.filter(Boolean).join(' ')

// ── Button ──────────────────────────────────────────────────────────────────
const VARIANT = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  soft: 'btn-soft',
  danger: 'btn-danger',
}
export const Button = forwardRef(function Button(
  { as: Tag = 'button', variant = 'primary', loading = false, icon: Icon, children, className, disabled, ...rest },
  ref
) {
  return (
    <Tag
      ref={ref}
      className={cx(VARIANT[variant] || 'btn-primary', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
      {children}
    </Tag>
  )
})

// ── Surfaces ──────────────────────────────────────────────────────────────────
export function Card({ className, children, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={cx('card p-5 sm:p-6', className)} {...rest}>
      {children}
    </Tag>
  )
}

// ── Form controls ─────────────────────────────────────────────────────────────
export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('input', className)} {...rest} />
})
export const Textarea = forwardRef(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx('input resize-y', className)} {...rest} />
})
export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('input appearance-none pr-9', className)} {...rest}>
      {children}
    </select>
  )
})

// ── Multi-select (checkbox list) ──────────────────────────────────────────────
export function MultiSelect({ options = [], value = [], onChange, empty = 'No options', maxHeight = 'max-h-44' }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  if (!options.length) {
    return <div className="clay-inset rounded-2xl p-3 text-sm text-ink-400">{empty}</div>
  }
  return (
    <div className={cx('clay-inset space-y-0.5 overflow-y-auto rounded-2xl p-2', maxHeight)}>
      {options.map((o) => {
        const v = o.value ?? o
        const label = o.label ?? o
        const on = value.includes(v)
        return (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            className={cx(
              'flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition active:scale-[0.99]',
              on ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-clay-100'
            )}
          >
            <span
              className={cx(
                'grid h-4 w-4 shrink-0 place-items-center rounded border',
                on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300'
              )}
            >
              {on && <Check size={12} />}
            </span>
            <span className="flex-1 truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Badge / Chip ──────────────────────────────────────────────────────────────
const TONE = {
  brand: 'bg-brand-50 text-brand-700',
  gray: 'bg-ink-100 text-ink-600',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-sky-50 text-sky-700',
  violet: 'bg-violet-50 text-violet-700',
}
export function Badge({ tone = 'gray', className, children }) {
  return <span className={cx('chip', TONE[tone] || TONE.gray, className)}>{children}</span>
}

// ── Stat card (dashboard KPI tile) ────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, tone = 'brand', hint, className }) {
  const t = TONE[tone] || TONE.brand
  return (
    <div className={cx('card flex items-center gap-4 p-5', className)}>
      {Icon && (
        <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', t)}>
          <Icon size={22} />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-500">{label}</p>
        <p className="text-2xl font-bold tracking-tight text-ink-900">{value}</p>
        {hint && <p className="truncate text-xs text-ink-400">{hint}</p>}
      </div>
    </div>
  )
}

// ── Page header ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, icon: Icon, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700 shadow-clay-sm">
            <Icon size={22} />
          </span>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
          {subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cx('card flex flex-col items-center gap-3 p-10 text-center', className)}>
      {Icon && (
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-clay-100 text-ink-400 shadow-clay-inset">
          <Icon size={26} />
        </span>
      )}
      <div>
        <h3 className="font-semibold text-ink-800">{title}</h3>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Spinner + full-page loader ────────────────────────────────────────────────
// Fast spin — a quicker spinner makes loads feel faster (perceived performance).
export function Spinner({ size = 20, className }) {
  return <Loader2 size={size} className={cx('animate-spin text-brand-600', className)} />
}
export function FullPageLoader({ label = 'Loading…' }) {
  return (
    <div className="grid min-h-screen place-items-center bg-clay-bg">
      <div className="flex flex-col items-center gap-3">
        <Spinner size={30} />
        <p className="text-sm text-ink-500">{label}</p>
      </div>
    </div>
  )
}

// ── Skeleton loaders ──────────────────────────────────────────────────────────
// Content-shaped placeholders (see .skeleton in index.css). Prefer these over
// spinners for section/page loads — better perceived performance, no layout shift.
export function Skeleton({ className }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />
}
export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cx('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
export function SkeletonStat() {
  return (
    <div className="card flex items-center gap-4 p-5">
      <Skeleton className="h-12 w-12 rounded-2xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  )
}
export function SkeletonCard({ className }) {
  return (
    <div className={cx('card space-y-4 p-5', className)}>
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  )
}
export function SkeletonTable({ rows = 6, cols = 4 }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex gap-4 border-b border-ink-100 px-5 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-ink-50 px-5 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cx('h-4 flex-1', c === 0 && 'max-w-[40%]')} />
          ))}
        </div>
      ))}
    </div>
  )
}
export function SkeletonDetail() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/2" />
      <div className="grid gap-4 sm:grid-cols-3">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
      <SkeletonCard />
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Center-origin (per Emil: modals are not anchored to a trigger). Fade+scale
// from 0.96 (never scale(0)); backdrop fades; exit is snappier than enter.
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const reduce = useReducedMotion()
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cx('card relative z-10 w-full p-0', widths[size])}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-ink-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-xl text-ink-400 transition hover:bg-clay-100 hover:text-ink-700 active:scale-95"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-6 py-4">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Standard table pager: "Showing X–Y of N" + Prev / Page x/y / Next. */
export function Pager({ page, pageCount, onPage, total, pageSize, className = '' }) {
  if (pageCount <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className={cx('flex items-center justify-between text-sm', className)}>
      <span className="text-ink-500">Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-1.5">
        <button className="btn-ghost px-3 py-1.5" onClick={() => onPage(page - 1)} disabled={page === 1}>Prev</button>
        <span className="px-2 font-semibold text-ink-700">Page {page} / {pageCount}</span>
        <button className="btn-ghost px-3 py-1.5" onClick={() => onPage(page + 1)} disabled={page === pageCount}>Next</button>
      </div>
    </div>
  )
}

/**
 * Print isolation: when the user prints, only the element with `id` is
 * visible (used by the training certificate and the FERP sheets).
 */
export function PrintIsolate({ id, landscape = false }) {
  return (
    <style>{`@media print {
      body * { visibility: hidden !important; }
      #${id}, #${id} * { visibility: visible !important; }
      #${id} { position: absolute !important; inset: 0 !important; display: block !important; margin: 0 !important; box-shadow: none !important; }
      ${landscape ? '@page { size: A4 landscape; margin: 8mm; }' : ''}
    }`}</style>
  )
}
