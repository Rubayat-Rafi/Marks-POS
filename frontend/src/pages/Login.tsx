import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth, type ShopChoice } from "../lib/auth";
import { Button, ErrorBanner, Field, Input, Select } from "../components/ui";
import { BrandName } from "../components/Brand";
import { Icon } from "../components/Icon";

export function LoginPage() {
  const { user, signIn, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shops, setShops] = useState<ShopChoice[] | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn(email, password, membershipId || undefined);
      // One person can belong to several shops, so the shop is chosen at
      // sign-in rather than guessed (build guide / 01).
      if (result.needsShopChoice) {
        setShops(result.memberships);
        setMembershipId(result.memberships[0]?.id ?? "");
      }
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/">
          <BrandName light compact />
        </Link>
        <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-300 hover:text-white">
          <Icon name="chevronLeft" className="h-4 w-4" /> Back to site
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl bg-white p-6 shadow-lift sm:p-8">
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Icon name="shield" className="h-6 w-6" />
              </span>
              <h1 className="mt-4 font-display text-2xl font-extrabold text-ink">Staff login</h1>
              <p className="mt-1 text-sm text-slate-500">Jobs, payments, receipts and inventory.</p>
            </div>

            <ErrorBanner error={error} />

            <Field label="Email" required>
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>

            <Field label="Password" required>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {shops && (
              <Field label="Shop" hint="Your account is attached to more than one business.">
                <Select value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.organizationName} — {s.locationName} ({s.role.toLowerCase().replace("_", " ")})
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              {shops ? "Continue" : "Sign in"}
            </Button>
          </form>

          {/* Demo logins exist only in the seeded development database. */}
          {import.meta.env.DEV && (
            <details className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <summary className="cursor-pointer font-semibold text-white">Demo accounts</summary>
              <p className="mt-2">
                Password for all: <code className="font-mono text-white">AutoShop2026!</code>
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                <li><code>mohammad@markstire.com</code> — everything (Owner / Admin)</li>
                <li><code>advisor@markstire.test</code> — counter, no cost data</li>
                <li><code>tech@markstire.test</code> — assigned jobs only</li>
                <li><code>books@markstire.test</code> — ledger and reconciliation</li>
                <li><code>consultant@markstire.test</code> — belongs to two shops</li>
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
