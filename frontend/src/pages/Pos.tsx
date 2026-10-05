import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiClientError, newIdempotencyKey } from "../lib/api";
import { customerLabel, dateTime, money, parseMoney } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Button, Card, DataState, ErrorBanner, Input, Notice, StatusBadge } from "../components/ui";
import { QrPayment } from "../components/QrPayment";
import { SwipeRow } from "../components/SwipeRow";
import { Icon } from "../components/Icon";
import type { Invoice, PaymentAttempt } from "../lib/types";

type ProviderInfo = {
  selected: string;
  selectedIsImplemented: boolean;
  demoTools: boolean;
  available: Array<{ name: string; capabilities: { methods: string[] } }>;
};

type Method = "CASH" | "CARD_EXTERNAL" | "CHECK" | "OTHER" | "CARD_TERMINAL" | "CARD_ONLINE" | "QR_CODE";

const MANUAL: Method[] = ["CASH", "CARD_EXTERNAL", "CHECK", "OTHER"];

export const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD_EXTERNAL: "Card (Debit / Credit)",
  CHECK: "Check",
  OTHER: "Other",
  CARD_TERMINAL: "Card terminal",
  CARD_ONLINE: "Pay link",
  QR_CODE: "QR code",
  ACH: "Bank transfer",
};

const METHOD_ICONS: Record<string, string> = {
  CASH: "cash",
  CARD_EXTERNAL: "card",
  CHECK: "receipt",
  OTHER: "more",
  CARD_TERMINAL: "card",
  CARD_ONLINE: "send",
  QR_CODE: "qr",
};

const OPEN_STATUSES = ["CREATED", "PENDING", "UNKNOWN"];

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// The list: what is waiting to be paid, and what was paid today
// ---------------------------------------------------------------------------

import { PosRegister } from "../features/pos/PosRegister";

