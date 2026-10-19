import React from "react";
import { getShopPalette } from "../lib/shopColors";

export interface DepartmentBadgeProps {
  department?: string | null;
  size?: "xs" | "sm" | "md";
  showIcon?: boolean;
  className?: string;
}

export function DepartmentBadge({
  department,
  size = "sm",
  showIcon = true,
  className = "",
}: DepartmentBadgeProps) {
  const norm = (department || "").toUpperCase();
  const isTire = norm === "TIRE" || norm === "TIRES";
  const isMuffler = norm === "MUFFLER" || norm === "MUFFLERS";
  const palette = getShopPalette(norm);

  const sizeClasses =
    size === "xs"
      ? "px-1.5 py-0.5 text-[9px]"
      : size === "md"
      ? "px-2.5 py-1 text-xs"
      : "px-2 py-0.5 text-[10px]";

  const label = isTire ? "Tires" : isMuffler ? "Mufflers" : "All Shops";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-bold ${sizeClasses} ${palette.badgeClass} ${className}`}
    >
      {showIcon && <span>{palette.icon}</span>}
      <span>{label}</span>
    </span>
  );
}
