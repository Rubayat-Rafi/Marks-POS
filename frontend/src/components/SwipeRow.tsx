import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export type SwipeAction = {
  label: string;
  icon?: string;
  onAction: () => void;
  tone?: "brand" | "green" | "amber" | "slate" | "red";
};

const TONES: Record<NonNullable<SwipeAction["tone"]>, string> = {
  brand: "bg-brand-600 text-white",
  green: "bg-emerald-600 text-white",
  amber: "bg-amber-500 text-white",
  slate: "bg-slate-600 text-white",
  red: "bg-red-600 text-white",
};

const ACTION_WIDTH = 88;

/**
 * A list row with actions behind it, for phones and tablets.
 *
 * Swipe left to reveal the actions on the right; a full, fast swipe runs the
 * first one straight away (swipe a car to collect its payment). Vertical
 * scrolling is left alone. On a desktop the same actions show as buttons at
 * the end of the row, so nothing depends on the gesture.
 */
export function SwipeRow({
  children,
  actions,
  onOpen,
}: {
  children: ReactNode;
  actions: SwipeAction[];
  /** Tapping the row itself. */
  onOpen?: () => void;
}) {
  const [offset, setOffsetState] = useState(0);
  // The live position is kept in a ref too: a quick flick can end before
  // React re-renders, and the release must see where the finger really was.
  const offsetRef = useRef(0);
  const setOffset = (value: number) => {
    offsetRef.current = value;
    setOffsetState(value);
  };
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; offset: number; t: number; axis: "x" | "y" | null } | null>(null);
  const moved = useRef(false);

  const max = actions.length * ACTION_WIDTH;

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, offset: offsetRef.current, t: Date.now(), axis: null };
    moved.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Some browsers refuse capture for touch; the swipe still works.
        }
      }
    }
    if (s.axis !== "x") return;
    moved.current = true;
    setDragging(true);
    // Resist past the last action so the row feels anchored.
    const next = Math.min(0, s.offset + dx);
    setOffset(next < -max ? -max + (next + max) * 0.25 : next);
  }

  function onPointerUp() {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || s.axis !== "x") return;
    const current = offsetRef.current;
    if (current < -max - 40) {
      // A deliberate over-swipe, well past the buttons, runs the first action.
      setOffset(0);
      actions[0]?.onAction();
      return;
    }
    // Otherwise snap: open if dragged past halfway or flicked, else close.
    const flicked = Date.now() - s.t < 250 && current < -40;
    setOffset(current < -max / 2 || flicked ? -max : 0);
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-white">
      {/* Actions revealed behind the row on touch screens. */}
      <div className="absolute inset-y-0 right-0 flex sm:hidden" aria-hidden={offset === 0}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={offset === 0 ? -1 : 0}
            onClick={() => {
              setOffset(0);
              a.onAction();
            }}
            style={{ width: ACTION_WIDTH }}
            className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold ${TONES[a.tone ?? "brand"]}`}
          >
            {a.icon && <Icon name={a.icon} className="h-5 w-5" />}
            {a.label}
          </button>
        ))}
      </div>

      <div
        className={`touch-pan-y relative flex items-stretch bg-white ${dragging ? "" : "transition-transform duration-200 ease-out"}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={`min-w-0 flex-1 ${onOpen ? "cursor-pointer" : ""}`}
          role={onOpen ? "button" : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={() => {
            if (moved.current) return;
            if (offset !== 0) {
              setOffset(0);
              return;
            }
            onOpen?.();
          }}
          onKeyDown={(e) => {
            if (onOpen && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onOpen();
            }
          }}
        >
          {children}
        </div>

        {/* The same actions as plain buttons where there is room. */}
        <div className="hidden shrink-0 items-center gap-2 pr-3 sm:flex">
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onAction}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                i === 0
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "border border-slate-200 bg-white text-ink hover:bg-slate-50"
              }`}
            >
              {a.icon && <Icon name={a.icon} className="h-4 w-4" />}
              {a.label}
            </button>
          ))}
        </div>

        {/* A hint on touch screens that the row slides. */}
        {offset === 0 && actions.length > 0 && (
          <div className="flex items-center pr-2 text-slate-300 sm:hidden" aria-hidden="true">
            <Icon name="chevronLeft" className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}
