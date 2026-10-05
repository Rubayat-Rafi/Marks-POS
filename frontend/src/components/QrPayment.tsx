import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { money } from "../lib/format";

/**
 * Renders a checkout link as a scannable code.
 *
 * The code is generated entirely in the browser (the `qrcode` package draws
 * straight to a canvas). Nothing is sent to a third-party QR image service:
 * that link is effectively a bearer token for this specific payment attempt,
 * and handing it to an external API would leak it outside the shop's own
 * infrastructure for no reason (build guide / 12, secrets and tokens stay out
 * of anywhere they do not need to be).
 */
export function QrPayment({
  url,
  amount,
  currency = "USD",
}: {
  url: string;
  amount: number;
  currency?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 1,
      color: { dark: "#122935", light: "#ffffff" },
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not draw the code.");
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white p-5 text-center">
      <p className="text-sm font-medium text-ink">
        Scan to pay {money(amount, currency)}
      </p>
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : (
        <canvas ref={canvasRef} width={220} height={220} className="rounded" />
      )}
      <p className="max-w-[220px] text-xs text-slate-500">
        Have the customer scan this with their phone camera. It opens the same secure checkout
        link as a card payment; nothing is charged until the processor confirms it.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="break-all font-mono text-[11px] text-teal-700 underline"
      >
        {url}
      </a>
    </div>
  );
}