export function PosPage() {
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const [view, setView] = useState<"register" | "classic">(() => {
    try {
      return localStorage.getItem("pos.view") === "classic" ? "classic" : "register";
    } catch {
      return "register";
    }
  });

  if (view === "register") {
    return (
      <PosRegister
        initialMode={invoiceId ? "OPEN_BALANCES" : "QUICK_SALE"}
        initialInvoiceId={invoiceId}
        onSwitchClassicView={() => {
          setView("classic");
          try {
            localStorage.setItem("pos.view", "classic");
          } catch {}
        }}
      />
    );
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-end text-xs px-1 print:hidden">
        <button
          type="button"
          onClick={() => {
            setView("register");
            try {
              localStorage.setItem("pos.view", "register");
            } catch {}
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
        >
          <Icon name="bolt" className="h-4 w-4" /> Switch to Touch Register View
        </button>
      </div>
      {invoiceId ? <CollectPayment key={invoiceId} invoiceId={invoiceId} /> : <OpenBalances />}
    </>
  );
}

function OpenBalances() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState("");

  const unpaid = useQuery({
    queryKey: ["invoices", "unpaid"],
    queryFn: () => api.get<{ data: Invoice[] }>("/invoices?unpaid=true"),
    refetchInterval: 30_000,
  });
  const drafts = useQuery({
    queryKey: ["invoices", "drafts"],
    queryFn: () => api.get<{ data: Invoice[] }>("/invoices?status=DRAFT"),
  });
  const paidToday = useQuery({
    queryKey: ["invoices", "paid-today"],
    queryFn: () => api.get<{ data: Invoice[] }>(`/invoices?paidFrom=${encodeURIComponent(startOfTodayIso())}`),
  });

  const match = (inv: Invoice) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      inv.number.toLowerCase().includes(q) ||
      customerLabel(inv.customer).toLowerCase().includes(q) ||
      (inv.repairOrder?.number ?? "").toLowerCase().includes(q)
    );
  };

  return (
    <>
      <PageHeader
        title="Collect payment"
        description="Pick who is paying. Swipe a row on a phone or tablet for quick actions."
        action={
          can("sales.quick") ? (
            <Link to="/quick-sale">
              <Button size="lg">
                <Icon name="plus" className="h-5 w-5" /> Quick sale
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="relative mb-4">
        <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice, customer or job"
          className="h-12 rounded-xl pl-11 text-base"
        />
      </div>

      <div className="space-y-5">
        <Card title="Waiting to be paid">
          <DataState
            loading={unpaid.isLoading}
            error={unpaid.error}
            empty={(unpaid.data?.data.filter(match).length ?? 0) === 0}
            emptyMessage={search ? "No match." : "Nothing outstanding. Every issued invoice is settled."}
          >
            <ul className="-mx-1 space-y-2">
              {unpaid.data?.data.filter(match).map((inv) => (
                <li key={inv.id}>
                  <SwipeRow
                    onOpen={() => navigate(`/pos/${inv.id}`)}
                    actions={[
                      { label: "Collect", icon: "cash", tone: "brand", onAction: () => navigate(`/pos/${inv.id}`) },
                      ...(inv.amountPaid > 0
                        ? [{ label: "Receipt", icon: "printer", tone: "slate" as const, onAction: () => navigate(`/receipts/${inv.id}`) }]
                        : []),
                    ]}
                  >
                    <InvoiceRowBody inv={inv} amount={inv.balance ?? 0} amountLabel="due" tone="amber" />
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        {(drafts.data?.data.filter(match).length ?? 0) > 0 && (
          <Card title="Not issued yet">
            <p className="mb-3 text-sm text-slate-500">
              These invoices are still drafts. Open one to issue it and take payment in the same step.
            </p>
            <ul className="-mx-1 space-y-2">
              {drafts.data?.data.filter(match).map((inv) => (
                <li key={inv.id}>
                  <SwipeRow
                    onOpen={() => navigate(`/pos/${inv.id}`)}
                    actions={[{ label: "Open", icon: "chevronRight", tone: "slate", onAction: () => navigate(`/pos/${inv.id}`) }]}
                  >
                    <InvoiceRowBody inv={inv} amount={inv.total} amountLabel="draft" tone="slate" />
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Paid today">
          <DataState
            loading={paidToday.isLoading}
            error={paidToday.error}
            empty={(paidToday.data?.data.filter(match).length ?? 0) === 0}
            emptyMessage="No payments completed yet today."
          >
            <ul className="-mx-1 space-y-2">
              {paidToday.data?.data.filter(match).map((inv) => (
                <li key={inv.id}>
                  <SwipeRow
                    onOpen={() => navigate(`/receipts/${inv.id}`)}
                    actions={[
                      { label: "Print", icon: "printer", tone: "green", onAction: () => navigate(`/receipts/${inv.id}?print=1`) },
                      { label: "View", icon: "receipt", tone: "slate", onAction: () => navigate(`/receipts/${inv.id}`) },
                    ]}
                  >
                    <InvoiceRowBody inv={inv} amount={inv.total} amountLabel="paid" tone="green" />
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>
    </>
  );
}

function InvoiceRowBody({
  inv,
  amount,
  amountLabel,
  tone,
}: {
  inv: Invoice;
  amount: number;
  amountLabel: string;
  tone: "amber" | "green" | "slate";
}) {
  const tones = { amber: "text-amber-700", green: "text-emerald-700", slate: "text-slate-500" };
  return (
    <div className="flex items-center gap-3 border border-slate-100 bg-white px-3 py-3 sm:rounded-xl sm:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{customerLabel(inv.customer)}</p>
        <p className="truncate text-xs text-slate-500">
          <span className="font-mono">{inv.number.startsWith("DRAFT-") ? "Draft" : inv.number}</span>
          {inv.repairOrder?.number && <> · job {inv.repairOrder.number}</>}
        </p>
      </div>
      <div className="text-right">
        <p className="font-display text-lg font-bold tabular-nums text-ink">{money(amount)}</p>
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}>{amountLabel}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collecting on one invoice
// ---------------------------------------------------------------------------

type Settled = { amount: number; method: string; change: number };

/** Per-device convenience: remember the last method used at this counter. */
function rememberedMethod(): Method {
  try {
    const m = localStorage.getItem("pos.method") as Method | null;
    if (m && MANUAL.includes(m)) return m;
  } catch {
    /* storage blocked: fall back */
  }
  return "CASH";
}
function rememberMethod(m: Method) {
  try {
    if (MANUAL.includes(m)) localStorage.setItem("pos.method", m);
  } catch {
    /* ignore */
  }
}

function CollectPayment({ invoiceId }: { invoiceId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const invoice = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.get<Invoice>(`/invoices/${invoiceId}`),
  });
  const providers = useQuery({
    queryKey: ["payment-providers"],
    queryFn: () => api.get<ProviderInfo>("/payments/providers"),
  });

  const inv = invoice.data;
  const balance = inv ? inv.total - inv.amountPaid - inv.amountCredited : 0;
  const payable = inv ? (inv.status === "ISSUED" || inv.status === "PARTLY_PAID") && balance > 0 : false;

  const [method, setMethodState] = useState<Method>(rememberedMethod);
  const [amountInput, setAmountInput] = useState("");
  const amountTouched = useRef(false);
  const [tenderedInput, setTenderedInput] = useState("");
  const [reference, setReference] = useState("");
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);

  /**
   * One key per intended payment. It is regenerated whenever the payment
   * being described changes (method or amount) and after every outcome, so a
   * declined card or a finished cash sale never leaves a used key behind to
   * block the next payment. A double tap on the same payment still reuses
   * the key, which is what stops a double charge (build guide / 09).
   */
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const rotateKey = () => setIdempotencyKey(newIdempotencyKey());

  const setMethod = (m: Method) => {
    setMethodState(m);
    rememberMethod(m);
    rotateKey();
  };

  // Prefill the amount with what is owed, and again whenever the balance
  // changes (after a partial payment), unless the cashier has typed their own.
  useEffect(() => {
    if (!inv) return;
    if (!amountTouched.current) setAmountInput(balance > 0 ? (balance / 100).toFixed(2) : "");
  }, [inv, balance]);

  // Pick up a card or QR attempt that is still waiting (after a refresh, or
  // one left over from earlier) so it can be finished or cancelled.
  useEffect(() => {
    if (!inv || attempt) return;
    const open = inv.attempts?.find((a) => OPEN_STATUSES.includes(a.status));
    if (open) setAttempt(open);
  }, [inv, attempt]);

  const amount = parseMoney(amountInput);
  const tendered = method === "CASH" && tenderedInput.trim() ? parseMoney(tenderedInput) : null;
  const change = tendered !== null && amount !== null ? tendered - amount : null;

  const amountProblem =
    amountInput.trim() === ""
      ? "Enter an amount."
      : amount === null || amount <= 0
        ? "Enter an amount above zero."
        : amount > balance
          ? `That is more than the ${money(balance)} owed.`
          : null;
  const tenderedProblem =
    tendered !== null && amount !== null && tendered < amount ? "Cash received is less than the amount." : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const providerOk = Boolean(providers.data?.selectedIsImplemented);
  const providerMethods =
    providers.data?.available.find((p) => p.name === providers.data?.selected)?.capabilities.methods ?? [];
  const methods: Method[] = [
    ...MANUAL,
    ...(providerOk ? (["CARD_TERMINAL", "QR_CODE"] as Method[]).filter((m) => providerMethods.includes(m)) : []),
  ];
  const isManual = MANUAL.includes(method);

  const takeManual = useMutation({
    mutationFn: () =>
      api.post<{ payment: { id: string }; change: number; invoice: { balance: number } }>("/payments/manual", {
        invoiceId,
        amount,
        method,
        idempotencyKey,
        reference: reference.trim() || undefined,
        tendered: tendered ?? undefined,
        cancelOpenAttempt: true,
      }),
    onSuccess: (result) => {
      setSettled({ amount: amount!, method, change: result.change ?? 0 });
      resetForm();
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === "attempt_open") refresh();
    },
  });

  const startCard = useMutation({
    mutationFn: () =>
      api.post<PaymentAttempt>("/payments/attempts", { invoiceId, amount, method, idempotencyKey }),
    onSuccess: (a) => {
      setAttempt(a);
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === "attempt_open") refresh();
    },
  });

  const issue = useMutation({
    mutationFn: () => api.post(`/invoices/${invoiceId}/issue`),
    onSuccess: refresh,
  });

  function resetForm() {
    amountTouched.current = false;
    setTenderedInput("");
    setReference("");
    rotateKey();
  }

  /** Clear the processor panel and go back to a fresh form. */
  function startNewPayment() {
    setAttempt(null);
    setSettled(null);
    startCard.reset();
    takeManual.reset();
    resetForm();
    refresh();
  }

  const busy = takeManual.isPending || startCard.isPending;
  const canSubmit = !busy && !amountProblem && !tenderedProblem && payable;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    if (isManual) takeManual.mutate();
    else startCard.mutate();
  }

  const buttonLabel =
    method === "CASH"
      ? `Record cash ${money(amount ?? 0)}`
      : method === "CARD_EXTERNAL"
        ? `Record card payment ${money(amount ?? 0)}`
        : method === "CHECK"
          ? `Record check ${money(amount ?? 0)}`
          : method === "QR_CODE"
            ? `Show QR code for ${money(amount ?? 0)}`
            : method === "OTHER"
              ? `Record ${money(amount ?? 0)}`
              : `Charge ${money(amount ?? 0)}`;

  return (
    <>
      <PageHeader
        title={inv ? `Collect on ${inv.number.startsWith("DRAFT-") ? "draft invoice" : inv.number}` : "Collect payment"}
        description={inv ? customerLabel(inv.customer) : undefined}
        action={
          <div className="flex gap-2">
            {inv && inv.amountPaid > 0 && (
              <Link to={`/receipts/${invoiceId}`}>
                <Button variant="secondary">
                  <Icon name="receipt" className="h-4 w-4" /> Receipt
                </Button>
              </Link>
            )}
            <Button variant="secondary" onClick={() => navigate("/pos")}>
              <Icon name="chevronLeft" className="h-4 w-4" /> All balances
            </Button>
          </div>
        }
      />

      <DataState loading={invoice.isLoading} error={invoice.error}>
        {inv && (
          <div className="grid gap-5 lg:grid-cols-[1fr_400px] [&>*]:min-w-0">
            <div className="order-2 lg:order-1">
              <InvoiceSummary inv={inv} balance={balance} />
            </div>

            <div className="order-1 space-y-4 lg:order-2">
              {/* Balance hero */}
              <div className="rounded-2xl bg-ink p-5 text-white shadow-lift">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {balance > 0 ? "Balance due" : "Balance"}
                </p>
                <p className="mt-1 font-display text-4xl font-extrabold tabular-nums">{money(Math.max(balance, 0))}</p>
                <p className="mt-1 text-sm text-slate-400">
                  Total {money(inv.total)}
                  {inv.amountPaid > 0 && <> · paid {money(inv.amountPaid)}</>}
                </p>
              </div>

              {settled && (
                <PaidPanel
                  settled={settled}
                  balance={balance}
                  invoiceId={invoiceId}
                  onAnother={() => setSettled(null)}
                />
              )}

              {!settled && inv.status === "DRAFT" && (
                <Card>
                  <div className="space-y-3">
                    <p className="font-semibold text-ink">This invoice has not been issued yet</p>
                    <p className="text-sm text-slate-600">
                      A draft can change, so it cannot take money. Issuing it gives it a number
                      and locks the lines; then you can collect straight away.
                    </p>
                    <ErrorBanner error={issue.error} />
                    {can("invoices.write") ? (
                      <Button size="lg" className="w-full" loading={issue.isPending} onClick={() => issue.mutate()}>
                        Issue invoice now
                      </Button>
                    ) : (
                      <Notice>Ask a manager or service advisor to issue it.</Notice>
                    )}
                  </div>
                </Card>
              )}

              {!settled && inv.status === "VOID" && (
                <Notice tone="warn">This invoice was voided. It cannot take a payment.</Notice>
              )}
              {!settled && inv.status === "CREDITED" && (
                <Notice tone="warn">This invoice was fully credited. Nothing is owed on it.</Notice>
              )}
              {!settled && inv.status !== "DRAFT" && balance <= 0 && inv.status !== "VOID" && inv.status !== "CREDITED" && (
                <PaidPanel settled={null} balance={0} invoiceId={invoiceId} onAnother={() => undefined} />
              )}

              {attempt && (
                <AttemptPanel
                  attempt={attempt}
                  currency={inv.currency}
                  demoTools={Boolean(providers.data?.demoTools)}
                  onChange={(a) => {
                    setAttempt(a);
                    if (a.status === "SUCCEEDED") {
                      setSettled({ amount: a.amount, method: a.method, change: 0 });
                      setAttempt(null);
                      resetForm();
                    }
                    if (a.status !== "PENDING") refresh();
                  }}
                  onStartNew={startNewPayment}
                />
              )}

              {!settled && !attempt && payable && (
                <Card>
                  <form onSubmit={submit} className="space-y-4">
                    <ErrorBanner error={takeManual.error ?? startCard.error} />

                    <div>
                      <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-ink" htmlFor="pos-amount">
                        Amount
                        {amount !== balance && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-brand-600"
                            onClick={() => {
                              amountTouched.current = false;
                              setAmountInput((balance / 100).toFixed(2));
                              rotateKey();
                            }}
                          >
                            Full balance {money(balance)}
                          </button>
                        )}
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-400">$</span>
                        <input
                          id="pos-amount"
                          value={amountInput}
                          onChange={(e) => {
                            amountTouched.current = true;
                            setAmountInput(e.target.value);
                            rotateKey();
                          }}
                          onFocus={(e) => e.currentTarget.select()}
                          inputMode="decimal"
                          autoComplete="off"
                          className="h-16 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 font-display text-3xl font-bold tabular-nums text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                          aria-invalid={Boolean(amountProblem)}
                          aria-describedby="pos-amount-help"
                        />
                      </div>
                      <p id="pos-amount-help" className={`mt-1 text-xs ${amountProblem ? "font-medium text-red-600" : "text-slate-500"}`}>
                        {amountProblem ?? "A partial payment is fine; the rest stays on the invoice."}
                      </p>
                    </div>

                    <fieldset>
                      <legend className="mb-1.5 text-sm font-semibold text-ink">How are they paying?</legend>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                        {methods.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setMethod(m)}
                            aria-pressed={method === m}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-semibold transition ${
                              method === m
                                ? "border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-600/20"
                                : "border-slate-200 bg-white text-ink hover:border-slate-300"
                            }`}
                          >
                            <Icon name={METHOD_ICONS[m]} className="h-5 w-5 shrink-0" />
                            {METHOD_LABELS[m]}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Record direct payment (Cash, Card, Check, or Other). No online payment gateway required.
                      </p>
                    </fieldset>

                    {method === "CASH" && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-600">Cash received (optional)</span>
                          <Input
                            value={tenderedInput}
                            onChange={(e) => setTenderedInput(e.target.value)}
                            inputMode="decimal"
                            placeholder={amount ? (amount / 100).toFixed(2) : ""}
                            className="tabular-nums"
                          />
                        </label>
                        <div className="rounded-xl bg-emerald-50 px-3 py-2">
                          <p className="text-xs font-semibold text-emerald-800">Change due</p>
                          <p className="font-display text-2xl font-bold tabular-nums text-emerald-800">
                            {change !== null && change >= 0 ? money(change) : "—"}
                          </p>
                        </div>
                        {tenderedProblem && <p className="col-span-2 text-xs font-medium text-red-600">{tenderedProblem}</p>}
                      </div>
                    )}

                    {(method === "CARD_EXTERNAL" || method === "CHECK" || method === "OTHER") && (
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">
                          {method === "CARD_EXTERNAL"
                            ? "Last 4 digits or approval code (optional)"
                            : method === "CHECK"
                              ? "Check number (optional)"
                              : "Note (optional)"}
                        </span>
                        <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
                        {method === "CARD_EXTERNAL" && (
                          <span className="mt-1 block text-xs text-slate-500">
                            Run the card on your other machine first, then record it here. It prints on the receipt.
                          </span>
                        )}
                      </label>
                    )}

                    <Button type="submit" size="xl" variant={isManual ? "success" : "primary"} className="w-full" loading={busy} disabled={!canSubmit}>
                      {buttonLabel}
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          </div>
        )}
      </DataState>
    </>
  );
}

function PaidPanel({
  settled,
  balance,
  invoiceId,
  onAnother,
}: {
  settled: Settled | null;
  balance: number;
  invoiceId: string;
  onAnother: () => void;
}) {
  const full = balance <= 0;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Icon name="check" className="h-6 w-6" strokeWidth={2.5} />
        </span>
        <div>
          <p className="font-display text-lg font-bold text-emerald-900">
            {settled ? `${money(settled.amount)} recorded` : "Paid in full"}
          </p>
          <p className="text-sm text-emerald-800">
            {settled && `${METHOD_LABELS[settled.method] ?? settled.method}. `}
            {full ? "This invoice is paid in full." : `${money(balance)} is still owed.`}
          </p>
          {settled && settled.change > 0 && (
            <p className="mt-2 inline-block rounded-lg bg-white px-3 py-1.5 font-display text-xl font-bold text-emerald-900 ring-1 ring-emerald-200">
              Give change: {money(settled.change)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link to={`/receipts/${invoiceId}?print=1`} className="sm:col-span-2">
          <Button size="lg" variant="success" className="w-full">
            <Icon name="printer" className="h-5 w-5" /> Print receipt
          </Button>
        </Link>
        <Link to={`/receipts/${invoiceId}`}>
          <Button variant="secondary" className="w-full">
            View receipt
          </Button>
        </Link>
        {full ? (
          <Link to="/pos">
            <Button variant="secondary" className="w-full">
              Next customer
            </Button>
          </Link>
        ) : (
          <Button variant="secondary" className="w-full" onClick={onAnother}>
            Take another payment
          </Button>
        )}
      </div>
    </div>
  );
}

function AttemptPanel({
  attempt,
  currency,
  demoTools,
  onChange,
  onStartNew,
}: {
  attempt: PaymentAttempt;
  currency: string;
  demoTools: boolean;
  onChange: (a: PaymentAttempt) => void;
  onStartNew: () => void;
}) {
  const { can } = useAuth();
  const open = OPEN_STATUSES.includes(attempt.status);

  const resolve = useMutation({
    mutationFn: () => api.post<PaymentAttempt>(`/payments/attempts/${attempt.id}/resolve`),
    onSuccess: onChange,
  });
  const cancel = useMutation({
    mutationFn: () => api.post<PaymentAttempt>(`/payments/attempts/${attempt.id}/cancel`),
    onSuccess: (a) => {
      if (a.status === "SUCCEEDED") onChange(a);
      else onStartNew();
    },
  });
  const simulate = useMutation({
    mutationFn: (outcome: "settle" | "fail") => api.post(`/payments/attempts/${attempt.id}/simulate`, { outcome }),
    onSuccess: () => resolve.mutate(),
  });

  // While the customer is paying (scanning the QR code, tapping the card),
  // ask the processor every few seconds so the screen flips to paid by itself.
  // A plain request rather than the "Check now" mutation, so that button does
  // not flash a spinner on every poll.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (attempt.status !== "PENDING") return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const latest = await api.post<PaymentAttempt>(`/payments/attempts/${attempt.id}/resolve`);
        if (!stopped && latest.status !== "PENDING") onChangeRef.current(latest);
      } catch {
        // A missed poll is harmless; the next one or "Check now" will catch up.
      }
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [attempt.status, attempt.id]);

  const cancelNeedsManager = attempt.status === "UNKNOWN" && !can("payments.refund");

  return (
    <Card title={attempt.method === "QR_CODE" ? "Customer scans to pay" : "Card payment"}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-display text-2xl font-bold tabular-nums">{money(attempt.amount, currency)}</span>
          <StatusBadge status={attempt.status} />
        </div>

        {attempt.status === "PENDING" && attempt.checkoutUrl && attempt.method === "QR_CODE" && (
          <QrPayment url={attempt.checkoutUrl} amount={attempt.amount} currency={currency} />
        )}
        {attempt.status === "PENDING" && attempt.checkoutUrl && attempt.method !== "QR_CODE" && (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Customer payment link</p>
            <a href={attempt.checkoutUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-brand-700 underline">
              {attempt.checkoutUrl}
            </a>
          </div>
        )}
        {attempt.status === "PENDING" && (
          <p className="flex items-center gap-2 text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> Waiting for the customer. This updates by itself.
          </p>
        )}

        {attempt.status === "UNKNOWN" && (
          <Notice tone="danger">
            <p className="font-semibold">The outcome is unknown</p>
            <p className="mt-1">
              The processor did not answer, so the money may already have moved. Check with the
              processor before taking payment another way.
            </p>
          </Notice>
        )}
        {attempt.status === "FAILED" && (
          <Notice tone="warn">{attempt.failureMessage ?? "The card was declined."} Nothing was charged.</Notice>
        )}
        {attempt.status === "CANCELLED" && <Notice>This payment was cancelled. Nothing was charged.</Notice>}

        <ErrorBanner error={resolve.error ?? cancel.error ?? simulate.error} />

        <div className="flex flex-wrap gap-2">
          {open && (
            <Button variant="secondary" loading={resolve.isPending} onClick={() => resolve.mutate()}>
              Check now
            </Button>
          )}
          {demoTools && attempt.provider === "mock" && attempt.status === "PENDING" && (
            <>
              <Button variant="secondary" loading={simulate.isPending} onClick={() => simulate.mutate("settle")}>
                Test: approve
              </Button>
              <Button variant="ghost" onClick={() => simulate.mutate("fail")}>
                Test: decline
              </Button>
            </>
          )}
        </div>

        {/* Always available: never leave the cashier stuck on an attempt. */}
        <Button
          variant={open ? "secondary" : "primary"}
          size="lg"
          className="w-full"
          loading={cancel.isPending}
          disabled={cancelNeedsManager}
          onClick={() => (open ? cancel.mutate() : onStartNew())}
        >
          <Icon name="undo" className="h-5 w-5" /> Start new payment
        </Button>
        {open && (
          <p className="text-center text-xs text-slate-500">
            {cancelNeedsManager
              ? "A manager must cancel a payment with an unknown outcome."
              : "Cancels this attempt (the processor is checked first) so you can take payment another way."}
          </p>
        )}
      </div>
    </Card>
  );
}

function InvoiceSummary({ inv, balance }: { inv: Invoice; balance: number }) {
  const lines = useMemo(() => inv.lines ?? [], [inv.lines]);
  return (
    <Card title="What they are paying for">
      <ul className="divide-y divide-slate-100">
        {lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{l.description}</p>
              <p className="text-xs text-slate-500">
                {Number(l.quantity)} × {money(l.unitPrice)}
                {l.inventoryUnits && l.inventoryUnits.length > 0 && (
                  <> · SN {l.inventoryUnits.map((u) => u.serialNumber).join(", ")}</>
                )}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{money(l.lineTotal)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
        <Row label="Subtotal" value={money(inv.subtotal)} />
        {inv.discountTotal > 0 && <Row label="Discounts" value={`-${money(inv.discountTotal)}`} />}
        <Row label="Sales tax" value={money(inv.taxTotal)} />
        <Row label="Total" value={money(inv.total)} strong />
        {inv.amountPaid > 0 && <Row label="Already paid" value={`-${money(inv.amountPaid)}`} />}
        {inv.amountCredited > 0 && <Row label="Credited" value={`-${money(inv.amountCredited)}`} />}
        <Row label="Balance due" value={money(Math.max(balance, 0))} strong />
      </dl>

      {(inv.attempts?.length ?? 0) > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payment history ({inv.attempts?.length})
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {inv.attempts?.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-slate-600">
                  {METHOD_LABELS[a.method] ?? a.method} · {dateTime(a.createdAt)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(a.amount)}</span>
                  <StatusBadge status={a.status} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-ink" : "text-slate-600"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
