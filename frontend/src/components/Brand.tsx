import { SHOP } from "../lib/shop";

/** The logo mark: a tire seen head-on. */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#0f1d33" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="#598cfc" strokeWidth="4.5" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="#0f1d33" strokeWidth="1.2" strokeDasharray="2 3.2" />
      <circle cx="20" cy="20" r="3.6" fill="#fff" />
    </svg>
  );
}

export function BrandName({
  light = false,
  compact = false,
  iconOnly = false,
}: {
  light?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={compact ? "h-8 w-8" : "h-9 w-9"} />
      {!iconOnly && (
        <span className="leading-tight">
          <span className={`block font-display text-[15px] font-extrabold ${light ? "text-white" : "text-ink"}`}>
            Mark's Tire Shop
          </span>
          <span className={`block text-[11px] font-semibold uppercase tracking-[0.14em] ${light ? "text-brand-300" : "text-brand-600"}`}>
            &amp; Muffler
          </span>
        </span>
      )}
      <span className="sr-only">{SHOP.name}</span>
    </span>
  );
}
