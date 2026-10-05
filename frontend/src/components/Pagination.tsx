import { useState, useEffect } from "react";
import { Button, Select } from "./ui";
import { Icon } from "./Icon";

export type PaginationProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  sortOrder?: "desc" | "asc";
  onSortOrderChange?: (sort: "desc" | "asc") => void;
  itemName?: string;
};

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  sortOrder,
  onSortOrderChange,
  itemName = "records",
}: PaginationProps) {
  const [jumpInput, setJumpInput] = useState(String(currentPage));

  useEffect(() => {
    setJumpInput(String(currentPage));
  }, [currentPage]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }

      if (currentPage < totalPages - 2) pages.push("...");
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(jumpInput, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      onPageChange(p);
    } else {
      setJumpInput(String(currentPage));
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200/80 bg-white px-4 py-3.5 sm:px-6 rounded-b-2xl text-xs text-slate-600">
      {/* Left: Summary text & Rows per page */}
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Showing <strong className="font-semibold text-ink">{startItem}</strong> to{" "}
          <strong className="font-semibold text-ink">{endItem}</strong> of{" "}
          <strong className="font-semibold text-ink">{totalItems}</strong> {itemName}
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
            <span className="text-slate-500 font-medium">Rows:</span>
            <Select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="py-1 text-xs font-semibold"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
          </div>
        )}

        {onSortOrderChange && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
            <span className="text-slate-500 font-medium">Sort:</span>
            <Select
              value={sortOrder ?? "desc"}
              onChange={(e) => onSortOrderChange(e.target.value as "desc" | "asc")}
              className="py-1 text-xs font-semibold"
            >
              <option value="desc">⬇️ Newest First (Last uploaded shows first)</option>
              <option value="asc">⬆️ Oldest First (First uploaded shows first)</option>
            </Select>
          </div>
        )}
      </div>

      {/* Right: Numbered pagination controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Jump to first page */}
          <Button
            variant="secondary"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(1)}
            className="h-8 w-8 !p-0"
            title="First page"
          >
            <span className="font-bold">«</span>
          </Button>

          {/* Previous page */}
          <Button
            variant="secondary"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="h-8 px-2.5 text-xs font-semibold"
          >
            ‹ Prev
          </Button>

          {/* Numbered page pills */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, idx) => {
              if (p === "...") {
                return (
                  <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-bold select-none">
                    …
                  </span>
                );
              }
              const isActive = p === currentPage;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={`min-w-[32px] h-8 rounded-lg text-xs font-bold transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-xs"
                      : "text-slate-600 hover:bg-slate-100 hover:text-ink border border-transparent hover:border-slate-200"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {/* Next page */}
          <Button
            variant="secondary"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="h-8 px-2.5 text-xs font-semibold"
          >
            Next ›
          </Button>

          {/* Jump to last page */}
          <Button
            variant="secondary"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            className="h-8 w-8 !p-0"
            title="Last page"
          >
            <span className="font-bold">»</span>
          </Button>

          {/* Quick jump input for large datasets */}
          {totalPages > 5 && (
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-1 pl-2 border-l border-slate-200">
              <span className="text-slate-400 text-[11px]">Go:</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                className="w-12 h-8 rounded-lg border border-slate-300 px-1.5 text-center text-xs font-bold text-ink focus:border-brand-500 focus:outline-none"
              />
            </form>
          )}
        </div>
      )}
    </div>
  );
}
