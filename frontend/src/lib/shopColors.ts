/**
 * Design system and unified color palettes for shop divisions:
 * - Combined / All Shops: Deep Indigo / Slate palette
 * - Tires Shop: Emerald / Jade / Mint palette
 * - Mufflers Shop: Warm Sunset Orange / Fiery Amber palette
 */

export type ShopDivision = "ALL" | "CONSOLIDATED" | "TIRE" | "MUFFLER" | "OTHER";

export interface ShopPaletteDefinition {
  id: "ALL" | "TIRE" | "MUFFLER";
  name: string;
  shortName: string;
  icon: string;
  activeTabClass: string;
  inactiveTabClass: string;
  badgeClass: string;
  badgeSolidClass: string;
  bannerClass: string;
  cardBorderClass: string;
  cardHoverClass: string;
  cardBgLight: string;
  textAccentClass: string;
  ringClass: string;
}

export const SHOP_PALETTES: Record<"ALL" | "TIRE" | "MUFFLER", ShopPaletteDefinition> = {
  ALL: {
    id: "ALL",
    name: "All Shops (Combined)",
    shortName: "All Shops",
    icon: "🏢",
    activeTabClass:
      "bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white shadow-sm shadow-indigo-950/20 ring-1 ring-white/10",
    inactiveTabClass: "text-slate-600 hover:text-indigo-900 hover:bg-indigo-50/70",
    badgeClass: "bg-indigo-50 text-indigo-800 border border-indigo-200/80 font-bold",
    badgeSolidClass: "bg-indigo-600 text-white font-bold",
    bannerClass:
      "border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-violet-50/30 to-white text-indigo-950 shadow-xs",
    cardBorderClass: "border-indigo-200",
    cardHoverClass: "hover:border-indigo-400 hover:bg-indigo-50/25 hover:shadow-indigo-500/10",
    cardBgLight: "bg-indigo-50/40",
    textAccentClass: "text-indigo-700",
    ringClass: "ring-indigo-500",
  },
  TIRE: {
    id: "TIRE",
    name: "Tires Shop",
    shortName: "Tires",
    icon: "🛞",
    activeTabClass:
      "bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 text-white shadow-sm shadow-emerald-700/25 ring-1 ring-white/10",
    inactiveTabClass: "text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50/80",
    badgeClass: "bg-emerald-50 text-emerald-800 border border-emerald-200/90 font-bold",
    badgeSolidClass: "bg-emerald-600 text-white font-bold",
    bannerClass:
      "border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50/40 to-white text-emerald-950 shadow-xs",
    cardBorderClass: "border-emerald-200",
    cardHoverClass: "hover:border-emerald-400 hover:bg-emerald-50/30 hover:shadow-emerald-500/10",
    cardBgLight: "bg-emerald-50/40",
    textAccentClass: "text-emerald-700",
    ringClass: "ring-emerald-500",
  },
  MUFFLER: {
    id: "MUFFLER",
    name: "Mufflers Shop",
    shortName: "Mufflers",
    icon: "🔧",
    activeTabClass:
      "bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white shadow-sm shadow-orange-600/25 ring-1 ring-white/10",
    inactiveTabClass: "text-orange-900 hover:text-orange-950 hover:bg-orange-50/80",
    badgeClass: "bg-orange-50 text-orange-900 border border-orange-200/90 font-bold",
    badgeSolidClass: "bg-orange-600 text-white font-bold",
    bannerClass:
      "border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50/40 to-white text-orange-950 shadow-xs",
    cardBorderClass: "border-orange-200",
    cardHoverClass: "hover:border-orange-400 hover:bg-orange-50/30 hover:shadow-orange-500/10",
    cardBgLight: "bg-orange-50/40",
    textAccentClass: "text-orange-700",
    ringClass: "ring-orange-500",
  },
};

export function getShopPalette(shop?: string | null): ShopPaletteDefinition {
  const norm = (shop || "").toUpperCase();
  if (norm === "TIRE" || norm === "TIRES") return SHOP_PALETTES.TIRE;
  if (norm === "MUFFLER" || norm === "MUFFLERS") return SHOP_PALETTES.MUFFLER;
  return SHOP_PALETTES.ALL;
}
