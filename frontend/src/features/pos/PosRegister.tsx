import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiClientError, newIdempotencyKey } from "../../lib/api";
import { customerLabel, dateTime, money, parseMoney } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Icon } from "../../components/Icon";
import { Button, DataState, ErrorBanner, Input, Modal, Select } from "../../components/ui";
import { useLayout } from "../../components/Layout";
import { useBrowserFullscreen } from "../../lib/useBrowserFullscreen";
import { classifyLineDepartment, classifyTextDepartment, type ShopDepartment } from "../../lib/shopDepartment";
import type { AvailableProduct, CatalogItem, InventoryKind, InventoryProduct, Invoice} from "../../lib/types";

export type LineType = "LABOR" | "PART" | "FEE" | "DISCOUNT";

export type TicketLine = {
  key: string;
  lineType: LineType;
  description: string;
  quantity: string;
  unitPrice: string;
  taxable?: boolean;
  department?: ShopDepartment;
  units: Array<{ id: string; serialNumber: string }>;
};

type Preview = { subtotal: number; discountTotal: number; taxTotal: number; total: number };
type PayMethod = "CASH" | "CARD_EXTERNAL" | "CHECK" | "LATER" | "QR_CODE";

type DynamicPreset = {
  label: string;
  lineType: LineType;
  price?: string;
  taxable?: boolean;
  department?: ShopDepartment;
  units?: Array<{ id: string; serialNumber: string }>;
};

const TYPE_LABELS: Record<LineType, string> = {
  LABOR: "Service",
  PART: "Part",
  FEE: "Fee",
  DISCOUNT: "Discount",
};

const blankLine = (partial: Partial<TicketLine> = {}): TicketLine => ({
  key: newIdempotencyKey(),
  lineType: "LABOR",
  description: "",
  quantity: "1",
  unitPrice: "",
  taxable: true,
  units: [],
  ...partial,
});


