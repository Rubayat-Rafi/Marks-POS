import type { AccountType } from "@prisma/client";

/**
 * The operational finance subledger's chart of accounts.
 *
 * This is a subledger for job and payment reporting, not a general ledger, a
 * tax return or an audited statement (build guide / 07). An accountant should
 * approve the posting policy before live use.
 */
export const ACCOUNT_CODES = {
  BANK: "1000",
  PROCESSOR_CLEARING: "1010",
  CASH_DRAWER: "1020",
  ACCOUNTS_RECEIVABLE: "1100",
  INVENTORY: "1300",

  ACCOUNTS_PAYABLE: "2000",
  CUSTOMER_DEPOSITS: "2100",
  SALES_TAX_PAYABLE: "2200",
  LABOR_ALLOCATION: "2300",

  RETAINED_EARNINGS: "3000",

  PARTS_REVENUE: "4000",
  LABOR_REVENUE: "4010",
  FEE_REVENUE: "4020",
  SUBLET_REVENUE: "4030",
  SALES_DISCOUNTS: "4900",

  PARTS_COST: "5000",
  DIRECT_LABOR_COST: "5010",
  SUBLET_COST: "5020",
  PROCESSING_FEES: "6000",
  SHOP_EXPENSE: "6100",
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

export const CHART_OF_ACCOUNTS: Array<{
  code: AccountCode;
  name: string;
  type: AccountType;
}> = [
  { code: ACCOUNT_CODES.BANK, name: "Bank", type: "ASSET" },
  { code: ACCOUNT_CODES.PROCESSOR_CLEARING, name: "Processor clearing", type: "ASSET" },
  { code: ACCOUNT_CODES.CASH_DRAWER, name: "Cash drawer", type: "ASSET" },
  { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, name: "Accounts receivable", type: "ASSET" },
  { code: ACCOUNT_CODES.INVENTORY, name: "Parts inventory", type: "ASSET" },

  { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: "Accounts payable", type: "LIABILITY" },
  { code: ACCOUNT_CODES.CUSTOMER_DEPOSITS, name: "Customer deposits", type: "LIABILITY" },
  { code: ACCOUNT_CODES.SALES_TAX_PAYABLE, name: "Sales tax payable", type: "LIABILITY" },
  { code: ACCOUNT_CODES.LABOR_ALLOCATION, name: "Labor allocation", type: "LIABILITY" },

  { code: ACCOUNT_CODES.RETAINED_EARNINGS, name: "Retained earnings", type: "EQUITY" },

  { code: ACCOUNT_CODES.PARTS_REVENUE, name: "Parts revenue", type: "REVENUE" },
  { code: ACCOUNT_CODES.LABOR_REVENUE, name: "Labor revenue", type: "REVENUE" },
  { code: ACCOUNT_CODES.FEE_REVENUE, name: "Fee revenue", type: "REVENUE" },
  { code: ACCOUNT_CODES.SUBLET_REVENUE, name: "Sublet revenue", type: "REVENUE" },
  { code: ACCOUNT_CODES.SALES_DISCOUNTS, name: "Sales discounts", type: "REVENUE" },

  { code: ACCOUNT_CODES.PARTS_COST, name: "Parts cost", type: "EXPENSE" },
  { code: ACCOUNT_CODES.DIRECT_LABOR_COST, name: "Direct labor cost", type: "EXPENSE" },
  { code: ACCOUNT_CODES.SUBLET_COST, name: "Sublet cost", type: "EXPENSE" },
  { code: ACCOUNT_CODES.PROCESSING_FEES, name: "Processing expense", type: "EXPENSE" },
  { code: ACCOUNT_CODES.SHOP_EXPENSE, name: "Shop expense", type: "EXPENSE" },
];

/** Revenue account for an invoice line type. */
export function revenueAccountFor(lineType: string): AccountCode {
  switch (lineType) {
    case "PART":
      return ACCOUNT_CODES.PARTS_REVENUE;
    case "LABOR":
      return ACCOUNT_CODES.LABOR_REVENUE;
    case "FEE":
      return ACCOUNT_CODES.FEE_REVENUE;
    case "SUBLET":
      return ACCOUNT_CODES.SUBLET_REVENUE;
    default:
      return ACCOUNT_CODES.SALES_DISCOUNTS;
  }
}
