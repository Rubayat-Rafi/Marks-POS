import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { SHOP } from "../lib/shop";
import { BrandName } from "../components/Brand";
import { Icon } from "../components/Icon";

type Checkout = {
  shopName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
  canPay: boolean;
};

/**
 * Where the QR code and "send a link" payments land on the customer's phone.
 *
 * With a real card processor this page would hand off to the processor's own
 * hosted checkout. In this build the processor is the in-app test processor,
 * so the page shows the amount and an approve button that settles it the way
 * a real card approval would; the shop's screen picks the payment up on its
 * own.
 */
export function PayPage() {
  const { externalId } = useParams<{ externalId: string }>();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Checkout>(`/public/checkout/${externalId}`, { anonymous: true })
      .then(setCheckout)
      .catch((err) => setError(err instanceof Error ? err.message : "This payment link is not valid."));
  }, [externalId]);

  async function pay(outcome: "approve" | "decline") {
    setBusy(true);
    setError(null);
    try {
      setCheckout(
        await api.post<Checkout>(`/public/checkout/${externalId}/pay`, { outcome }, { anonymous: true }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-ink">
        <div className="mx-auto flex h-16 max-w-md items-center px-4">
          <BrandName light compact />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        {!checkout && !error && (
          <div className="h-64 animate-pulse rounded-3xl bg-white shadow-card" aria-busy="true" />
        )}

        {!checkout && error && (
          <Panel icon="alert" tone="amber" title="Link not available">
            {error}
          </Panel>
        )}

        {checkout && checkout.status === "SUCCEEDED" && (
          <Panel icon="check" tone="green" title="Payment complete">
            You paid <strong>{money(checkout.amount, checkout.currency)}</strong> on invoice{" "}
            <span className="font-mono">{checkout.invoiceNumber}</span>. Thank you! The shop will
            hand you your receipt.
          </Panel>
        )}

        {checkout && (checkout.status === "FAILED" || checkout.status === "CANCELLED") && (
          <Panel icon="alert" tone="amber" title={checkout.status === "FAILED" ? "Card declined" : "Payment cancelled"}>
            {checkout.status === "FAILED"
              ? "Your card was not charged. Ask the shop for a new code, or pay at the counter."
              : "This payment was cancelled at the counter. Nothing was charged."}
          </Panel>
        )}

        {checkout && (checkout.status === "PENDING" || checkout.status === "CREATED" || checkout.status === "UNKNOWN") && (
          <div className="overflow-hidden rounded-3xl bg-white shadow-lift">
            <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-8 text-white">
              <p className="text-sm font-semibold text-brand-100">Pay {checkout.shopName}</p>
              <p className="mt-2 font-display text-5xl font-extrabold tabular-nums">
                {money(checkout.amount, checkout.currency)}
              </p>
              <p className="mt-2 font-mono text-sm text-brand-100">Invoice {checkout.invoiceNumber}</p>
            </div>
            <div className="space-y-3 p-6">
              {error && (
                <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </p>
              )}
              {checkout.canPay ? (
                <>
                  <button
                    type="button"
                    onClick={() => pay("approve")}
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 py-4 text-lg font-bold text-white transition hover:bg-ink-700 disabled:opacity-60"
                  >
                    {busy ? (
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Icon name="card" className="h-5 w-5" />
                    )}
                    Pay {money(checkout.amount, checkout.currency)}
                  </button>
                  <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
                    Test checkout: no real card is charged. The shop has not connected a live card
                    processor to this link yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => pay("decline")}
                    disabled={busy}
                    className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600"
                  >
                    Simulate a declined card
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Online payment is not available for this link. Please pay at the counter.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="pb-8 text-center text-xs text-slate-400">
        {SHOP.legalName} · <a href={SHOP.phoneHref}>{SHOP.phone}</a>
      </footer>
    </div>
  );
}

function Panel({
  icon,
  tone,
  title,
  children,
}: {
  icon: string;
  tone: "green" | "amber";
  title: string;
  children: React.ReactNode;
}) {
  const tones = { green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700" };
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-lift">
      <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tones[tone]}`}>
        <Icon name={icon} className="h-7 w-7" strokeWidth={2.2} />
      </span>
      <h1 className="mt-4 font-display text-2xl font-extrabold text-ink">{title}</h1>
      <p className="mt-2 text-slate-600">{children}</p>
    </div>
  );
}
