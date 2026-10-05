import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadImage } from "../lib/api";
import { dateTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Button, DataState, ErrorBanner, Field, Input, Notice, Select } from "./ui";

type InspectionResult = "OK" | "ADVISE" | "URGENT" | "NOT_CHECKED";

type InspectionItem = {
  id: string;
  category: string;
  label: string;
  result: InspectionResult;
  note: string | null;
  photoKeys: string[];
};

type Inspection = {
  id: string;
  title: string;
  notes: string | null;
  completedAt: string | null;
  items: InspectionItem[];
};

/** The default multi-point sheet a shop works through on check-in. */
const TEMPLATE: Array<{ category: string; label: string }> = [
  { category: "Brakes", label: "Front pads" },
  { category: "Brakes", label: "Rear pads" },
  { category: "Brakes", label: "Rotors and drums" },
  { category: "Brakes", label: "Brake fluid" },
  { category: "Tires", label: "Tread depth" },
  { category: "Tires", label: "Pressure and wear pattern" },
  { category: "Fluids", label: "Engine oil" },
  { category: "Fluids", label: "Coolant" },
  { category: "Fluids", label: "Transmission fluid" },
  { category: "Electrical", label: "Battery load test" },
  { category: "Electrical", label: "Charging system" },
  { category: "Electrical", label: "Lights and wipers" },
  { category: "Steering", label: "Tie rod ends and ball joints" },
  { category: "Steering", label: "Shocks and struts" },
  { category: "Under hood", label: "Belts and hoses" },
  { category: "Under hood", label: "Air and cabin filters" },
];

const RESULT_TONES: Record<InspectionResult, string> = {
  OK: "bg-green-100 text-green-800 border-green-200",
  ADVISE: "bg-amber-100 text-amber-800 border-amber-200",
  URGENT: "bg-red-100 text-red-800 border-red-200",
  NOT_CHECKED: "bg-slate-100 text-slate-500 border-slate-200",
};

const RESULT_LABELS: Record<InspectionResult, string> = {
  OK: "OK",
  ADVISE: "Advise",
  URGENT: "Urgent",
  NOT_CHECKED: "Not checked",
};

export function JobInspection({
  jobId,
  inspections,
}: {
  jobId: string;
  inspections: Inspection[];
}) {
  const { can } = useAuth();
  const [recording, setRecording] = useState(false);

  return (
    <div className="space-y-4">
      {recording ? (
        <InspectionForm jobId={jobId} onDone={() => setRecording(false)} />
      ) : (
        can("inspections.write") && (
          <Button variant="secondary" onClick={() => setRecording(true)}>
            Record inspection
          </Button>
        )
      )}

      <DataState
        empty={inspections.length === 0 && !recording}
        emptyMessage="No inspection recorded for this job."
      >
        <div className="space-y-4">
          {inspections.map((inspection) => (
            <InspectionView key={inspection.id} inspection={inspection} />
          ))}
        </div>
      </DataState>
    </div>
  );
}

