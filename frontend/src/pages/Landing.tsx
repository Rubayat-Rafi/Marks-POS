import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { money } from "../lib/format";
import { SERVICES, SHOP, SHOP_ADDRESS_LINE } from "../lib/shop";
import { BrandName } from "../components/Brand";
import { Icon } from "../components/Icon";

/**
 * The public homepage. Two jobs above everything else: book a service, and
 * check an estimate. Staff get a clear way in at the top.
 */
export function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-white text-ink">
      <TopBar signedIn={Boolean(user)} />

      <section className="relative overflow-hidden bg-ink">
        <HeroBackdrop />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-24 lg:pt-16">
          <div className="text-white">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-200">
              <Icon name="map" className="h-3.5 w-3.5" /> St. Claude Ave · New Orleans
            </p>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              Mufflers, exhaust
              <br />
              &amp; tires,{" "}
              <span className="bg-gradient-to-r from-brand-300 to-sky-300 bg-clip-text text-transparent">
                done right.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-slate-300">
              {SHOP.tagline}. Book online in under a minute and we will call to confirm your time,
              or check on an estimate we have sent you.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#book"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-4 text-base font-bold text-white shadow-lift transition hover:bg-brand-400 lg:hidden"
              >
                <Icon name="calendar" className="h-5 w-5" /> Book a service
              </a>
              <a
                href="#estimate"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-6 py-4 text-base font-bold text-white transition hover:bg-white/10"
              >
                <Icon name="receipt" className="h-5 w-5" /> Check my estimate
              </a>
              <a
                href={SHOP.phoneHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-semibold text-slate-200 transition hover:text-white"
              >
                <Icon name="phone" className="h-5 w-5" /> {SHOP.phone}
              </a>
            </div>

            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6 text-sm">
              {[
                ["exhaust", "Exhaust & mufflers"],
                ["tire", "Tires & balancing"],
                ["converter", "Catalytic converters"],
              ].map(([icon, label]) => (
                <div key={label} className="flex flex-col gap-2 text-slate-300">
                  <Icon name={icon} className="h-6 w-6 text-brand-300" />
                  <dt className="font-semibold text-white">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div id="book" className="scroll-mt-24">
            <BookingCard />
          </div>
        </div>
      </section>

      <section className="border-b border-slate-100 bg-slate-50" aria-labelledby="services">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-600">What we do</p>
            <h2 id="services" className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">
              Exhaust and tire work, under one roof
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <a
                key={s.id}
                href="#book"
                className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                  <Icon name={s.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
                  Book this <Icon name="chevronRight" className="h-4 w-4" />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="estimate" className="scroll-mt-20 bg-white" aria-labelledby="estimate-title">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-600">Estimates</p>
            <h2 id="estimate-title" className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">
              Check your estimate
            </h2>
            <p className="mt-4 max-w-md text-slate-600">
              Enter the estimate number from your text or email and the phone number we have on
              file. You can see where it stands and approve the work online.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              {[
                "See the total and every line before any work starts",
                "Approve all of it or only part of it",
                "Nothing is charged until the work is done",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <EstimateLookup />
        </div>
      </section>

      <section className="bg-ink text-white" aria-labelledby="visit">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <h2 id="visit" className="font-display text-3xl font-extrabold">
              Come see us on St. Claude
            </h2>
            <p className="mt-3 text-lg text-slate-300">{SHOP_ADDRESS_LINE}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
            <a
              href={SHOP.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 font-bold text-ink transition hover:bg-slate-100"
            >
              <Icon name="map" className="h-5 w-5" /> Get directions
            </a>
            <a
              href={SHOP.phoneHref}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/25 px-5 py-3.5 font-bold text-white transition hover:bg-white/10"
            >
              <Icon name="phone" className="h-5 w-5" /> {SHOP.phone}
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {SHOP.legalName} · {SHOP_ADDRESS_LINE}
          </p>
          <Link to="/login" className="font-semibold text-slate-600 hover:text-ink">
            Staff login
          </Link>
        </div>
      </footer>
    </div>
  );
}

function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" aria-label={`${SHOP.name} home`}>
          <BrandName light compact />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <a href="#estimate" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white md:block">
            Check estimate
          </a>
          <a
            href={SHOP.phoneHref}
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white sm:inline-flex"
          >
            <Icon name="phone" className="h-4 w-4" /> {SHOP.phone}
          </a>
          <Link
            to={signedIn ? "/dashboard" : "/login"}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-ink shadow-sm transition hover:bg-brand-50"
          >
            <Icon name="shield" className="h-4 w-4 text-brand-600" />
            {signedIn ? "Open dashboard" : "Staff Login"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-brand-600/30 blur-3xl" />
      <div className="absolute -bottom-48 -left-24 h-[420px] w-[420px] rounded-full bg-sky-500/10 blur-3xl" />
      <svg className="absolute inset-0 h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0v32" fill="none" stroke="white" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Book a service
// ---------------------------------------------------------------------------

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function BookingCard() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    vehicle: "",
    service: SERVICES[0].title as string,
    preferredDate: "",
    preferredTime: "Any time",
    notes: "",
    website: "",
  });
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<ApiClientError | Error | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      await api.post("/public/bookings", form, { anonymous: true });
      setStatus("sent");
    } catch (err) {
      setError(err as Error);
      setStatus("idle");
    }
  }

  const fieldError = (name: string) =>
    error instanceof ApiClientError ? error.fields?.[name] : undefined;

  if (status === "sent") {
    return (
      <div className="rounded-3xl bg-white p-8 text-center shadow-lift">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
        </span>
        <h2 className="mt-4 font-display text-2xl font-extrabold">Request received</h2>
        <p className="mt-2 text-slate-600">
          Thanks, {form.name.split(" ")[0]}. We will call you at <strong>{form.phone}</strong> to
          confirm a time. Need us sooner? Call{" "}
          <a href={SHOP.phoneHref} className="font-semibold text-brand-600">
            {SHOP.phone}
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => {
            setForm((f) => ({ ...f, notes: "", vehicle: "" }));
            setStatus("idle");
          }}
          className="mt-6 text-sm font-semibold text-brand-600 hover:underline"
        >
          Book another service
        </button>
      </div>
    );
  }

  const input =
    "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/25";

  return (
    <form onSubmit={submit} className="rounded-3xl bg-white p-5 shadow-lift sm:p-7" noValidate>
      <h2 className="font-display text-2xl font-extrabold">Book a service</h2>
      <p className="mt-1 text-sm text-slate-500">Takes a minute. We call to confirm.</p>

      {error && !(error instanceof ApiClientError && error.fields) && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error.message}
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Your name</span>
          <input className={input} value={form.name} onChange={set("name")} autoComplete="name" required />
          {fieldError("name") && <span className="mt-1 block text-xs text-red-600">{fieldError("name")}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Phone</span>
          <input className={input} value={form.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="tel" required />
          {fieldError("phone") && <span className="mt-1 block text-xs text-red-600">{fieldError("phone")}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-600">What do you need?</span>
          <select className={input} value={form.service} onChange={set("service")}>
            {SERVICES.map((s) => (
              <option key={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Vehicle (optional)</span>
          <input className={input} value={form.vehicle} onChange={set("vehicle")} placeholder="2015 Toyota Camry" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Preferred day</span>
          <input className={input} type="date" min={today()} value={form.preferredDate} onChange={set("preferredDate")} />
          {fieldError("preferredDate") && <span className="mt-1 block text-xs text-red-600">{fieldError("preferredDate")}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Time</span>
          <select className={input} value={form.preferredTime} onChange={set("preferredTime")}>
            <option>Any time</option>
            <option>Morning</option>
            <option>Afternoon</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Anything we should know? (optional)</span>
          <textarea className={`${input} min-h-[76px]`} value={form.notes} onChange={set("notes")} placeholder="Rattle under the car when I start it" />
        </label>
        {/* Honeypot: hidden from people, filled in by bots. */}
        <input
          type="text"
          name="website"
          value={form.website}
          onChange={set("website")}
          tabIndex={-1}
          autoComplete="off"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
          aria-hidden="true"
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-4 text-base font-bold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
      >
        {status === "sending" ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <Icon name="send" className="h-5 w-5" />
        )}
        Request appointment
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        We only use your number to confirm this visit.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Check an estimate
// ---------------------------------------------------------------------------

type LookupResult = {
  number: string;
  status: string;
  customerFirstName: string;
  vehicle: string;
  total: number;
  currency: string;
  sentAt: string | null;
  approvalPath: string | null;
};

const ESTIMATE_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Being prepared", tone: "bg-slate-100 text-slate-700" },
  SENT: { label: "Waiting for your approval", tone: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", tone: "bg-emerald-100 text-emerald-800" },
  PARTLY_APPROVED: { label: "Partly approved", tone: "bg-emerald-100 text-emerald-800" },
  DECLINED: { label: "Declined", tone: "bg-slate-100 text-slate-700" },
  EXPIRED: { label: "Expired: call us for a new one", tone: "bg-slate-100 text-slate-700" },
  SUPERSEDED: { label: "Updated: a new version is on its way", tone: "bg-blue-100 text-blue-800" },
};

function EstimateLookup() {
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.post<LookupResult>("/public/estimate-lookup", { estimateNumber: number, phone }, { anonymous: true }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25";
  const status = result ? ESTIMATE_STATUS[result.status] ?? { label: result.status, tone: "bg-slate-100" } : null;

  return (
    <div className="self-start rounded-3xl border border-slate-200 bg-slate-50 p-5 sm:p-7">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Estimate number</span>
          <input className={input} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="EST-1000" required />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Phone on file</span>
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="(504) 555-0100" required />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-ink-700 disabled:opacity-60"
        >
          <Icon name="search" className="h-4 w-4" /> Look up
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
          {error}
        </p>
      )}

      {result && status && (
        <div className="mt-5 rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-slate-500">{result.number}</p>
              <p className="mt-0.5 text-lg font-bold">
                Hi {result.customerFirstName}
                {result.vehicle && <span className="font-normal text-slate-500"> · {result.vehicle}</span>}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
          </div>
          <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-500">Estimate total</span>
            <span className="font-display text-2xl font-extrabold tabular-nums">{money(result.total, result.currency)}</span>
          </div>
          {result.approvalPath ? (
            <Link
              to={result.approvalPath}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3.5 font-bold text-white transition hover:bg-brand-700"
            >
              Review &amp; approve <Icon name="chevronRight" className="h-4 w-4" />
            </Link>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Questions? Call{" "}
              <a href={SHOP.phoneHref} className="font-semibold text-brand-600">
                {SHOP.phone}
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