function formatLiveTime(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let hh = d.getHours();
  const ampm = hh >= 12 ? "pm" : "am";
  hh = hh % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd}-${yyyy}   ${hh}:${min} ${ampm}`;
}

export function PosRegister({
  initialMode = "QUICK_SALE",
  initialInvoiceId,
  onSwitchClassicView,
}: {
  initialMode?: "QUICK_SALE" | "OPEN_BALANCES";
  initialInvoiceId?: string;
  onSwitchClassicView?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, can, signOut } = useAuth();
  const { fullscreenPos, setFullscreenPos } = useLayout();
  const { isFullscreen: isNativeFs, toggleFullscreen: toggleNativeFs } = useBrowserFullscreen();

  const isFull = fullscreenPos || isNativeFs;

  const handleToggleFullscreen = () => {
    toggleNativeFs();
    setFullscreenPos(!isFull);
  };

  // Mode: Quick sale (register) vs Open balances (invoices)
  const [mode, setMode] = useState<"QUICK_SALE" | "OPEN_BALANCES">(initialMode);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(initialInvoiceId ?? null);

  // Live ticking clock (matches WPOS bottom right)
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Quick sale lines & selection
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Keypad & scan input state
  const [upcInput, setUpcInput] = useState("");
  const [activeKeypadTarget, setActiveKeypadTarget] = useState<"scan" | "quantity" | "price">("scan");
  const [keypadBuffer, setKeypadBuffer] = useState("");
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Customer & vehicle
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [vehicle, setVehicle] = useState({ year: "", make: "", model: "", plate: "", mileage: "" });
  const [notes, setNotes] = useState("");
  const [ticketKey] = useState(newIdempotencyKey);

  // Modals
  const [itemFunctionsOpen, setItemFunctionsOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [otherFunctionsOpen, setOtherFunctionsOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [inventoryPickerOpen, setInventoryPickerOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [customItemModalOpen, setCustomItemModalOpen] = useState(false);
  const [customItem, setCustomItem] = useState<{
    description: string;
    price: string;
    quantity: string;
    taxable: boolean;
    lineType: LineType;
    department: ShopDepartment;
  }>({
    description: "",
    price: "",
    quantity: "1",
    taxable: true,
    lineType: "LABOR",
    department: "TIRE",
  });
  const [presetShopFilter, setPresetShopFilter] = useState<"ALL" | "TIRE" | "MUFFLER">("ALL");
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [lockedModalOpen, setLockedModalOpen] = useState(false);
  const [voidModalOpen, setVoidModalOpen] = useState(false);

  // Search, filter, and feedback states for Item Functions modal
  const [presetSearch, setPresetSearch] = useState("");
  const [presetTypeFilter, setPresetTypeFilter] = useState<"ALL" | "LABOR" | "PART">("ALL");
  const [lastAddedLabel, setLastAddedLabel] = useState<string | null>(null);

  // Optional custom configure item modal (opened if user clicks options ⚙️ on an item)
  const [itemConfigOpen, setItemConfigOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DynamicPreset | null>(null);
  const [itemConfigQty, setItemConfigQty] = useState("1");
  const [itemConfigPrice, setItemConfigPrice] = useState("");
  const [itemConfigTaxable, setItemConfigTaxable] = useState(true);

  // Custom Tax state (ticket-level total, NOT an item)
  const [customTaxModalOpen, setCustomTaxModalOpen] = useState(false);
  const [customTaxMode, setCustomTaxMode] = useState<"DEFAULT" | "PERCENT" | "AMOUNT" | "EXEMPT">("DEFAULT");
  const [customTaxPercent, setCustomTaxPercent] = useState("15.5");
  const [customTaxAmount, setCustomTaxAmount] = useState("");
  const [customTaxLabel, setCustomTaxLabel] = useState("Sales Tax");

  // Draft modal states (initialized when opening modal, committed only on Apply)
  const [modalTaxMode, setModalTaxMode] = useState<"PERCENT" | "AMOUNT">("AMOUNT");
  const [modalTaxPercent, setModalTaxPercent] = useState("15.5");
  const [modalTaxAmount, setModalTaxAmount] = useState("");

  // Auto-purge any legacy tax fee lines so tax is strictly a ticket total, not a product line item
  useEffect(() => {
    setLines((ls) => {
      const hasTaxFee = ls.some((l) => l.lineType === "FEE" && l.description.toLowerCase().includes("tax"));
      if (!hasTaxFee) return ls;
      return ls.filter((l) => !(l.lineType === "FEE" && l.description.toLowerCase().includes("tax")));
    });
  }, []);

  // Mobile tab (for screens < 768px)
  const [mobileTab, setMobileTab] = useState<"ticket" | "keypad">("ticket");

  // Subtotal of items (excluding tax fee lines and discounts) in cents
  const itemsSubtotalCents = useMemo(() => {
    return lines
      .filter(
        (l) =>
          !(l.lineType === "FEE" && l.description.toLowerCase().includes("tax")) &&
          l.lineType !== "DISCOUNT",
      )
      .reduce((acc, l) => {
        const qty = l.units.length > 0 ? l.units.length : Number(l.quantity) || 1;
        const price = parseMoney(l.unitPrice) ?? 0;
        return acc + qty * price;
      }, 0);
  }, [lines]);

  // Format payload for preview and sale (strictly actual items & services; tax is never an item)
  const payload = useMemo(
    () =>
      lines
        .filter((l) => !(l.lineType === "FEE" && l.description.toLowerCase().includes("tax")))
        .map((l) => ({
          lineType: l.units.length > 0 ? ("PART" as const) : l.lineType,
          description: l.description.trim(),
          quantity: l.units.length > 0 ? l.units.length : Number(l.quantity) || 1,
          unitPrice: parseMoney(l.unitPrice) ?? 0,
          taxable: l.taxable ?? true,
          unitIds: l.units.map((u) => u.id),
          department: l.department || classifyLineDepartment({ description: l.description, lineType: l.lineType }),
        }))
        .filter((l) => l.description && l.unitPrice !== null && l.quantity > 0),
    [lines],
  );

  // Compute custom tax rate in basis points or custom fixed amount in cents
  const customTaxRateBps = useMemo(() => {
    if (customTaxMode === "EXEMPT") return 0;
    if (customTaxMode === "PERCENT" && customTaxPercent.trim()) {
      const p = parseFloat(customTaxPercent);
      return isNaN(p) ? undefined : Math.round(p * 100);
    }
    return undefined;
  }, [customTaxMode, customTaxPercent]);

  const customTaxAmountCents = useMemo(() => {
    if (customTaxMode === "AMOUNT" && customTaxAmount.trim()) {
      const cents = parseMoney(customTaxAmount);
      return cents !== null && cents >= 0 ? cents : undefined;
    }
    return undefined;
  }, [customTaxMode, customTaxAmount]);

  // Client-side computed custom tax in cents for instant, lag-free UI update
  const customTaxCents = useMemo(() => {
    if (customTaxMode === "EXEMPT") return 0;
    if (customTaxMode === "AMOUNT" && customTaxAmount.trim()) {
      const cents = parseMoney(customTaxAmount);
      return cents !== null && cents >= 0 ? cents : 0;
    }
    if (customTaxMode === "PERCENT" && customTaxPercent.trim()) {
      const p = parseFloat(customTaxPercent);
      return !isNaN(p) && p >= 0 ? Math.round((itemsSubtotalCents * p) / 100) : 0;
    }
    return undefined; // DEFAULT mode (auto-calculated by backend)
  }, [customTaxMode, customTaxAmount, customTaxPercent, itemsSubtotalCents]);

  // Pricing preview
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (payload.length === 0) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      api
        .post<Preview>(
          "/quick-sales/preview",
          {
            lines: payload,
            customTaxRateBps,
            customTaxAmount: customTaxAmountCents,
          },
          { signal: controller.signal },
        )
        .then(setPreview)
        .catch(() => undefined)
        .finally(() => setPreviewing(false));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [payload, customTaxRateBps, customTaxAmountCents]);

  const displayTaxTotal = useMemo(() => {
    if (customTaxCents !== undefined) return customTaxCents;
    return preview?.taxTotal ?? 0;
  }, [customTaxCents, preview?.taxTotal]);

  const total = useMemo(() => {
    if (customTaxCents !== undefined) {
      const discountCents = lines
        .filter((l) => l.lineType === "DISCOUNT")
        .reduce((sum, l) => sum + (parseMoney(l.unitPrice) ?? 0), 0);
      return Math.max(0, itemsSubtotalCents - discountCents + customTaxCents);
    }
    return preview?.total ?? itemsSubtotalCents;
  }, [customTaxCents, itemsSubtotalCents, lines, preview?.total]);

  // Selected line object
  const selectedLine = useMemo(() => lines.find((l) => l.key === selectedKey), [lines, selectedKey]);

  // Keep first line selected if none selected
  useEffect(() => {
    if (lines.length > 0 && (!selectedKey || !lines.some((l) => l.key === selectedKey))) {
      setSelectedKey(lines[lines.length - 1].key);
    }
  }, [lines, selectedKey]);

  // Payment states
  const [payMethod, setPayMethod] = useState<PayMethod>("CASH");
  const [amountInput, setAmountInput] = useState("");
  const [tenderedInput, setTenderedInput] = useState("");
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (paymentModalOpen && total > 0) {
      setAmountInput((total / 100).toFixed(2));
      setTenderedInput((total / 100).toFixed(2));
    }
  }, [paymentModalOpen, total]);

  const payAmount = parseMoney(amountInput);
  const payTendered = payMethod === "CASH" && tenderedInput.trim() ? parseMoney(tenderedInput) : null;
  const payChange = payTendered !== null && payAmount !== null ? payTendered - payAmount : null;

  const quickSaleMutation = useMutation({
    mutationFn: () =>
      api.post<{ invoiceId: string }>("/quick-sales", {
        idempotencyKey: ticketKey,
        customer: { name: customer.name.trim() || undefined, phone: customer.phone.trim() || undefined },
        vehicle: {
          year: vehicle.year ? Number(vehicle.year) : null,
          make: vehicle.make.trim() || null,
          model: vehicle.model.trim() || null,
          plate: vehicle.plate.trim() || null,
          mileageIn: vehicle.mileage ? Number(vehicle.mileage.replace(/\D/g, "")) : null,
        },
        lines: payload,
        customTaxRateBps,
        customTaxAmount: customTaxAmountCents,
        notes: notes.trim() || undefined,
        payment:
          payMethod === "LATER"
            ? undefined
            : {
                method: payMethod,
                amount: payAmount ?? undefined,
                reference: reference.trim() || undefined,
                tendered: payTendered ?? undefined,
              },
      }),
    onSuccess: (result) => {
      setPaymentModalOpen(false);
      navigate(`/receipts/${result.invoiceId}?print=1`);
    },
  });

  // Query owner-created inventory, catalog parts & labor rates for Item Functions modal
  const availableInventoryQuery = useQuery({
    queryKey: ["inventory", "available", "ALL", ""],
    queryFn: () => api.get<{ data: AvailableProduct[] }>("/inventory/available"),
  });
  const allInventoryQuery = useQuery({
    queryKey: ["inventory", "products", "pos-all"],
    queryFn: () => api.get<{ data: InventoryProduct[] }>("/inventory/products?limit=100"),
  });
  const catalogQuery = useQuery({
    queryKey: ["settings", "catalog", "pos-all"],
    queryFn: () => api.get<{ data: CatalogItem[] }>("/settings/catalog"),
  });
  const laborRatesQuery = useQuery({
    queryKey: ["settings", "labor-rates"],
    queryFn: () => api.get<{ data: Array<{ id: string; name: string; ratePerHour: number; isDefault: boolean }> }>("/settings/labor-rates"),
  });

  const isLoadingPresets =
    availableInventoryQuery.isLoading ||
    allInventoryQuery.isLoading ||
    catalogQuery.isLoading ||
    laborRatesQuery.isLoading;

  const dynamicPresets = useMemo(() => {
    const list: Array<DynamicPreset> = [];
    const seenNames = new Set<string>();

    // 1. Add Configured Labor Rates (Services) created by owner
    for (const l of (laborRatesQuery.data?.data ?? [])) {
      const cleanName = l.name.trim();
      if (!cleanName || seenNames.has(cleanName.toLowerCase())) continue;
      seenNames.add(cleanName.toLowerCase());

      list.push({
        label: cleanName,
        lineType: "LABOR",
        price: (l.ratePerHour / 100).toFixed(2),
        taxable: true,
        department: classifyTextDepartment(cleanName),
      });
    }

    // 2. Add Available In-Stock Inventory Products (with serialized units if present)
    for (const p of (availableInventoryQuery.data?.data ?? [])) {
      const label = (p.brand ? `${p.brand} ${p.name} ${p.size || ""}` : `${p.name} ${p.size || ""}`).trim();
      if (!label || seenNames.has(label.toLowerCase())) continue;
      seenNames.add(label.toLowerCase());

      const dept: ShopDepartment =
        p.kind === "TIRE"
          ? "TIRE"
          : p.kind === "MUFFLER"
          ? "MUFFLER"
          : classifyTextDepartment(`${p.name} ${p.brand || ""}`);

      list.push({
        label,
        lineType: "PART",
        price: (p.priceCents / 100).toFixed(2),
        taxable: true,
        department: dept,
        units: p.units?.map((u) => ({ id: u.id, serialNumber: u.serialNumber })),
      });
    }

    // 3. Add All Configured Inventory Products created by owner (including un-serialized items)
    for (const p of (allInventoryQuery.data?.data ?? [])) {
      if (!p.isActive) continue;
      const label = (p.brand ? `${p.brand} ${p.name} ${p.size || ""}` : `${p.name} ${p.size || ""}`).trim();
      if (!label || seenNames.has(label.toLowerCase())) continue;
      seenNames.add(label.toLowerCase());

      const dept: ShopDepartment =
        p.kind === "TIRE"
          ? "TIRE"
          : p.kind === "MUFFLER"
          ? "MUFFLER"
          : classifyTextDepartment(`${p.name} ${p.brand || ""}`);

      list.push({
        label,
        lineType: "PART",
        price: (p.priceCents / 100).toFixed(2),
        taxable: true,
        department: dept,
      });
    }

    // 4. Add Catalog Items created by owner
    for (const c of (catalogQuery.data?.data ?? [])) {
      if (!c.isActive) continue;
      const label = (c.description || c.partNumber).trim();
      if (!label || seenNames.has(label.toLowerCase())) continue;
      seenNames.add(label.toLowerCase());

      const dept: ShopDepartment = classifyTextDepartment(`${c.description} ${c.category || ""} ${c.partNumber}`);
      list.push({
        label,
        lineType: "PART",
        price: (c.priceCents / 100).toFixed(2),
        taxable: true,
        department: dept,
      });
    }

    return list;
  }, [
    laborRatesQuery.data?.data,
    availableInventoryQuery.data?.data,
    allInventoryQuery.data?.data,
    catalogQuery.data?.data,
  ]);

  // Filtered presets for real-time search, shop division, and service/part filter
  const filteredPresets = useMemo(() => {
    return dynamicPresets.filter((p) => {
      if (p.label.toLowerCase() === "tax") return false;
      if (presetShopFilter !== "ALL" && p.department !== presetShopFilter) {
        return false;
      }
      if (presetTypeFilter === "LABOR" && p.lineType !== "LABOR") return false;
      if (presetTypeFilter === "PART" && p.lineType !== "PART") return false;
      if (presetSearch.trim()) {
        const q = presetSearch.toLowerCase().trim();
        const matchLabel = p.label.toLowerCase().includes(q);
        const matchPrice = (p.price ?? "").includes(q);
        const matchType = TYPE_LABELS[p.lineType]?.toLowerCase().includes(q);
        if (!matchLabel && !matchPrice && !matchType) return false;
      }
      return true;
    });
  }, [dynamicPresets, presetShopFilter, presetTypeFilter, presetSearch]);

  // Query unpaid count for header badge
  const unpaidInvoices = useQuery({
    queryKey: ["invoices", "unpaid"],
    queryFn: () => api.get<{ data: Invoice[] }>("/invoices?unpaid=true"),
    refetchInterval: 30_000,
  });
  const unpaidCount = unpaidInvoices.data?.data.length ?? 0;

  // Line helpers
  const updateLine = (key: string, patch: Partial<TicketLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((ls) => {
      const next = ls.filter((l) => l.key !== key);
      if (selectedKey === key) {
        setSelectedKey(next.length > 0 ? next[next.length - 1].key : null);
      }
      return next;
    });
  };


  // Breakdown of line subtotal by shop department (Tires vs Mufflers)
  const shopTotals = useMemo(() => {
    let tireCents = 0;
    let mufflerCents = 0;
    for (const l of lines) {
      if (l.lineType === "DISCOUNT" || (l.lineType === "FEE" && l.description.toLowerCase().includes("tax"))) continue;
      const qty = l.units.length > 0 ? l.units.length : Number(l.quantity) || 1;
      const price = parseMoney(l.unitPrice) ?? 0;
      const dept = l.department || classifyLineDepartment({ description: l.description, lineType: l.lineType });
      if (dept === "TIRE") tireCents += qty * price;
      else if (dept === "MUFFLER") mufflerCents += qty * price;
      else {
        tireCents += Math.round((qty * price) / 2);
        mufflerCents += Math.round((qty * price) / 2);
      }
    }
    return { tireCents, mufflerCents };
  }, [lines]);

  // Calculated custom tax in cents for the open modal preview
  const modalCalculatedTaxCents = useMemo(() => {
    if (modalTaxMode === "PERCENT") {
      const pct = parseFloat(modalTaxPercent);
      if (isNaN(pct) || pct <= 0) return 0;
      return Math.round((itemsSubtotalCents * pct) / 100);
    } else {
      const amt = parseMoney(modalTaxAmount);
      return amt && amt > 0 ? amt : 0;
    }
  }, [modalTaxMode, modalTaxPercent, modalTaxAmount, itemsSubtotalCents]);

  const handleOpenCustomTaxModal = () => {
    if (customTaxMode === "PERCENT") {
      setModalTaxMode("PERCENT");
      setModalTaxPercent(customTaxPercent || "15.5");
      setModalTaxAmount(customTaxAmount || "");
    } else if (customTaxMode === "AMOUNT") {
      setModalTaxMode("AMOUNT");
      setModalTaxAmount(customTaxAmount || "");
      setModalTaxPercent(customTaxPercent || "15.5");
    } else if (customTaxMode === "EXEMPT") {
      setModalTaxMode("PERCENT");
      setModalTaxPercent("0");
      setModalTaxAmount("0.00");
    } else {
      // DEFAULT: if customTaxAmount has a value, use AMOUNT, otherwise default to AMOUNT with empty/preset
      setModalTaxMode("AMOUNT");
      setModalTaxAmount(customTaxAmount || "");
      setModalTaxPercent(customTaxPercent || "15.5");
    }
    setCustomTaxModalOpen(true);
  };

  const handleApplyCustomTax = () => {
    // Purge any accidental fee tax lines so tax is strictly a ticket total, not a product line item
    setLines((ls) => ls.filter((l) => !(l.lineType === "FEE" && l.description.toLowerCase().includes("tax"))));

    if (modalTaxMode === "PERCENT") {
      setCustomTaxMode("PERCENT");
      setCustomTaxPercent(modalTaxPercent.trim() || "0");
    } else {
      setCustomTaxMode("AMOUNT");
      setCustomTaxAmount(modalTaxAmount.trim() || "0");
    }
    setCustomTaxModalOpen(false);
  };

  const handleResetToAutoTax = () => {
    setLines((ls) => ls.filter((l) => !(l.lineType === "FEE" && l.description.toLowerCase().includes("tax"))));
    setCustomTaxMode("DEFAULT");
    setCustomTaxAmount("");
    setModalTaxAmount("");
    setCustomTaxModalOpen(false);
  };

  const handleSetTaxExempt = () => {
    setLines((ls) => ls.filter((l) => !(l.lineType === "FEE" && l.description.toLowerCase().includes("tax"))));
    setCustomTaxMode("EXEMPT");
    setCustomTaxPercent("0");
    setCustomTaxAmount("0.00");
    setModalTaxPercent("0");
    setModalTaxAmount("0.00");
    setCustomTaxModalOpen(false);
  };

  // Check how many of a preset are currently on the ticket
  const getTicketQuantityForPreset = (p: DynamicPreset) => {
    return lines
      .filter(
        (l) =>
          l.description.trim().toLowerCase() === p.label.trim().toLowerCase() &&
          (!p.price || l.unitPrice === p.price)
      )
      .reduce((sum, l) => sum + (l.units.length > 0 ? l.units.length : Number(l.quantity) || 1), 0);
  };

  // Direct 1-click Add Item to ticket
  const handleDirectAddItem = (p: DynamicPreset) => {
    if (p.label.toLowerCase() === "tax") {
      setItemFunctionsOpen(false);
      handleOpenCustomTaxModal();
      return;
    }

    const pPrice = p.price ?? "0.00";
    setLines((ls) => {
      // If line with identical label & price already exists and has no specific serialized unit restriction, increment
      const idx = ls.findIndex(
        (l) =>
          l.description.trim().toLowerCase() === p.label.trim().toLowerCase() &&
          l.unitPrice === pPrice &&
          l.units.length === 0 &&
          (!p.units || p.units.length === 0)
      );

      if (idx >= 0) {
        const next = [...ls];
        const currentQty = Number(next[idx].quantity) || 1;
        next[idx] = {
          ...next[idx],
          quantity: String(currentQty + 1),
        };
        setSelectedKey(next[idx].key);
        return next;
      }

      // Otherwise create a fresh line
      const nl = blankLine({
        description: p.label,
        lineType: p.lineType,
        quantity: "1",
        unitPrice: pPrice,
        taxable: p.taxable ?? true,
        department: p.department || classifyTextDepartment(p.label),
        units: p.units?.length ? p.units.slice(0, 1) : [],
      });
      setSelectedKey(nl.key);
      return [...ls, nl];
    });

    setLastAddedLabel(p.label);
    setTimeout(() => {
      setLastAddedLabel((curr) => (curr === p.label ? null : curr));
    }, 2500);
  };

  // Direct 1-click Decrement Item from ticket
  const handleDirectDecrementItem = (p: DynamicPreset) => {
    const pPrice = p.price ?? "0.00";
    setLines((ls) => {
      const idx = ls.findIndex(
        (l) =>
          l.description.trim().toLowerCase() === p.label.trim().toLowerCase() &&
          l.unitPrice === pPrice
      );
      if (idx < 0) return ls;

      const next = [...ls];
      const currentQty = Number(next[idx].quantity) || 1;
      if (currentQty > 1) {
        next[idx] = { ...next[idx], quantity: String(currentQty - 1) };
        setSelectedKey(next[idx].key);
        return next;
      }

      // If quantity is 1, remove the line
      const removedKey = next[idx].key;
      const filtered = next.filter((_, i) => i !== idx);
      if (selectedKey === removedKey) {
        setSelectedKey(filtered.length > 0 ? filtered[filtered.length - 1].key : null);
      }
      return filtered;
    });
  };

  // Optional: Open custom price / custom quantity modal for a specific preset
  const handleOpenItemConfig = (p: DynamicPreset) => {
    if (p.label.toLowerCase() === "tax") {
      setItemFunctionsOpen(false);
      handleOpenCustomTaxModal();
      return;
    }
    setSelectedPreset({
      label: p.label,
      lineType: p.lineType,
      price: p.price ?? "0.00",
      taxable: p.taxable ?? true,
      department: p.department,
      units: p.units,
    });
    setItemConfigQty("1");
    setItemConfigPrice(p.price ?? "0.00");
    setItemConfigTaxable(p.taxable ?? true);
    setItemConfigOpen(true);
  };

  const handleConfirmAddPreset = (closeAll = true) => {
    if (!selectedPreset) return;
    const finalQty = itemConfigQty.trim() ? itemConfigQty.trim() : "1";
    const finalPrice = itemConfigPrice.trim() ? itemConfigPrice.trim() : (selectedPreset.price ?? "0.00");

    const nl = blankLine({
      description: selectedPreset.label,
      lineType: selectedPreset.lineType,
      quantity: finalQty,
      unitPrice: finalPrice,
      taxable: itemConfigTaxable,
      department: selectedPreset.department || classifyTextDepartment(selectedPreset.label),
      units: selectedPreset.units?.length ? selectedPreset.units.slice(0, Number(finalQty) || 1) : [],
    });

    setLines((ls) => [...ls, nl]);
    setSelectedKey(nl.key);
    setItemConfigOpen(false);
    if (closeAll) {
      setItemFunctionsOpen(false);
    }
  };

  // Compatibility aliases
  const handleSelectPreset = (p: DynamicPreset) => handleDirectAddItem(p);
  const handleQuickAddPreset = (p: DynamicPreset) => handleDirectAddItem(p);
  const addPreset = (p: DynamicPreset) => handleDirectAddItem(p);


  // Up/Down arrows to move selection in table
  const selectPrev = () => {
    if (lines.length === 0) return;
    const idx = lines.findIndex((l) => l.key === selectedKey);
    if (idx > 0) {
      setSelectedKey(lines[idx - 1].key);
    } else {
      setSelectedKey(lines[lines.length - 1].key);
    }
  };

  const selectNext = () => {
    if (lines.length === 0) return;
    const idx = lines.findIndex((l) => l.key === selectedKey);
    if (idx >= 0 && idx < lines.length - 1) {
      setSelectedKey(lines[idx + 1].key);
    } else {
      setSelectedKey(lines[0].key);
    }
  };

  // Barcode / UPC Search
  const handleScanSubmit = async (queryText?: string) => {
    const term = (queryText ?? upcInput).trim();
    if (!term) return;

    setUpcInput("");
    // 1. Try serial lookup in available inventory
    try {
      const res = await api.get<{ data: AvailableProduct[] }>(`/inventory/available?q=${encodeURIComponent(term)}`);
      const matchedProd = res.data?.find((p) =>
        p.units.some((u) => u.serialNumber.toLowerCase() === term.toLowerCase()),
      );
      if (matchedProd) {
        const unit = matchedProd.units.find((u) => u.serialNumber.toLowerCase() === term.toLowerCase())!;
        const nl = blankLine({
          lineType: "PART",
          description: [matchedProd.brand, matchedProd.name, matchedProd.size].filter(Boolean).join(" "),
          unitPrice: matchedProd.priceCents ? (matchedProd.priceCents / 100).toFixed(2) : "",
          units: [{ id: unit.id, serialNumber: unit.serialNumber }],
        });
        setLines((ls) => [...ls, nl]);
        setSelectedKey(nl.key);
        return;
      }
      // If product name matched
      if (res.data && res.data.length > 0) {
        const prod = res.data[0];
        const nl = blankLine({
          lineType: "PART",
          description: [prod.brand, prod.name, prod.size].filter(Boolean).join(" "),
          unitPrice: prod.priceCents ? (prod.priceCents / 100).toFixed(2) : "",
          units: prod.units.length > 0 ? [{ id: prod.units[0].id, serialNumber: prod.units[0].serialNumber }] : [],
        });
        setLines((ls) => [...ls, nl]);
        setSelectedKey(nl.key);
        return;
      }
    } catch {
      // Fall through to custom line
    }

    // 2. Add as custom part / labor line
    const nl = blankLine({
      description: term,
      lineType: "PART",
      quantity: "1",
      unitPrice: "",
    });
    setLines((ls) => [...ls, nl]);
    setSelectedKey(nl.key);
    // Switch keypad to price entry so cashier can immediately type price
    setActiveKeypadTarget("price");
    setKeypadBuffer("");
  };

  // Keypad press handler
  const handleKeypadPress = (val: string) => {
    if (paymentModalOpen) {
      if (val === "CLEAR") setTenderedInput("");
      else if (val === "BACKSPACE") setTenderedInput((s) => s.slice(0, -1));
      else if (val === "ENTER") {
        if (payTendered !== null && payAmount !== null && payTendered >= payAmount) {
          quickSaleMutation.mutate();
        }
      } else {
        setTenderedInput((s) => s + val);
      }
      return;
    }

    if (activeKeypadTarget === "quantity") {
      if (val === "CLEAR") setKeypadBuffer("");
      else if (val === "BACKSPACE") setKeypadBuffer((s) => s.slice(0, -1));
      else if (val === "ENTER") {
        if (selectedKey && keypadBuffer.trim()) {
          updateLine(selectedKey, { quantity: keypadBuffer.trim() });
        }
        setActiveKeypadTarget("scan");
        setKeypadBuffer("");
        scanInputRef.current?.focus();
      } else {
        setKeypadBuffer((s) => s + val);
      }
      return;
    }

    if (activeKeypadTarget === "price") {
      if (val === "CLEAR") setKeypadBuffer("");
      else if (val === "BACKSPACE") setKeypadBuffer((s) => s.slice(0, -1));
      else if (val === "ENTER") {
        if (selectedKey && keypadBuffer.trim()) {
          updateLine(selectedKey, { unitPrice: keypadBuffer.trim() });
        }
        setActiveKeypadTarget("scan");
        setKeypadBuffer("");
        scanInputRef.current?.focus();
      } else {
        setKeypadBuffer((s) => s + val);
      }
      return;
    }

    // Default: scan input target
    if (val === "CLEAR") setUpcInput("");
    else if (val === "BACKSPACE") setUpcInput((s) => s.slice(0, -1));
    else if (val === "ENTER") handleScanSubmit();
    else setUpcInput((s) => s + val);
  };

  // Keyboard shortcut listener for physical keyboards / barcode scanners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, don't hijack keyboard
      if (
        itemFunctionsOpen ||
        managementOpen ||
        transactionOpen ||
        otherFunctionsOpen ||
        customerModalOpen ||
        notesModalOpen ||
        customItemModalOpen ||
        discountModalOpen ||
        helpModalOpen ||
        lockedModalOpen
      ) {
        return;
      }

      if (e.key === "F11") {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (e.key === "F1") {
        e.preventDefault();
        setItemFunctionsOpen((o) => !o);
      } else if (e.key === "F2") {
        e.preventDefault();
        setManagementOpen((o) => !o);
      } else if (e.key === "F3") {
        e.preventDefault();
        setTransactionOpen((o) => !o);
      } else if (e.key === "F4") {
        e.preventDefault();
        setOtherFunctionsOpen((o) => !o);
      } else if (e.key === "F12" || (e.key === "p" && e.ctrlKey)) {
        e.preventDefault();
        if (total > 0 && lines.length > 0) setPaymentModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    total,
    lines,
    itemFunctionsOpen,
    managementOpen,
    transactionOpen,
    otherFunctionsOpen,
    customerModalOpen,
    notesModalOpen,
    customItemModalOpen,
    discountModalOpen,
    helpModalOpen,
    lockedModalOpen,
  ]);

  return (
    <div
      className={`flex flex-col bg-[#e9edf5] text-slate-900 select-none overflow-hidden transition-all duration-200 ${
        isFull
          ? "fixed inset-0 z-[99999] h-screen w-screen p-0 m-0"
          : "h-[calc(100vh-4rem)] max-h-[860px] min-h-[580px] w-full rounded-2xl border border-slate-300 shadow-2xl"
      }`}
    >
      {/* ------------------------------------------------------------- */}
      {/* TOP HEADER BAR (Sale title, mode toggle, action icons)        */}
      {/* ------------------------------------------------------------- */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-blue-900/40 bg-gradient-to-r from-[#17468f] via-[#1e58b0] to-[#17468f] px-3 text-white shadow-md">
        {/* Left: Sale Title & Mode Selector */}
        <div className="flex items-center gap-3">
          <span className="font-display text-xl font-black tracking-wide text-white drop-shadow">Sale</span>

          {/* Screen options: Quick Sale vs Open Invoices */}
          <div className="flex items-center rounded-lg bg-blue-950/40 p-0.5 ring-1 ring-white/20">
            <button
              type="button"
              onClick={() => setMode("QUICK_SALE")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition ${
                mode === "QUICK_SALE"
                  ? "bg-white text-blue-900 shadow-sm"
                  : "text-blue-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon name="bolt" className="h-3.5 w-3.5" />
              Quick sale
            </button>
            <button
              type="button"
              onClick={() => setMode("OPEN_BALANCES")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition ${
                mode === "OPEN_BALANCES"
                  ? "bg-white text-blue-900 shadow-sm"
                  : "text-blue-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon name="receipt" className="h-3.5 w-3.5" />
              Open Balances
              {unpaidCount > 0 && (
                <span className="ml-1 rounded-full bg-amber-400 px-1.5 py-0.2 text-[10px] font-black text-slate-900">
                  {unpaidCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Center / Shop Name */}
        <div className="hidden text-center text-xs font-bold tracking-wider text-blue-200 md:block">
          MARK&apos;S TIRE SHOP &amp; MUFFLER
        </div>

        {/* Right Action Icons (Help, Lock, Drawer, Fullscreen, Logout) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setHelpModalOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-800/60 text-blue-100 transition hover:bg-white/20 hover:text-white"
            title="Help / Shortcuts"
            aria-label="Help"
          >
            <Icon name="question" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setLockedModalOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-800/60 text-blue-100 transition hover:bg-white/20 hover:text-white"
            title="Lock Register"
            aria-label="Lock Register"
          >
            <Icon name="lock" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setManagementOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-800/60 text-blue-100 transition hover:bg-white/20 hover:text-white"
            title="Cash Drawer / Management"
            aria-label="Cash Drawer"
          >
            <Icon name="cash" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition shadow-sm ${
              isFull
                ? "bg-amber-400 text-amber-950 hover:bg-amber-300 ring-2 ring-amber-300"
                : "bg-blue-800/80 text-white hover:bg-white/20 border border-white/20"
            }`}
            title={isFull ? "Exit Fullscreen (Esc or F11)" : "Enter Fullscreen Kiosk Mode (F11)"}
            aria-label="Toggle Fullscreen"
          >
            <Icon name={isFull ? "compress" : "expand"} className="h-4 w-4" />
            <span className="hidden sm:inline">{isFull ? "Exit Fullscreen" : "Full Screen"}</span>
          </button>
          <button
            type="button"
            onClick={signOut}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/80 text-white transition hover:bg-red-600"
            title="Sign Out / Exit"
            aria-label="Sign Out"
          >
            <Icon name="logout" className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* MOBILE TABS SWITCHER (only visible on small screens < 768px)  */}
      {/* ------------------------------------------------------------- */}
      <div className="flex border-b border-slate-300 bg-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("ticket")}
          className={`flex-1 py-2 text-center text-xs font-bold ${
            mobileTab === "ticket" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"
          }`}
        >
          Ticket &amp; Scan ({lines.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("keypad")}
          className={`flex-1 py-2 text-center text-xs font-bold ${
            mobileTab === "keypad" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"
          }`}
        >
          Keypad &amp; Pay ({money(total)})
        </button>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* MAIN REGISTER BODY                                           */}
      {/* ------------------------------------------------------------- */}
      {mode === "QUICK_SALE" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ========================================================= */}
          {/* LEFT PANEL: SCAN INPUT, LINE ITEMS TABLE, TOTALS          */}
          {/* ========================================================= */}
          <div
            className={`flex flex-col border-r border-slate-300 bg-white p-3 min-w-0 md:flex md:flex-1 ${
              mobileTab === "ticket" ? "flex flex-1" : "hidden"
            }`}
          >
            {/* Scan Prompt & Input Bar */}
            <div className="mb-2">
              <label htmlFor="pos-upc-input" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">
                Scan rewards card or scan/key UPC.
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Icon
                    name="scan"
                    className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="pos-upc-input"
                    ref={scanInputRef}
                    type="text"
                    value={upcInput}
                    onChange={(e) => setUpcInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleScanSubmit();
                      }
                    }}
                    placeholder="Scan barcode, enter serial, or type item / service..."
                    className="h-11 w-full rounded-xl border-2 border-slate-300 bg-white pl-10 pr-3 font-mono text-base font-semibold text-ink placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleScanSubmit()}
                  className="rounded-xl bg-brand-600 px-4 text-xs font-bold text-white transition hover:bg-brand-700 active:scale-95"
                >
                  Enter
                </button>
              </div>
            </div>

            {/* Active Keypad Modifier Banner */}
            {activeKeypadTarget !== "scan" && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-1.5 border border-amber-300 text-amber-900 text-xs">
                <span>
                  <strong>Changing {activeKeypadTarget === "quantity" ? "Quantity" : "Price"}</strong> for:{" "}
                  <span className="font-semibold">{selectedLine?.description}</span>
                  {keypadBuffer && <span className="ml-2 font-mono font-bold">New: {keypadBuffer}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveKeypadTarget("scan");
                    setKeypadBuffer("");
                  }}
                  className="font-bold text-amber-800 underline"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Line Items Table with Up/Down Touch Arrows */}
            <div className="relative flex flex-1 min-h-0 flex-row overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50">
              {/* Table Data */}
              <div ref={tableContainerRef} className="flex-1 overflow-y-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 font-bold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="py-2.5 pl-3 pr-2">Description</th>
                      <th className="w-16 py-2.5 px-2 text-center">Qty</th>
                      <th className="w-12 py-2.5 px-2 text-center">Tax</th>
                      <th className="w-24 py-2.5 pl-2 pr-2 text-right">Price</th>
                      <th className="w-10 py-2.5 pr-3 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                          <Icon name="receipt" className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                          <p className="font-medium text-slate-500">Scan rewards card or scan/key UPC.</p>
                          <p className="mt-1 text-xs text-slate-400">
                            Or tap <span className="font-semibold text-brand-600">Item Functions</span> on the right.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      lines.map((line) => {
                        const isSelected = line.key === selectedKey;
                        const price = parseMoney(line.unitPrice) ?? 0;
                        const qty = line.units.length > 0 ? line.units.length : Number(line.quantity) || 1;
                        const lineTotal = price * qty;

                        return (
                          <tr
                            key={line.key}
                            onClick={() => setSelectedKey(line.key)}
                            className={`cursor-pointer transition ${
                              isSelected
                                ? "bg-blue-50/90 text-blue-950 ring-2 ring-inset ring-brand-500"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <td className="py-2.5 pl-3 pr-2">
                              <p className="font-bold text-ink">{line.description}</p>
                              {line.units.length > 0 && (
                                <p className="font-mono text-[10px] text-brand-700">
                                  SN: {line.units.map((u) => u.serialNumber).join(", ")}
                                </p>
                              )}
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const currentDept = line.department || classifyLineDepartment({ description: line.description, lineType: line.lineType });
                                    const nextDept: ShopDepartment = currentDept === "TIRE" ? "MUFFLER" : "TIRE";
                                    updateLine(line.key, { department: nextDept });
                                  }}
                                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-extrabold uppercase transition cursor-pointer ${
                                    (line.department || classifyLineDepartment({ description: line.description, lineType: line.lineType })) === "TIRE"
                                      ? "bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200"
                                      : (line.department || classifyLineDepartment({ description: line.description, lineType: line.lineType })) === "MUFFLER"
                                      ? "bg-blue-100 text-blue-900 border border-blue-300 hover:bg-blue-200"
                                      : "bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
                                  }`}
                                  title="Click to toggle shop assignment (Tires / Mufflers)"
                                >
                                  {(line.department || classifyLineDepartment({ description: line.description, lineType: line.lineType })) === "TIRE"
                                    ? "🛞 Tires"
                                    : (line.department || classifyLineDepartment({ description: line.description, lineType: line.lineType })) === "MUFFLER"
                                    ? "🔧 Mufflers"
                                    : "General"}
                                </button>
                                {line.lineType !== "PART" && (
                                  <span className="inline-block rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-600">
                                    {TYPE_LABELS[line.lineType]}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-center font-mono font-bold text-slate-700">{qty}</td>
                            <td className="py-2.5 px-2 text-center">
                              {line.lineType === "DISCOUNT" ? (
                                <span className="font-semibold text-slate-400">—</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateLine(line.key, { taxable: !(line.taxable ?? true) });
                                  }}
                                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                                    (line.taxable ?? true)
                                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                      : "bg-slate-200 text-slate-500 line-through hover:bg-slate-300"
                                  }`}
                                  title="Click to toggle Tax (Taxable / Exempt)"
                                >
                                  {(line.taxable ?? true) ? "T" : "Exempt"}
                                </button>
                              )}
                            </td>
                            <td className="py-2.5 pl-2 pr-2 text-right font-mono font-extrabold text-ink whitespace-nowrap">
                              {line.lineType === "DISCOUNT" ? "-" : ""}
                              {money(lineTotal)}
                            </td>
                            <td className="py-2.5 pr-2.5 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeLine(line.key);
                                }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                                title="Delete item"
                                aria-label={`Delete ${line.description}`}
                              >
                                <Icon name="trash" className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Up & Down Touch Arrows (matching the photo) */}
              <div className="flex w-10 flex-col justify-center border-l border-slate-200 bg-slate-100 p-1 gap-2">
                <button
                  type="button"
                  onClick={selectPrev}
                  className="flex h-12 w-full items-center justify-center rounded-lg bg-white shadow-sm border border-slate-300 text-slate-700 active:bg-slate-200"
                  aria-label="Previous line"
                >
                  <Icon name="arrowUp" className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={selectNext}
                  className="flex h-12 w-full items-center justify-center rounded-lg bg-white shadow-sm border border-slate-300 text-slate-700 active:bg-slate-200"
                  aria-label="Next line"
                >
                  <Icon name="arrowDown" className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Bottom Row: Customer Pill Button & Totals Summary */}
            <div className="mt-3 flex items-end justify-between border-t border-slate-200 pt-3">
              {/* Customer / Loyalty Pill Button (like 'myWalgreens' in photo) */}
              <div>
                <button
                  type="button"
                  onClick={() => setCustomerModalOpen(true)}
                  className="flex items-center gap-2 rounded-full border-2 border-brand-500 bg-brand-50/70 px-4 py-2 text-xs font-extrabold text-brand-800 shadow-sm transition hover:bg-brand-100"
                >
                  <Icon name="user" className="h-4 w-4 text-brand-600" />
                  <span>{customer.name ? customer.name : "Walk-in Customer"}</span>
                  {vehicle.model && (
                    <span className="font-normal text-slate-500">
                      ({vehicle.year} {vehicle.make} {vehicle.model})
                    </span>
                  )}
                </button>
              </div>

              {/* Financial Totals Summary */}
              <div className="w-56 text-right">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal:</span>
                  <span className="font-mono font-semibold text-slate-700">
                    {preview ? money(preview.subtotal) : "$0.00"}
                  </span>
                </div>
                {(preview?.discountTotal ?? 0) > 0 && (
                  <div className="flex justify-between text-xs text-red-600">
                    <span>Discount:</span>
                    <span className="font-mono font-semibold">-{money(preview!.discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={handleOpenCustomTaxModal}
                    className="flex items-center gap-1 hover:text-brand-700 transition group text-left cursor-pointer"
                    title="Click to configure custom tax or view tax options"
                  >
                    <span className="font-semibold text-slate-700">
                      Tax
                      {customTaxMode === "PERCENT"
                        ? ` (${customTaxPercent}%)`
                        : customTaxMode === "AMOUNT"
                          ? ` (Fixed $${customTaxAmount})`
                          : customTaxMode === "EXEMPT"
                            ? " (0%)"
                            : ""}:
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        customTaxMode === "PERCENT" || customTaxMode === "AMOUNT"
                          ? "bg-amber-100 text-amber-800"
                          : customTaxMode === "EXEMPT"
                            ? "bg-slate-200 text-slate-700"
                            : "text-slate-400 group-hover:text-brand-600 underline font-normal"
                      }`}
                    >
                      {customTaxMode === "DEFAULT" ? "(auto-calculated)" : "custom"}
                    </span>
                  </button>
                  <span className="font-mono font-semibold text-slate-700">
                    {money(displayTaxTotal)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-1">
                  <span className="text-sm font-black uppercase tracking-wider text-slate-800">Total:</span>
                  <span className={`font-display text-2xl font-black tabular-nums text-ink ${previewing ? "opacity-50" : ""}`}>
                    {money(total)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================= */}
          {/* RIGHT PANEL: 4 FUNCTION KEYS, PAYMENT, MODIFIERS, NUMPAD  */}
          {/* ========================================================= */}
          <div
            className={`flex flex-col bg-[#dfe6f2] p-3 w-full md:w-[380px] lg:w-[420px] shrink-0 min-h-0 overflow-y-auto ${
              mobileTab === "keypad" ? "flex" : "hidden md:flex"
            }`}
          >
            {/* Top 4 Function Buttons (2x2 Grid) */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                onClick={() => setItemFunctionsOpen(true)}
                className="h-12 rounded-xl bg-gradient-to-b from-[#1e61bb] to-[#14478f] px-2 font-display text-xs font-bold text-white shadow-md border border-blue-400/30 transition hover:brightness-110 active:scale-98"
              >
                Item Functions
              </button>
              <button
                type="button"
                onClick={() => setManagementOpen(true)}
                className="h-12 rounded-xl bg-gradient-to-b from-[#1e61bb] to-[#14478f] px-2 font-display text-xs font-bold text-white shadow-md border border-blue-400/30 transition hover:brightness-110 active:scale-98"
              >
                Management Functions
              </button>
              <button
                type="button"
                onClick={() => setTransactionOpen(true)}
                className="h-12 rounded-xl bg-gradient-to-b from-[#1e61bb] to-[#14478f] px-2 font-display text-xs font-bold text-white shadow-md border border-blue-400/30 transition hover:brightness-110 active:scale-98"
              >
                Transaction Functions
              </button>
              <button
                type="button"
                onClick={() => setOtherFunctionsOpen(true)}
                className="h-12 rounded-xl bg-gradient-to-b from-[#1e61bb] to-[#14478f] px-2 font-display text-xs font-bold text-white shadow-md border border-blue-400/30 transition hover:brightness-110 active:scale-98"
              >
                Other Functions
              </button>
            </div>

            {/* Big Wide Payment Button */}
            <button
              type="button"
              disabled={lines.length === 0 || total <= 0}
              onClick={() => setPaymentModalOpen(true)}
              className="mb-2 h-14 w-full rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 font-display text-xl font-black text-white shadow-lg border-2 border-emerald-400/40 transition hover:brightness-110 active:scale-98 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed"
            >
              Payment · {money(total)}
            </button>

            {/* Modifier Buttons: Change Quantity, Change Price, Delete Item */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button
                type="button"
                disabled={!selectedKey}
                onClick={() => {
                  if (activeKeypadTarget === "quantity") {
                    setActiveKeypadTarget("scan");
                    setKeypadBuffer("");
                  } else {
                    setActiveKeypadTarget("quantity");
                    setKeypadBuffer(selectedLine?.quantity ?? "1");
                  }
                }}
                className={`h-11 rounded-xl font-display text-xs font-bold transition shadow-sm border ${
                  activeKeypadTarget === "quantity"
                    ? "bg-amber-400 text-amber-950 border-amber-500 ring-2 ring-amber-400"
                    : "bg-white text-slate-800 border-slate-300 hover:bg-slate-100"
                } disabled:opacity-40`}
              >
                Change Qty
              </button>
              <button
                type="button"
                disabled={!selectedKey}
                onClick={() => {
                  if (activeKeypadTarget === "price") {
                    setActiveKeypadTarget("scan");
                    setKeypadBuffer("");
                  } else {
                    setActiveKeypadTarget("price");
                    setKeypadBuffer(selectedLine?.unitPrice ?? "");
                  }
                }}
                className={`h-11 rounded-xl font-display text-xs font-bold transition shadow-sm border ${
                  activeKeypadTarget === "price"
                    ? "bg-amber-400 text-amber-950 border-amber-500 ring-2 ring-amber-400"
                    : "bg-white text-slate-800 border-slate-300 hover:bg-slate-100"
                } disabled:opacity-40`}
              >
                Change Price
              </button>
              <button
                type="button"
                disabled={!selectedKey}
                onClick={() => {
                  if (selectedKey) removeLine(selectedKey);
                }}
                className="h-11 rounded-xl font-display text-xs font-bold transition shadow-sm border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200 disabled:opacity-40 flex items-center justify-center gap-1.5"
                title="Delete selected item from ticket"
              >
                <Icon name="trash" className="h-4 w-4 text-red-600" />
                Delete Item
              </button>
            </div>

            {/* Full On-Screen Touch Keypad (Numpad) */}
            <div className="grid grid-cols-4 grid-rows-4 gap-2 flex-1 min-h-[220px]">
              {/* Row 1 */}
              <button
                type="button"
                onClick={() => handleKeypadPress("7")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                7
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("8")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                8
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("9")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                9
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("CLEAR")}
                className="rounded-2xl bg-rose-50 text-sm font-extrabold text-rose-700 shadow-sm border border-rose-200 transition hover:bg-rose-100 active:bg-rose-200"
              >
                Clear
              </button>

              {/* Row 2 */}
              <button
                type="button"
                onClick={() => handleKeypadPress("4")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                4
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("5")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                5
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("6")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                6
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("BACKSPACE")}
                className="rounded-2xl bg-amber-50 text-xs font-extrabold text-amber-800 shadow-sm border border-amber-200 transition hover:bg-amber-100 active:bg-amber-200"
              >
                Backspace
              </button>

              {/* Row 3 & 4 (Enter spans 2 rows) */}
              <button
                type="button"
                onClick={() => handleKeypadPress("1")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("2")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                2
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("3")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                3
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("ENTER")}
                className="row-span-2 rounded-2xl bg-gradient-to-b from-brand-500 to-brand-700 text-lg font-black text-white shadow-md border border-brand-400/40 transition hover:brightness-110 active:scale-98 flex items-center justify-center"
              >
                Enter
              </button>

              {/* Row 4 */}
              <button
                type="button"
                onClick={() => handleKeypadPress("0")}
                className="rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress(".")}
                className="rounded-2xl bg-white text-xl font-black text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                .
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("00")}
                className="rounded-2xl bg-white text-base font-bold text-slate-800 shadow-sm border border-slate-300 transition hover:bg-blue-50 active:bg-blue-100"
              >
                00
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ========================================================= */
        /* OPEN BALANCES MODE (Collect payment on existing invoices) */
        /* ========================================================= */
        <OpenBalancesRegister
          onSwitchQuickSale={() => setMode("QUICK_SALE")}
          selectedInvoiceId={selectedInvoiceId}
          onSelectInvoiceId={setSelectedInvoiceId}
        />
      )}

      {/* ------------------------------------------------------------- */}
      {/* BOTTOM STATUS BAR (Terminal info, cashier, live clock)        */}
      {/* ------------------------------------------------------------- */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-slate-300 bg-[#ccd7e6] px-3 font-mono text-[11px] text-slate-700">
        <div>
          <span>Terminal #01</span>
          <span className="mx-2">·</span>
          <span>Cashier: {user?.firstName ? `${user.firstName} ${user.lastName}` : "Cashier"}</span>
          <span className="mx-2">·</span>
          <span>Location: {user?.location?.name ?? "Main Shop"}</span>
        </div>
        <div>
          <span className="text-slate-500">WPOS Ver: AutoShop_2.6</span>
          <span className="mx-2">·</span>
          <span className="font-bold text-slate-900">{formatLiveTime(clock)}</span>
        </div>
      </footer>

      {/* ============================================================= */}
      {/* ITEM FUNCTIONS MODAL                                          */}
      {/* ============================================================= */}
      {itemFunctionsOpen && (
        <Modal title="Item Functions &amp; Quick Services" onClose={() => setItemFunctionsOpen(false)} wide>
          <div className="space-y-3">
            {/* Top Toolbar: Search Bar + Inventory Button */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <Icon name="search" className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={presetSearch}
                  onChange={(e) => setPresetSearch(e.target.value)}
                  placeholder="Search quick auto services &amp; parts (e.g. Tire, Muffler, Patch)..."
                  className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50/50 pl-9 pr-8 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                {presetSearch && (
                  <button
                    type="button"
                    onClick={() => setPresetSearch("")}
                    className="absolute inset-y-0 right-2.5 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setItemFunctionsOpen(false);
                    setInventoryPickerOpen(true);
                  }}
                  className="gap-1.5 shadow-2xs font-bold"
                >
                  <Icon name="box" className="h-4 w-4 text-brand-600" />
                  Pick from Inventory
                </Button>
              </div>
            </div>

            {/* Quick Filter Bar: Shop Division + Services/Parts */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-200/80 py-2">
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setPresetShopFilter("ALL")}
                  className={`rounded-md px-3 py-1 font-bold transition ${
                    presetShopFilter === "ALL"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All Divisions ({dynamicPresets.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPresetShopFilter("TIRE")}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 font-bold transition ${
                    presetShopFilter === "TIRE"
                      ? "bg-amber-600 text-white shadow-2xs"
                      : "text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  🛞 Tires Shop
                </button>
                <button
                  type="button"
                  onClick={() => setPresetShopFilter("MUFFLER")}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 font-bold transition ${
                    presetShopFilter === "MUFFLER"
                      ? "bg-blue-600 text-white shadow-2xs"
                      : "text-blue-800 hover:bg-blue-100"
                  }`}
                >
                  🔧 Mufflers Shop
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setPresetTypeFilter("ALL")}
                  className={`rounded-md px-2.5 py-1 font-bold transition ${
                    presetTypeFilter === "ALL"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All Types
                </button>
                <button
                  type="button"
                  onClick={() => setPresetTypeFilter("LABOR")}
                  className={`rounded-md px-2.5 py-1 font-bold transition ${
                    presetTypeFilter === "LABOR"
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  ⚙️ Services
                </button>
                <button
                  type="button"
                  onClick={() => setPresetTypeFilter("PART")}
                  className={`rounded-md px-2.5 py-1 font-bold transition ${
                    presetTypeFilter === "PART"
                      ? "bg-teal-600 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📦 Parts
                </button>
              </div>
            </div>

            {/* Instant Feedback Pill when tapping an item */}
            {lastAddedLabel && (
              <div className="flex items-center justify-between rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm animate-in fade-in slide-in-from-top-1 duration-150">
                <span className="flex items-center gap-1.5">
                  <Icon name="check" className="h-4 w-4" />
                  Added "{lastAddedLabel}" to ticket (+1)
                </span>
                <span className="font-mono text-[11px] opacity-90">
                  Ticket Total: {money(total)}
                </span>
              </div>
            )}

            {/* Loading State */}
            {isLoadingPresets && (
              <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
                <p className="text-sm font-semibold text-slate-700">Loading shop items...</p>
                <p className="text-xs text-slate-400">Fetching services and inventory products from server</p>
              </div>
            )}

            {/* Grid of Items (1-Click Tap to Add) */}
            {!isLoadingPresets && filteredPresets.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 max-h-[56vh] overflow-y-auto pr-1">
                {filteredPresets.map((p) => {
                  const ticketQty = getTicketQuantityForPreset(p);
                  const displayPrice = p.price ?? "0.00";

                  return (
                    <div
                      key={p.label}
                      onClick={() => handleDirectAddItem(p)}
                      className={`group relative flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all cursor-pointer select-none active:scale-[0.98] ${
                        ticketQty > 0
                          ? "border-emerald-500 bg-emerald-50/60 shadow-xs ring-1 ring-emerald-500/30"
                          : "border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50/30 hover:shadow-2xs"
                      }`}
                    >
                      <div>
                        {/* Top Badges & Options Icon */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center gap-1">
                            {p.department && p.department !== "OTHER" && (
                              <span
                                className={`text-[10px] font-extrabold px-1 rounded ${
                                  p.department === "TIRE"
                                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                                    : "bg-blue-100 text-blue-900 border border-blue-300"
                                }`}
                              >
                                {p.department === "TIRE" ? "🛞 Tires" : "🔧 Mufflers"}
                              </span>
                            )}
                            <span className="text-[10px] font-semibold text-slate-500 rounded bg-slate-100 px-1 py-0.5 border border-slate-200">
                              {TYPE_LABELS[p.lineType]}
                            </span>
                          </div>

                          {/* Optional gear icon: click to customize quantity or price before adding */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenItemConfig(p);
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 transition"
                            title="Custom Price or Bulk Quantity"
                          >
                            <Icon name="sliders" className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Item Title */}
                        <p className="font-bold text-slate-900 text-xs leading-snug line-clamp-2">
                          {p.label}
                        </p>
                      </div>

                      {/* Price & Quantity Controls */}
                      <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between gap-1">
                        <span className="font-mono text-sm font-black text-brand-700">
                          ${displayPrice}
                        </span>

                        {ticketQty === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDirectAddItem(p);
                            }}
                            className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs transition group-hover:bg-brand-600 active:scale-95"
                          >
                            <Icon name="plus" className="h-3 w-3" /> Add
                          </button>
                        ) : (
                          <div
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 p-0.5 text-white shadow-2xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleDirectDecrementItem(p)}
                              className="flex h-5 w-5 items-center justify-center rounded bg-emerald-700 text-xs font-bold hover:bg-emerald-800 active:scale-90"
                              title="Reduce quantity by 1"
                            >
                              -
                            </button>
                            <span className="px-1 font-mono text-[11px] font-extrabold">
                              {ticketQty}x
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDirectAddItem(p)}
                              className="flex h-5 w-5 items-center justify-center rounded bg-emerald-700 text-xs font-bold hover:bg-emerald-800 active:scale-90"
                              title="Add 1 more"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty State when shop has no products or services configured in DB */}
            {!isLoadingPresets && dynamicPresets.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 mb-3">
                  <Icon name="box" className="h-6 w-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">No Services or Inventory Items Configured Yet</h3>
                <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-500 leading-relaxed">
                  Items created by the shop owner will automatically appear here. You can configure labor rates in Settings, or add tires and parts in Inventory & Parts Catalog.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setItemFunctionsOpen(false);
                      setCustomItemModalOpen(true);
                    }}
                    className="gap-1.5"
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" /> + Custom Line Item
                  </Button>
                  <Link
                    to="/inventory"
                    onClick={() => setItemFunctionsOpen(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-brand-600"
                  >
                    <Icon name="box" className="h-3.5 w-3.5 text-slate-400" /> Manage Inventory
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setItemFunctionsOpen(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-brand-600"
                  >
                    <Icon name="settings" className="h-3.5 w-3.5 text-slate-400" /> Labor Rates & Services
                  </Link>
                  <Link
                    to="/catalog"
                    onClick={() => setItemFunctionsOpen(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-brand-600"
                  >
                    <Icon name="wrench" className="h-3.5 w-3.5 text-slate-400" /> Parts Catalog
                  </Link>
                </div>
              </div>
            )}

            {/* Empty State when filters don't match */}
            {!isLoadingPresets && dynamicPresets.length > 0 && filteredPresets.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
                <p className="text-sm font-bold text-slate-600">No items match your search or filter</p>
                <p className="text-xs text-slate-400 mt-1">Try clearing the search or switching category filters</p>
                <button
                  type="button"
                  onClick={() => {
                    setPresetSearch("");
                    setPresetShopFilter("ALL");
                    setPresetTypeFilter("ALL");
                  }}
                  className="mt-3 text-xs font-bold text-brand-600 hover:underline"
                >
                  Reset all filters
                </button>
              </div>
            )}

            {/* Bottom Bar: Quick Custom Line, Tax Options, Ticket Subtotal & Done Button */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setItemFunctionsOpen(false);
                    setCustomItemModalOpen(true);
                  }}
                  className="gap-1.5"
                >
                  <Icon name="plus" className="h-3.5 w-3.5" /> + Custom Line Item
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 font-semibold gap-1.5"
                  onClick={() => {
                    setItemFunctionsOpen(false);
                    handleOpenCustomTaxModal();
                  }}
                >
                  <Icon name="tag" className="h-3.5 w-3.5 text-amber-700" />
                  Tax: {customTaxMode === "EXEMPT" ? "Exempt (0%)" : customTaxMode === "PERCENT" ? `${customTaxPercent}%` : customTaxMode === "AMOUNT" ? `$${customTaxAmount}` : "Auto"}
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[11px] text-slate-500 block leading-tight">Current Ticket</span>
                  <span className="font-mono text-sm font-black text-slate-900">
                    {payload.length} {payload.length === 1 ? "item" : "items"} · {money(total)}
                  </span>
                </div>
                <Button
                  variant="primary"
                  className="bg-brand-600 hover:bg-brand-700 text-white font-bold gap-1.5 shadow-sm"
                  onClick={() => setItemFunctionsOpen(false)}
                >
                  <Icon name="check" className="h-4 w-4" />
                  Done (View Ticket)
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* MANAGEMENT FUNCTIONS MODAL                                    */}
      {/* ============================================================= */}
      {managementOpen && (
        <Modal title="Management Functions" onClose={() => setManagementOpen(false)}>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setMode("QUICK_SALE");
                setManagementOpen(false);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-4 font-bold text-blue-900 transition hover:bg-blue-100"
            >
              <Icon name="bolt" className="h-7 w-7 text-blue-700" />
              Quick Sale Mode
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("OPEN_BALANCES");
                setManagementOpen(false);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-900 transition hover:bg-amber-100"
            >
              <Icon name="receipt" className="h-7 w-7 text-amber-700" />
              Open Balances ({unpaidCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setManagementOpen(false);
                navigate("/finance");
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="cash" className="h-7 w-7 text-emerald-600" />
              Till &amp; Cash Sessions
            </button>
            <button
              type="button"
              onClick={() => {
                setManagementOpen(false);
                navigate("/inventory");
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="box" className="h-7 w-7 text-brand-600" />
              Inventory Stock
            </button>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* TRANSACTION FUNCTIONS MODAL                                   */}
      {/* ============================================================= */}
      {transactionOpen && (
        <Modal title="Transaction Functions" onClose={() => setTransactionOpen(false)}>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setTransactionOpen(false);
                setDiscountModalOpen(true);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="tag" className="h-7 w-7 text-purple-600" />
              Apply Discount
            </button>
            <button
              type="button"
              onClick={() => {
                setTransactionOpen(false);
                setNotesModalOpen(true);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="receipt" className="h-7 w-7 text-blue-600" />
              Work Notes (Receipt)
            </button>
            <button
              type="button"
              disabled={!selectedKey}
              onClick={() => {
                if (selectedKey) removeLine(selectedKey);
                setTransactionOpen(false);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800 transition hover:bg-red-100 disabled:opacity-40"
            >
              <Icon name="trash" className="h-7 w-7 text-red-600" />
              Delete Selected Line
            </button>
            <button
              type="button"
              disabled={lines.length === 0}
              onClick={() => {
                setTransactionOpen(false);
                setVoidModalOpen(true);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-40"
            >
              <Icon name="x" className="h-7 w-7 text-slate-600" />
              Void Entire Sale
            </button>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* OTHER FUNCTIONS MODAL                                         */}
      {/* ============================================================= */}
      {otherFunctionsOpen && (
        <Modal title="Other Functions" onClose={() => setOtherFunctionsOpen(false)}>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setOtherFunctionsOpen(false);
                setCustomerModalOpen(true);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="user" className="h-7 w-7 text-brand-600" />
              Customer &amp; Vehicle Info
            </button>
            <button
              type="button"
              onClick={() => {
                setOtherFunctionsOpen(false);
                handleToggleFullscreen();
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name={isFull ? "compress" : "expand"} className="h-7 w-7 text-indigo-600" />
              {isFull ? "Exit Full Screen" : "Full Screen Kiosk Mode"}
            </button>
            {onSwitchClassicView && (
              <button
                type="button"
                onClick={() => {
                  setOtherFunctionsOpen(false);
                  onSwitchClassicView();
                }}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
              >
                <Icon name="board" className="h-7 w-7 text-slate-600" />
                Switch to Classic View
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOtherFunctionsOpen(false);
                setLockedModalOpen(true);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="lock" className="h-7 w-7 text-amber-600" />
              Lock Terminal
            </button>
            <button
              type="button"
              onClick={() => {
                setOtherFunctionsOpen(false);
                navigate("/reports");
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-800 transition hover:bg-slate-100"
            >
              <Icon name="chart" className="h-7 w-7 text-teal-600" />
              Daily Sales Reports
            </button>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* CUSTOMER & VEHICLE MODAL                                      */}
      {/* ============================================================= */}
      {customerModalOpen && (
        <Modal title="Customer & Vehicle" onClose={() => setCustomerModalOpen(false)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Customer Name</span>
                <Input
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  placeholder="Leave blank for Walk-in"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Phone Number</span>
                <Input
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  type="tel"
                  placeholder="(504) 555-0100"
                />
              </label>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Vehicle Info (Optional)</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Input
                  value={vehicle.year}
                  onChange={(e) => setVehicle({ ...vehicle, year: e.target.value.slice(0, 4) })}
                  placeholder="Year"
                />
                <Input
                  value={vehicle.make}
                  onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })}
                  placeholder="Make"
                />
                <Input
                  value={vehicle.model}
                  onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })}
                  placeholder="Model"
                />
                <Input
                  value={vehicle.plate}
                  onChange={(e) => setVehicle({ ...vehicle, plate: e.target.value.toUpperCase() })}
                  placeholder="Plate #"
                />
                <Input
                  value={vehicle.mileage}
                  onChange={(e) => setVehicle({ ...vehicle, mileage: e.target.value })}
                  placeholder="Mileage"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="secondary" onClick={() => setCustomerModalOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* WORK NOTES MODAL                                              */}
      {/* ============================================================= */}
      {notesModalOpen && (
        <Modal title="Work Notes" onClose={() => setNotesModalOpen(false)}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">These notes will be printed on the customer receipt.</p>
            <textarea
              className="h-28 w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Replaced rusted muffler & hanger. Checked for leaks."
              autoFocus
            />
            <div className="flex justify-end">
              <Button onClick={() => setNotesModalOpen(false)}>Save Notes</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* CUSTOM ITEM MODAL                                             */}
      {/* ============================================================= */}
      {/* ============================================================= */}
      {/* CONFIGURE ITEM MODAL (Quantity, Price & Tax Option)           */}
      {/* ============================================================= */}
      {itemConfigOpen && selectedPreset && (
        <Modal
          title={`Add to Ticket: ${selectedPreset.label}`}
          onClose={() => setItemConfigOpen(false)}
        >
          <div className="space-y-4">
            {/* Header pill with item category */}
            <div className="flex items-center justify-between rounded-xl bg-slate-100 p-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">{selectedPreset.label}</h4>
                <p className="text-xs text-slate-500">
                  Category: <span className="font-semibold text-slate-700">{TYPE_LABELS[selectedPreset.lineType]}</span>
                </p>
              </div>
              <span className="font-mono text-sm font-extrabold text-brand-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                Preset: ${selectedPreset.price}
              </span>
            </div>

            {/* 1. QUANTITY SELECTOR */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <label className="block text-xs font-bold text-slate-700">Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setItemConfigQty(String(Math.max(1, (Number(itemConfigQty) || 1) - 1)))}
                  className="h-10 w-11 rounded-xl border border-slate-300 bg-white font-display text-lg font-bold text-slate-800 shadow-2xs hover:bg-slate-100 active:scale-95 flex items-center justify-center"
                >
                  -
                </button>
                <Input
                  type="number"
                  min="1"
                  value={itemConfigQty}
                  onChange={(e) => setItemConfigQty(e.target.value)}
                  className="h-10 text-center font-mono text-base font-bold"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setItemConfigQty(String((Number(itemConfigQty) || 1) + 1))}
                  className="h-10 w-11 rounded-xl border border-slate-300 bg-white font-display text-lg font-bold text-slate-800 shadow-2xs hover:bg-slate-100 active:scale-95 flex items-center justify-center"
                >
                  +
                </button>
              </div>
              <div className="flex gap-1.5 pt-1">
                {["1", "2", "3", "4", "8"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setItemConfigQty(q)}
                    className={`flex-1 rounded-lg border py-1 text-xs font-bold transition ${
                      itemConfigQty === q
                        ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-400"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {q}x
                  </button>
                ))}
              </div>
            </div>

            {/* 2. PRICE SELECTOR */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-700">Unit Price ($)</label>
                {itemConfigPrice !== selectedPreset.price && (
                  <button
                    type="button"
                    onClick={() => setItemConfigPrice(selectedPreset.price ?? "0.00")}
                    className="text-[11px] font-bold text-brand-600 hover:underline"
                  >
                    Reset to Default (${selectedPreset.price})
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-slate-400">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={itemConfigPrice}
                  onChange={(e) => setItemConfigPrice(e.target.value)}
                  placeholder={selectedPreset.price}
                  className="pl-7 font-mono font-bold"
                />
              </div>
            </div>

            {/* 3. TAX OPTION */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <label className="block text-xs font-bold text-slate-700">Tax Option</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setItemConfigTaxable(true)}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition ${
                    itemConfigTaxable
                      ? "border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon name="check" className={`h-4 w-4 ${itemConfigTaxable ? "text-emerald-700" : "text-slate-400"}`} />
                  <div className="text-left">
                    <span className="block font-bold">Taxable</span>
                    <span className="block text-[10px] font-normal text-emerald-700">Sales tax applies</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setItemConfigTaxable(false)}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition ${
                    !itemConfigTaxable
                      ? "border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon name="x" className={`h-4 w-4 ${!itemConfigTaxable ? "text-amber-700" : "text-slate-400"}`} />
                  <div className="text-left">
                    <span className="block font-bold">Non-Taxable</span>
                    <span className="block text-[10px] font-normal text-amber-700">Tax-exempt (0%)</span>
                  </div>
                </button>
              </div>
            </div>

            {/* LIVE LINE TOTAL PREVIEW */}
            {(() => {
              const q = Number(itemConfigQty) || 1;
              const p = parseMoney(itemConfigPrice) ?? 0;
              const lineSubtotal = q * p;
              return (
                <div className="rounded-xl border border-slate-200 bg-slate-900 p-3 text-xs text-white">
                  <div className="flex justify-between py-1 text-slate-300">
                    <span>
                      {q} × {money(p)}:
                    </span>
                    <span className="font-mono font-semibold">{money(lineSubtotal)}</span>
                  </div>
                  <div className="flex justify-between py-1 text-slate-400">
                    <span>Tax Option:</span>
                    <span className={`font-semibold ${itemConfigTaxable ? "text-emerald-400" : "text-amber-400"}`}>
                      {itemConfigTaxable ? "Taxable (sales tax added)" : "Exempt ($0.00)"}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-700 pt-2 font-display text-sm font-black text-white">
                    <span>Line Total:</span>
                    <span className="font-mono text-emerald-400">{money(lineSubtotal)}</span>
                  </div>
                </div>
              );
            })()}

            {/* ACTION BUTTONS */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setItemConfigOpen(false)}>
                Cancel
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => handleConfirmAddPreset(false)}
                  title="Add to sale and remain in Item Functions to add another item"
                >
                  + Add &amp; Keep Selecting
                </Button>
                <Button
                  variant="primary"
                  className="bg-brand-600 hover:bg-brand-700 text-white font-bold gap-1.5 shadow-sm"
                  onClick={() => handleConfirmAddPreset(true)}
                >
                  <Icon name="check" className="h-4 w-4" />
                  Add to Ticket ({money((Number(itemConfigQty) || 1) * (parseMoney(itemConfigPrice) ?? 0))})
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* CUSTOM ITEM MODAL                                             */}
      {/* ============================================================= */}
      {customItemModalOpen && (
        <Modal title="Add Custom Item" onClose={() => setCustomItemModalOpen(false)}>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Description</span>
              <Input
                value={customItem.description}
                onChange={(e) => setCustomItem({ ...customItem, description: e.target.value })}
                placeholder="Item or service name"
                autoFocus
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Type</span>
                <Select
                  value={customItem.lineType}
                  onChange={(e) => setCustomItem({ ...customItem, lineType: e.target.value as LineType })}
                >
                  <option value="LABOR">Service / Labor</option>
                  <option value="PART">Part</option>
                  <option value="FEE">Shop Fee</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Unit Price ($)</span>
                <Input
                  value={customItem.price}
                  onChange={(e) => setCustomItem({ ...customItem, price: e.target.value })}
                  placeholder="0.00"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Quantity</span>
                <Input
                  type="number"
                  min="1"
                  value={customItem.quantity}
                  onChange={(e) => setCustomItem({ ...customItem, quantity: e.target.value })}
                  placeholder="1"
                />
              </label>
              <div>
                <span className="mb-1 block text-xs font-bold text-slate-600">Tax Option</span>
                <div className="grid grid-cols-2 gap-1 h-9">
                  <button
                    type="button"
                    onClick={() => setCustomItem({ ...customItem, taxable: true })}
                    className={`rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1 ${
                      customItem.taxable
                        ? "border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Taxable
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomItem({ ...customItem, taxable: false })}
                    className={`rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1 ${
                      !customItem.taxable
                        ? "border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Exempt
                  </button>
                </div>
              </div>
            </div>

            {/* Shop Division Selector */}
            <div>
              <span className="mb-1 block text-xs font-bold text-slate-600">Shop Division Attribution</span>
              <div className="grid grid-cols-2 gap-2 h-9">
                <button
                  type="button"
                  onClick={() => setCustomItem({ ...customItem, department: "TIRE" })}
                  className={`rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    customItem.department === "TIRE"
                      ? "border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  🛞 Tires Shop
                </button>
                <button
                  type="button"
                  onClick={() => setCustomItem({ ...customItem, department: "MUFFLER" })}
                  className={`rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    customItem.department === "MUFFLER"
                      ? "border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-400"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  🔧 Mufflers Shop
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="secondary" onClick={() => setCustomItemModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!customItem.description.trim()}
                onClick={() => {
                  const nl = blankLine({
                    description: customItem.description.trim(),
                    lineType: customItem.lineType,
                    quantity: customItem.quantity.trim() || "1",
                    unitPrice: customItem.price.trim(),
                    taxable: customItem.taxable,
                    department: customItem.department || classifyTextDepartment(customItem.description),
                  });
                  setLines((ls) => [...ls, nl]);
                  setSelectedKey(nl.key);
                  setCustomItem({
                    description: "",
                    price: "",
                    quantity: "1",
                    taxable: true,
                    lineType: "LABOR",
                    department: "TIRE",
                  });
                  setCustomItemModalOpen(false);
                }}
              >
                Add Item
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* CUSTOM TAX MODAL                                              */}
      {/* ============================================================= */}
      {customTaxModalOpen && (
        <Modal title="Custom Tax Option" onClose={() => setCustomTaxModalOpen(false)} wide>
          <div className="space-y-4">
            {/* Quick status & current subtotal banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 shadow-2xs">
                  <Icon name="tag" className="h-5 w-5" />
                </span>
                <div>
                  <h4 className="text-sm font-bold text-amber-950">Configure Custom Sales Tax</h4>
                  <p className="text-xs text-amber-800">
                    Apply a custom tax percentage or fixed dollar amount to this ticket.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-amber-300/60 bg-white px-3.5 py-2 text-right shadow-2xs">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Ticket Subtotal
                </span>
                <span className="font-mono text-base font-extrabold text-slate-800">
                  {money(itemsSubtotalCents)}
                </span>
              </div>
            </div>

            {/* Mode selection tabs */}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">Tax Calculation Method</label>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setModalTaxMode("PERCENT")}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition ${
                    modalTaxMode === "PERCENT"
                      ? "bg-white text-brand-800 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span className="text-base font-extrabold">%</span> Custom Percentage Rate
                </button>
                <button
                  type="button"
                  onClick={() => setModalTaxMode("AMOUNT")}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition ${
                    modalTaxMode === "AMOUNT"
                      ? "bg-white text-brand-800 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span className="text-base font-extrabold">$</span> Fixed Dollar Amount
                </button>
              </div>
            </div>

            {/* Input fields according to mode */}
            {modalTaxMode === "PERCENT" ? (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-700">Custom Tax Rate (%)</span>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={modalTaxPercent}
                      onChange={(e) => setModalTaxPercent(e.target.value)}
                      placeholder="e.g. 9.45"
                      autoFocus
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-bold text-slate-400">
                      %
                    </span>
                  </div>
                </label>

                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Quick Rate Presets
                  </span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {[
                      { label: "0% (Exempt)", val: "0" },
                      { label: "4.00%", val: "4.00" },
                      { label: "5.00%", val: "5.00" },
                      { label: "8.25%", val: "8.25" },
                      { label: "9.45% (Std)", val: "9.45" },
                      { label: "10.00%", val: "10.00" },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setModalTaxPercent(p.val)}
                        className={`rounded-lg border px-2 py-1.5 text-center text-xs font-bold transition ${
                          modalTaxPercent === p.val
                            ? "border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-700">Fixed Tax Amount ($)</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-slate-400">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={modalTaxAmount}
                      onChange={(e) => setModalTaxAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                      autoFocus
                    />
                  </div>
                </label>

                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Quick Amount Presets
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "$0.00 (Exempt)", val: "0.00" },
                      { label: "$5.00", val: "5.00" },
                      { label: "$10.00", val: "10.00" },
                      { label: "$25.00", val: "25.00" },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setModalTaxAmount(p.val)}
                        className={`rounded-lg border px-2 py-1.5 text-center text-xs font-bold transition ${
                          modalTaxAmount === p.val
                            ? "border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Explanatory note */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900 flex items-center gap-2">
              <Icon name="check" className="h-4 w-4 text-blue-700 shrink-0" />
              <span>
                <strong>Tax is applied directly to the sale total</strong> — it will not be added as a product or service line item on the ticket.
              </span>
            </div>

            {/* Live calculation breakdown */}
            <div className="rounded-xl border border-slate-200 bg-slate-900 p-3.5 text-xs text-white">
              <div className="flex justify-between py-1 text-slate-300">
                <span>Items Subtotal:</span>
                <span className="font-mono font-semibold">{money(itemsSubtotalCents)}</span>
              </div>
              <div className="flex justify-between py-1 text-amber-400 font-bold">
                <span>
                  Custom Tax (
                  {modalTaxMode === "PERCENT"
                    ? `${parseFloat(modalTaxPercent) || 0}%`
                    : "Fixed Amount"}
                  ):
                </span>
                <span className="font-mono">+{money(modalCalculatedTaxCents)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-700 pt-2 font-display text-sm font-black text-white">
                <span>Total Due:</span>
                <span className="font-mono text-emerald-400">
                  {money(itemsSubtotalCents + modalCalculatedTaxCents)}
                </span>
              </div>
            </div>

            {/* Footer action buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleResetToAutoTax}
                  title="Restore organization standard auto calculation"
                >
                  Reset to Auto-Tax
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSetTaxExempt}
                  className="text-slate-700"
                >
                  Set Tax-Exempt (0%)
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setCustomTaxModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm font-bold"
                  onClick={handleApplyCustomTax}
                >
                  <Icon name="check" className="h-4 w-4" />
                  Apply Custom Tax ({money(modalCalculatedTaxCents)})
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* DISCOUNT MODAL                                                */}
      {/* ============================================================= */}
      {discountModalOpen && (
        <Modal title="Apply Discount" onClose={() => setDiscountModalOpen(false)}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Enter discount dollar amount:</p>
            <Input
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="e.g. 10.00"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDiscountModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!discountAmount.trim() || Number(discountAmount) <= 0}
                onClick={() => {
                  const nl = blankLine({
                    description: `Discount ($${discountAmount})`,
                    lineType: "DISCOUNT",
                    quantity: "1",
                    unitPrice: discountAmount.trim(),
                  });
                  setLines((ls) => [...ls, nl]);
                  setSelectedKey(nl.key);
                  setDiscountAmount("");
                  setDiscountModalOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* VOID SALE CONFIRMATION MODAL                                  */}
      {/* ============================================================= */}
      {voidModalOpen && (
        <Modal title="Void Entire Sale" onClose={() => setVoidModalOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 shadow-2xs">
                <Icon name="trash" className="h-5 w-5" />
              </span>
              <div>
                <h4 className="text-sm font-bold text-red-950">Are you sure you want to void this sale?</h4>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  This will clear all <strong>{lines.length} item{lines.length === 1 ? "" : "s"}</strong> (worth{" "}
                  <strong>{money(total)}</strong>), customer information, and vehicle details currently on the register.
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <div className="flex justify-between py-1 text-slate-600">
                <span>Items on Ticket:</span>
                <span className="font-semibold text-slate-900">{lines.length}</span>
              </div>
              {customer.name && (
                <div className="flex justify-between py-1 text-slate-600">
                  <span>Customer:</span>
                  <span className="font-semibold text-slate-900">{customer.name}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                <span>Total Amount:</span>
                <span className="font-mono text-sm">{money(total)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="secondary" onClick={() => setVoidModalOpen(false)}>
                Cancel / Keep Ticket
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setLines([]);
                  setSelectedKey(null);
                  setCustomer({ name: "", phone: "" });
                  setVehicle({ year: "", make: "", model: "", plate: "", mileage: "" });
                  setNotes("");
                  setVoidModalOpen(false);
                }}
                className="gap-1.5"
              >
                <Icon name="trash" className="h-4 w-4" />
                Void and Clear Ticket
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* PAYMENT MODAL (Tender cash, card, calculate change)           */}
      {/* ============================================================= */}
      {paymentModalOpen && (
        <Modal title="Payment / Checkout" onClose={() => setPaymentModalOpen(false)} wide>
          <div className="space-y-4">
            {/* Clear reassurance banner: Direct payment tender, no gateway needed */}
            <div className="flex items-center justify-between rounded-xl bg-blue-50/80 border border-blue-200 px-3.5 py-2 text-xs">
              <span className="font-bold text-blue-900 flex items-center gap-1.5">
                <Icon name="cash" className="h-4 w-4 text-blue-700" />
                Select Customer Payment Method
              </span>
              <span className="text-[11px] font-semibold text-blue-700">
                Direct / Manual Tender · No Online Gateway Required
              </span>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-slate-900 p-4 text-white shadow-inner">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Due</p>
                <p className="font-display text-4xl font-black tabular-nums text-white">{money(total)}</p>
              </div>
              {payMethod === "CASH" && (
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Change Due</p>
                  <p
                    className={`font-display text-4xl font-black tabular-nums ${
                      payChange !== null && payChange >= 0 ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {payChange !== null && payChange >= 0 ? money(payChange) : "—"}
                  </p>
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["CASH", "Cash", "cash"],
                  ["CARD_EXTERNAL", "Card (Debit/Credit)", "card"],
                  ["CHECK", "Check", "receipt"],
                  ["LATER", "Pay Later", "clock"],
                ] as Array<[PayMethod, string, string]>
              ).map(([m, label, icon]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMethod(m)}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-display text-sm font-bold transition ${
                    payMethod === m
                      ? "border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-500 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Icon name={icon} className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Cash Options: Quick Bills & Change Calculator */}
            {payMethod === "CASH" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Quick Cash Tender:</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTenderedInput((total / 100).toFixed(2))}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100"
                    >
                      Exact
                    </button>
                    {[20, 50, 100].map((bill) => (
                      <button
                        key={bill}
                        type="button"
                        onClick={() => setTenderedInput(String(bill))}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100"
                      >
                        ${bill}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const nextTen = Math.ceil(total / 1000) * 10;
                        setTenderedInput(String(nextTen));
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100"
                    >
                      Next $10
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-600">Cash Received ($)</span>
                    <Input
                      value={tenderedInput}
                      onChange={(e) => setTenderedInput(e.target.value)}
                      className="font-mono text-lg font-bold"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-600">Amount Charged ($)</span>
                    <Input
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="font-mono text-lg font-bold"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Card Options (Physical card machine / chip / swipe recorded directly) */}
            {payMethod === "CARD_EXTERNAL" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">Card Payment (Swipe / Chip / Terminal)</span>
                  <span className="text-[11px] text-emerald-700 font-semibold">Processed on shop terminal</span>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">
                    Card Reference / Last 4 Digits / Auth Code (Optional)
                  </span>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. Visa 4091 or Auth #98124"
                    maxLength={50}
                  />
                </label>
              </div>
            )}

            {/* Check Options */}
            {payMethod === "CHECK" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">
                    Check Number / Issuer (Optional)
                  </span>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. Check #1042"
                    maxLength={50}
                  />
                </label>
              </div>
            )}

            {/* Pay Later / Customer Account */}
            {payMethod === "LATER" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Icon name="clock" className="h-4 w-4 text-amber-700" />
                  Customer Account Balance (Pay Later)
                </p>
                <p className="text-amber-800">
                  This ticket will be recorded under <strong>Open Balances</strong>. No payment is collected today; payment can be applied at any time later.
                </p>
              </div>
            )}

            <ErrorBanner error={quickSaleMutation.error} />

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="secondary" onClick={() => setPaymentModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="success"
                size="lg"
                loading={quickSaleMutation.isPending}
                disabled={
                  quickSaleMutation.isPending ||
                  (payMethod === "CASH" && (payTendered === null || payTendered < (payAmount ?? 0)))
                }
                onClick={() => quickSaleMutation.mutate()}
              >
                <Icon name="printer" className="h-5 w-5" />
                Complete Sale &amp; Print Receipt
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================= */}
      {/* SERIALIZED INVENTORY PICKER MODAL                             */}
      {/* ============================================================= */}
      {inventoryPickerOpen && (
        <InventoryPickerModal
          taken={new Set(lines.flatMap((l) => l.units.map((u) => u.id)))}
          onClose={() => setInventoryPickerOpen(false)}
          onAdd={(product, units) => {
            const desc = [product.brand, product.name, product.size].filter(Boolean).join(" ");
            const dept: ShopDepartment =
              product.kind === "TIRE"
                ? "TIRE"
                : product.kind === "MUFFLER"
                ? "MUFFLER"
                : classifyTextDepartment(desc);
            setLines((ls) => [
              ...ls,
              blankLine({
                lineType: "PART",
                description: desc,
                unitPrice: product.priceCents ? (product.priceCents / 100).toFixed(2) : "",
                units,
                department: dept,
              }),
            ]);
            setInventoryPickerOpen(false);
          }}
        />
      )}

      {/* ============================================================= */}
      {/* TERMINAL LOCK MODAL                                           */}
      {/* ============================================================= */}
      {lockedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Icon name="lock" className="h-7 w-7" />
            </span>
            <h2 className="mt-3 font-display text-xl font-bold text-ink">Terminal Locked</h2>
            <p className="mt-1 text-xs text-slate-500">
              Signed in as {user?.firstName} {user?.lastName}
            </p>
            <div className="mt-6">
              <Button className="w-full" size="lg" onClick={() => setLockedModalOpen(false)}>
                Unlock Register
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* SHORTCUTS / HELP MODAL                                        */}
      {/* ============================================================= */}
      {helpModalOpen && (
        <Modal title="Terminal Shortcuts & Tips" onClose={() => setHelpModalOpen(false)}>
          <div className="space-y-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Touch &amp; Keyboard Shortcuts:</p>
            <ul className="list-disc space-y-1.5 pl-4">
              <li><strong className="text-ink">Scan / UPC:</strong> Type barcode or serial, then tap Enter.</li>
              <li><strong className="text-ink">Change Quantity / Price:</strong> Tap button, enter number on keypad, tap Enter.</li>
              <li><strong className="text-ink">Up / Down Arrows:</strong> Scroll or move selection across ticket items.</li>
              <li><strong className="text-ink">F1:</strong> Item Functions (presets &amp; inventory)</li>
              <li><strong className="text-ink">F2:</strong> Management Functions</li>
              <li><strong className="text-ink">F3:</strong> Transaction Functions</li>
              <li><strong className="text-ink">F12 / Ctrl+P:</strong> Quick Checkout &amp; Pay</li>
            </ul>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: Open Balances View inside the same Elo Terminal
// ---------------------------------------------------------------------------

function OpenBalancesRegister({
  onSwitchQuickSale,
  selectedInvoiceId,
  onSelectInvoiceId,
}: {
  onSwitchQuickSale: () => void;
  selectedInvoiceId: string | null;
  onSelectInvoiceId: (id: string | null) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [shopFilter, setShopFilter] = useState<"ALL" | "TIRE" | "MUFFLER">("ALL");

  const unpaid = useQuery({
    queryKey: ["invoices", "unpaid"],
    queryFn: () => api.get<{ data: Invoice[] }>("/invoices?unpaid=true"),
    refetchInterval: 30_000,
  });

  const drafts = useQuery({
    queryKey: ["invoices", "drafts"],
    queryFn: () => api.get<{ data: Invoice[] }>("/invoices?status=DRAFT"),
  });

  const getInvDept = (inv: Invoice): ShopDepartment => {
    if (inv.lines && inv.lines.length > 0) {
      let tireLines = 0;
      let mufflerLines = 0;
      for (const l of inv.lines) {
        const dept = classifyLineDepartment({ description: l.description, lineType: l.lineType });
        if (dept === "TIRE") tireLines++;
        else if (dept === "MUFFLER") mufflerLines++;
      }
      if (tireLines > 0 && mufflerLines === 0) return "TIRE";
      if (mufflerLines > 0 && tireLines === 0) return "MUFFLER";
    }
    return classifyTextDepartment(`${inv.notes || ""} ${inv.repairOrder?.number || ""}`);
  };

  const match = (inv: Invoice) => {
    if (shopFilter !== "ALL" && getInvDept(inv) !== shopFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      inv.number.toLowerCase().includes(q) ||
      customerLabel(inv.customer).toLowerCase().includes(q) ||
      (inv.repairOrder?.number ?? "").toLowerCase().includes(q)
    );
  };

  const activeInv = unpaid.data?.data.find((i) => i.id === selectedInvoiceId) ?? unpaid.data?.data[0];

  const balance = activeInv ? activeInv.total - activeInv.amountPaid - activeInv.amountCredited : 0;
  const [payMethod, setPayMethod] = useState<PayMethod>("CASH");
  const [tenderedInput, setTenderedInput] = useState("");
  const [amountInput, setAmountInput] = useState("");

  useEffect(() => {
    if (balance > 0) {
      setAmountInput((balance / 100).toFixed(2));
      setTenderedInput((balance / 100).toFixed(2));
    }
  }, [balance]);

  const amt = parseMoney(amountInput);
  const tend = payMethod === "CASH" && tenderedInput.trim() ? parseMoney(tenderedInput) : null;
  const chg = tend !== null && amt !== null ? tend - amt : null;

  const payMutation = useMutation({
    mutationFn: () =>
      api.post("/payments/manual", {
        invoiceId: activeInv!.id,
        amount: amt,
        method: payMethod,
        idempotencyKey: newIdempotencyKey(),
        tendered: tend ?? undefined,
        cancelOpenAttempt: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/receipts/${activeInv!.id}?print=1`);
    },
  });

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: Unpaid Invoices list */}
      <div className="flex flex-1 flex-col border-r border-slate-300 bg-white p-3 min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, customer name, or job..."
            className="h-10 text-sm"
          />
          <button
            type="button"
            onClick={onSwitchQuickSale}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700"
          >
            <Icon name="plus" className="h-4 w-4" /> Quick Sale
          </button>
        </div>

        {/* Shop Division Filter Bar */}
        <div className="mb-2 flex items-center justify-between gap-1 border-b border-slate-200 pb-2">
          <span className="text-[11px] font-bold text-slate-500">Shop Division:</span>
          <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setShopFilter("ALL")}
              className={`rounded-md px-2.5 py-0.5 font-bold transition ${
                shopFilter === "ALL" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setShopFilter("TIRE")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 font-bold transition ${
                shopFilter === "TIRE" ? "bg-amber-600 text-white shadow-2xs" : "text-amber-800 hover:bg-amber-100"
              }`}
            >
              🛞 Tires
            </button>
            <button
              type="button"
              onClick={() => setShopFilter("MUFFLER")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 font-bold transition ${
                shopFilter === "MUFFLER" ? "bg-blue-600 text-white shadow-2xs" : "text-blue-800 hover:bg-blue-100"
              }`}
            >
              🔧 Mufflers
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          <DataState
            loading={unpaid.isLoading}
            error={unpaid.error}
            empty={(unpaid.data?.data.filter(match).length ?? 0) === 0}
            emptyMessage="No outstanding balances waiting to be paid."
          >
            {unpaid.data?.data.filter(match).map((inv) => {
              const isSelected = inv.id === activeInv?.id;
              const invBal = inv.balance ?? inv.total - inv.amountPaid;
              const dept = getInvDept(inv);
              return (
                <div
                  key={inv.id}
                  onClick={() => onSelectInvoiceId(inv.id)}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 transition ${
                    isSelected ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-ink truncate">{customerLabel(inv.customer)}</p>
                      <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border ${
                        dept === "TIRE"
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : dept === "MUFFLER"
                          ? "bg-blue-100 text-blue-900 border-blue-300"
                          : "bg-slate-100 text-slate-700 border-slate-300"
                      }`}>
                        {dept === "TIRE" ? "🛞 Tires" : dept === "MUFFLER" ? "🔧 Mufflers" : "General"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Invoice #{inv.number} {inv.repairOrder && `· Job #${inv.repairOrder.number}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-black text-ink tabular-nums">{money(invBal)}</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">DUE</span>
                  </div>
                </div>
              );
            })}
          </DataState>
        </div>
      </div>

      {/* Right: Payment collector */}
      <div className="flex flex-col bg-[#dfe6f2] p-3 w-full md:w-[380px] lg:w-[420px] shrink-0 min-h-0 overflow-y-auto">
        {activeInv ? (
          <div className="flex flex-col h-full space-y-4">
            <div className="rounded-2xl bg-ink p-4 text-white shadow-lift">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Balance Due</p>
              <p className="font-display text-4xl font-black tabular-nums">{money(balance)}</p>
              <p className="mt-1 text-xs text-slate-400">
                Customer: <span className="font-semibold text-white">{customerLabel(activeInv.customer)}</span>
              </p>
            </div>

            <ErrorBanner error={payMutation.error} />

            {/* Pay Methods */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["CASH", "Cash", "cash"],
                  ["CARD_EXTERNAL", "Card", "card"],
                  ["CHECK", "Check", "receipt"],
                  ["OTHER", "Other", "more"],
                ] as Array<[PayMethod, string, string]>
              ).map(([m, label, icon]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMethod(m)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold ${
                    payMethod === m
                      ? "border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-500"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  <Icon name={icon} className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {payMethod === "CASH" && (
              <div className="space-y-2 rounded-xl border border-slate-300 bg-white p-3">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span>Cash Received:</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setTenderedInput((balance / 100).toFixed(2))}
                      className="rounded bg-slate-100 px-2 py-1 text-[11px]"
                    >
                      Exact
                    </button>
                    {[20, 50, 100].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setTenderedInput(String(b))}
                        className="rounded bg-slate-100 px-2 py-1 text-[11px]"
                      >
                        ${b}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  value={tenderedInput}
                  onChange={(e) => setTenderedInput(e.target.value)}
                  className="font-mono text-base font-bold"
                />
                <div className="flex justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="font-semibold text-slate-600">Change Due:</span>
                  <span className="font-display font-black text-emerald-700 text-sm">
                    {chg !== null && chg >= 0 ? money(chg) : "—"}
                  </span>
                </div>
              </div>
            )}

            <Button
              size="xl"
              variant="success"
              loading={payMutation.isPending}
              disabled={payMutation.isPending || (payMethod === "CASH" && (tend === null || tend < (amt ?? 0)))}
              onClick={() => payMutation.mutate()}
              className="mt-auto"
            >
              <Icon name="cash" className="h-5 w-5" />
              Collect {money(amt ?? balance)}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 p-6">
            <Icon name="receipt" className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm font-semibold">Select an invoice on the left to collect payment</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: Inventory Picker Modal (pick tires / mufflers / parts)
// ---------------------------------------------------------------------------

function InventoryPickerModal({
  taken,
  onClose,
  onAdd,
}: {
  taken: Set<string>;
  onClose: () => void;
  onAdd: (product: AvailableProduct, units: Array<{ id: string; serialNumber: string }>) => void;
}) {
  const [kind, setKind] = useState<InventoryKind | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<{ productId: string; ids: Set<string> } | null>(null);

  const available = useQuery({
    queryKey: ["inventory", "available", kind, q],
    queryFn: () =>
      api.get<{ data: AvailableProduct[] }>(
        `/inventory/available?${new URLSearchParams({ ...(kind !== "ALL" ? { kind } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`,
      ),
  });

  const products = available.data?.data ?? [];

  function toggle(productId: string, unitId: string) {
    setSelected((s) => {
      const ids = s?.productId === productId ? new Set(s.ids) : new Set<string>();
      if (ids.has(unitId)) ids.delete(unitId);
      else ids.add(unitId);
      return ids.size ? { productId, ids } : null;
    });
  }

  const chosenProduct = products.find((p) => p.id === selected?.productId);

  return (
    <Modal title="Pick from Inventory" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["ALL", "TIRE", "MUFFLER", "OTHER"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                kind === k ? "bg-ink text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {k === "ALL" ? "All Parts" : k === "TIRE" ? "Tires" : k === "MUFFLER" ? "Mufflers" : "Other"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon name="scan" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search size, brand, or serial..."
            className="pl-10"
            autoFocus
          />
        </div>

        <DataState loading={available.isLoading} error={available.error} empty={products.length === 0} emptyMessage="Nothing in stock matches.">
          <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {products.map((p) => {
              const free = p.units.filter((u) => !taken.has(u.id));
              return (
                <li
                  key={p.id}
                  className={`rounded-xl border p-3 ${
                    selected?.productId === p.id ? "border-brand-500 bg-brand-50/50" : "border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-ink">
                        {[p.brand, p.name].filter(Boolean).join(" ")}
                        {p.size && <span className="ml-2 font-mono text-xs font-semibold text-slate-600">{p.size}</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {free.length} in stock · {money(p.priceCents)} each
                      </p>
                    </div>
                    {free.length > 0 && (
                      <button
                        type="button"
                        className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100"
                        onClick={() => {
                          const current = selected?.productId === p.id ? selected.ids.size : 0;
                          const next = free.slice(0, Math.min(free.length, current + 1)).map((u) => u.id);
                          setSelected({ productId: p.id, ids: new Set(next) });
                        }}
                      >
                        + Add One
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {free.map((u) => {
                      const on = selected?.productId === p.id && selected.ids.has(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggle(p.id, u.id)}
                          className={`rounded-md px-2 py-1 font-mono text-[11px] font-bold ${
                            on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {u.serialNumber}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </DataState>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            {selected && chosenProduct ? `${selected.ids.size} item(s) selected` : "Tap serial numbers to select."}
          </p>
          <Button
            disabled={!selected || !chosenProduct}
            onClick={() =>
              chosenProduct &&
              selected &&
              onAdd(
                chosenProduct,
                chosenProduct.units
                  .filter((u) => selected.ids.has(u.id))
                  .map((u) => ({ id: u.id, serialNumber: u.serialNumber })),
              )
            }
          >
            Add to Ticket
          </Button>
        </div>
      </div>
    </Modal>
  );
}