function InspectionView({ inspection }: { inspection: Inspection }) {
  const categories = [...new Set(inspection.items.map((i) => i.category))];
  const urgent = inspection.items.filter((i) => i.result === "URGENT");
  const advise = inspection.items.filter((i) => i.result === "ADVISE");
  const allKeys = inspection.items.flatMap((i) => i.photoKeys);

  // Photo links are signed and short-lived, so they are fetched when the
  // inspection is actually viewed rather than stored in the record.
  const links = useQuery({
    queryKey: ["file-links", inspection.id],
    queryFn: () => api.post<{ urls: Record<string, string> }>("/files/sign", { keys: allKeys }),
    enabled: allKeys.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{inspection.title}</h3>
          <p className="text-xs text-slate-500">
            {inspection.completedAt
              ? `Completed ${dateTime(inspection.completedAt)}`
              : "In progress"}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {urgent.length > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-800">
              {urgent.length} urgent
            </span>
          )}
          {advise.length > 0 && (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
              {advise.length} advise
            </span>
          )}
        </div>
      </div>

      {categories.map((category) => (
        <div key={category} className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {category}
          </p>
          <ul className="space-y-1">
            {inspection.items
              .filter((i) => i.category === category)
              .map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${RESULT_TONES[item.result]}`}
                  >
                    {RESULT_LABELS[item.result]}
                  </span>
                  <span className="flex-1">
                    <span className="text-ink">{item.label}</span>
                    {item.note && (
                      <span className="block text-xs text-slate-500">{item.note}</span>
                    )}
                    {item.photoKeys.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {item.photoKeys.map((key) => {
                          const url = links.data?.urls[key];
                          return url ? (
                            <a key={key} href={url} target="_blank" rel="noreferrer">
                              <img
                                src={url}
                                alt={`${item.label} inspection photo`}
                                className="h-16 w-16 rounded border border-slate-200 object-cover"
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <span
                              key={key}
                              className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-200 text-[10px] text-slate-400"
                            >
                              photo
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}

      {inspection.notes && (
        <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">{inspection.notes}</p>
      )}
    </div>
  );
}

function InspectionForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState(
    TEMPLATE.map((t) => ({
      ...t,
      result: "NOT_CHECKED" as InspectionResult,
      note: "",
      photoKeys: [] as string[],
    })),
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.post(`/repair-orders/${jobId}/inspections`, {
        title: "Multi-point inspection",
        notes: notes || undefined,
        items: items.map((i) => ({
          category: i.category,
          label: i.label,
          result: i.result,
          note: i.note || undefined,
          photoKeys: i.photoKeys,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      onDone();
    },
  });

  const setItem = (index: number, patch: Partial<(typeof items)[number]>) =>
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const categories = [...new Set(items.map((i) => i.category))];
  const checked = items.filter((i) => i.result !== "NOT_CHECKED").length;

  return (
    <form
      className="space-y-4 rounded border border-teal-200 bg-teal-50/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Multi-point inspection</h3>
        <span className="text-xs text-slate-500">
          {checked} of {items.length} checked
        </span>
      </div>

      <ErrorBanner error={save.error} />
      {uploadError && <Notice tone="danger">{uploadError}</Notice>}

      <Notice>
        Anything left as <strong>not checked</strong> is recorded as not checked. It is never
        implied to be OK.
      </Notice>

      {categories.map((category) => (
        <fieldset key={category}>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {category}
          </legend>
          <div className="space-y-2">
            {items.map((item, index) =>
              item.category !== category ? null : (
                <div
                  key={item.label}
                  className="grid gap-2 rounded border border-slate-200 bg-white p-2 sm:grid-cols-12"
                >
                  <span className="self-center text-sm text-ink sm:col-span-4">{item.label}</span>
                  <div className="sm:col-span-3">
                    <Select
                      value={item.result}
                      onChange={(e) =>
                        setItem(index, { result: e.target.value as InspectionResult })
                      }
                      className="text-xs"
                      aria-label={`${item.label} result`}
                    >
                      {(Object.keys(RESULT_LABELS) as InspectionResult[]).map((r) => (
                        <option key={r} value={r}>
                          {RESULT_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-4">
                    <Input
                      value={item.note}
                      onChange={(e) => setItem(index, { note: e.target.value })}
                      placeholder="Measurement or note"
                      className="text-xs"
                      aria-label={`${item.label} note`}
                    />
                  </div>
                  <div className="self-center sm:col-span-1">
                    <PhotoButton
                      label={item.label}
                      count={item.photoKeys.length}
                      onUploaded={(key) =>
                        setItem(index, { photoKeys: [...item.photoKeys, key] })
                      }
                      onError={setUploadError}
                    />
                  </div>
                </div>
              ),
            )}
          </div>
        </fieldset>
      ))}

      <Field label="Overall notes">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What the customer should know"
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>
          Save inspection
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Capture or pick a photo for one inspection item.
 *
 * `capture="environment"` opens the rear camera straight away on a tablet in
 * the bay, which is how a technician actually uses this (build guide / 03).
 */
function PhotoButton({
  label,
  count,
  onUploaded,
  onError,
}: {
  label: string;
  count: number;
  onUploaded: (key: string) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <label
      className={`flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-300 px-2 py-2 text-xs transition ${
        busy ? "opacity-50" : "hover:bg-slate-50"
      }`}
      title={`Add a photo for ${label}`}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          onError(null);
          try {
            const result = await uploadImage("/files/inspections", file);
            onUploaded(result.key);
          } catch (err) {
            onError(err instanceof Error ? err.message : "That photo could not be uploaded.");
          } finally {
            setBusy(false);
            // Allow re-picking the same file after a failure.
            e.target.value = "";
          }
        }}
      />
      <span aria-hidden>{busy ? "..." : "Photo"}</span>
      {count > 0 && <span className="font-medium text-teal-700">{count}</span>}
      <span className="sr-only">Add a photo for {label}</span>
    </label>
  );
}
