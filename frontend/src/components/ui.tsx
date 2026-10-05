import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { ApiClientError } from "../lib/api";

/**
 * Shared primitives.
 *
 * Every screen needs loading, empty, validation, permission-denied and failure
 * states (build guide / 03), so those live here rather than being reinvented.
 */

export function Button({
  variant = "primary",
  size = "md",
  loading,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
}) {
  const styles = {
    primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/50",
    secondary: "bg-white text-ink border border-slate-300 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
    ghost: "text-ink hover:bg-slate-100",
    success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-600/50",
  }[variant];
  const sizes = {
    sm: "px-2.5 py-1.5 text-xs rounded-md",
    md: "px-3.5 py-2 text-sm rounded-lg",
    lg: "px-5 py-3 text-base rounded-xl",
    xl: "px-6 py-4 text-lg rounded-xl",
  }[size];

  return (
    <button
      {...props}
      // Disabling on submit is a convenience; the server still enforces
      // idempotency (build guide / 03).
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${sizes} ${styles} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs font-medium text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${className}`}
    />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${className}`}
    >
      {children}
    </select>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white shadow-card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          {title && <h2 className="text-[15px] font-bold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "warn" | "good";
}) {
  const toneClass = {
    neutral: "text-ink",
    warn: "text-amber-700",
    good: "text-teal-700",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-blue-100 text-blue-800",
  APPROVED: "bg-teal-100 text-teal-800",
  PARTLY_APPROVED: "bg-amber-100 text-amber-800",
  DECLINED: "bg-red-100 text-red-800",
  EXPIRED: "bg-slate-100 text-slate-600",
  SUPERSEDED: "bg-slate-100 text-slate-500",
  SCHEDULED: "bg-slate-100 text-slate-700",
  CHECKED_IN: "bg-blue-100 text-blue-800",
  DIAGNOSING: "bg-indigo-100 text-indigo-800",
  AWAITING_APPROVAL: "bg-amber-100 text-amber-800",
  AWAITING_PARTS: "bg-orange-100 text-orange-800",
  IN_PROGRESS: "bg-teal-100 text-teal-800",
  QUALITY_CHECK: "bg-purple-100 text-purple-800",
  READY: "bg-green-100 text-green-800",
  DELIVERED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-red-100 text-red-800",
  ISSUED: "bg-blue-100 text-blue-800",
  PARTLY_PAID: "bg-amber-100 text-amber-800",
  PAID: "bg-green-100 text-green-800",
  CREDITED: "bg-purple-100 text-purple-800",
  VOID: "bg-slate-100 text-slate-500",
  SUCCEEDED: "bg-green-100 text-green-800",
  PENDING: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  UNKNOWN: "bg-red-100 text-red-800",
  OPEN: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

/** Loading, empty, permission-denied and failure, handled in one place. */
export function DataState({
  loading,
  error,
  empty,
  emptyMessage = "Nothing here yet.",
  emptyAction,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2 py-6" aria-busy="true" aria-live="polite">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
        ))}
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (error) {
    const isDenied = error instanceof ApiClientError && error.isPermissionDenied;
    return (
      <div
        role="alert"
        className={`rounded-md border p-4 text-sm ${
          isDenied
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-red-200 bg-red-50 text-red-900"
        }`}
      >
        <p className="font-medium">
          {isDenied ? "You do not have access to this" : "We could not load this"}
        </p>
        <p className="mt-1">
          {error instanceof Error ? error.message : "An unexpected error occurred."}
        </p>
        {error instanceof ApiClientError && error.requestId && (
          <p className="mt-2 font-mono text-xs opacity-70">Reference {error.requestId}</p>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-8 text-center">
        <p className="text-sm text-slate-500">{emptyMessage}</p>
        {emptyAction && <div className="mt-3">{emptyAction}</div>}
      </div>
    );
  }

  return <>{children}</>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const fields = error instanceof ApiClientError ? error.fields : undefined;

  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-medium">{message}</p>
      {fields && (
        <ul className="mt-1 list-inside list-disc">
          {Object.entries(fields).map(([field, msg]) => (
            <li key={field}>
              <span className="font-medium">{field}</span>: {msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "danger";
  children: ReactNode;
}) {
  const styles = {
    info: "border-slate-200 bg-slate-50 text-slate-700",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
  }[tone];
  return <div className={`rounded-md border p-3 text-sm ${styles}`}>{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full rounded-2xl bg-white shadow-xl ${wide ? "max-w-4xl" : "max-w-lg"}`}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"
          >
            ✕
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            {headers.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
