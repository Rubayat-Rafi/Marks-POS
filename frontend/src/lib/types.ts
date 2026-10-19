export type Role =
  | "OWNER"
  | "MANAGER"
  | "SERVICE_ADVISOR"
  | "TECHNICIAN"
  | "BOOKKEEPER";

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
export type PayType = "HOURLY" | "SALARY";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  membershipId: string;
  organization: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    paymentProvider: string;
  };
  location: { id: string; name: string } | null;
  permissions: string[];
};

export type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  notes: string | null;
  taxExempt: boolean;
  allowsMarketing: boolean;
  allowsSms: boolean;
  _count?: { vehicles: number; repairOrders: number };
};

export type Vehicle = {
  id: string;
  vin: string | null;
  plate: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  color: string | null;
  vinSource: string | null;
  vinDecodedAt: string | null;
  mileageReadings?: Array<{ id: string; miles: number; observedAt: string; source: string }>;
  owners?: Array<{ customer: Customer }>;
};

export type RepairOrderStatus =
  | "SCHEDULED"
  | "CHECKED_IN"
  | "DIAGNOSING"
  | "AWAITING_APPROVAL"
  | "AWAITING_PARTS"
  | "IN_PROGRESS"
  | "QUALITY_CHECK"
  | "READY"
  | "DELIVERED"
  | "CANCELLED";

export type RepairOrder = {
  id: string;
  number: string;
  status: RepairOrderStatus;
  concern: string;
  mileageIn: number | null;
  promisedAt: string | null;
  costsProvisional: boolean;
  version: number;
  customer: Customer;
  vehicle: Vehicle;
  tasks?: Array<{
    id: string;
    description: string;
    status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE";
    assignedToId: string | null;
    estimatedHours: string;
  }>;
  estimates?: Estimate[];
  invoices?: Invoice[];
  inspections?: Array<{
    id: string;
    title: string;
    notes: string | null;
    completedAt: string | null;
    items: Array<{
      id: string;
      category: string;
      label: string;
      result: "OK" | "ADVISE" | "URGENT" | "NOT_CHECKED";
      note: string | null;
      photoKeys: string[];
    }>;
  }>;
  partUsages?: Array<{
    id: string;
    partNumber: string;
    description: string;
    quantity: string;
    unitPrice: number;
    /** Absent for roles without reports.costs; the server strips it. */
    unitCost?: number;
    returned: boolean;
  }>;
  timeEntries?: Array<{
    id: string;
    workedHours: string;
    startedAt: string;
    endedAt?: string | null;
    note?: string | null;
    technician: { firstName: string; lastName: string };
  }>;
  margin: {
    netSales: number;
    directCost: number;
    grossProfit: number;
    grossMarginPct: number | null;
    provisional: boolean;
  } | null;
};

export type LineType = "PART" | "LABOR" | "FEE" | "SUBLET" | "DISCOUNT";

export type EstimateLine = {
  id: string;
  lineType: LineType;
  description: string;
  quantity: string | number;
  unitPrice: number;
  unitCost: number;
  hours: string | null;
  taxable: boolean;
  lineTotal: number;
  approved: boolean;
};

export type EstimateStatus =
  | "DRAFT"
  | "SENT"
  | "APPROVED"
  | "PARTLY_APPROVED"
  | "DECLINED"
  | "EXPIRED"
  | "SUPERSEDED";

export type EstimateVersion = {
  id: string;
  version: number;
  status: EstimateStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  sentAt: string | null;
  frozenAt: string | null;
  approvalTokenExpiresAt: string | null;
  lines: EstimateLine[];
  approvals: Array<{
    id: string;
    approverName: string | null;
    approvedTotal: number;
    partial: boolean;
    declined: boolean;
    createdAt: string;
  }>;
};

export type Estimate = {
  id: string;
  number: string;
  status: EstimateStatus;
  currentVersion: number;
  customer?: Customer;
  vehicle?: Vehicle;
  versions: EstimateVersion[];
};

export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTLY_PAID"
  | "PAID"
  | "CREDITED"
  | "VOID";

export type Invoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountCredited: number;
  balance?: number;
  issuedAt: string | null;
  dueAt: string | null;
  notes?: string | null;
  customer?: Customer;
  repairOrder?: { id: string; number: string } | null;
  lines?: Array<{
    id: string;
    lineType: LineType;
    description: string;
    quantity: string;
    unitPrice: number;
    lineTotal: number;
    taxAmount: number;
    /** Serial-numbered tires or mufflers sold on this line. */
    inventoryUnits?: Array<{ id: string; serialNumber: string }>;
  }>;
  attempts?: PaymentAttempt[];
  creditNotes?: Array<{ id: string; number: string; amount: number; reason: string }>;
};

export type PaymentAttempt = {
  id: string;
  provider: string;
  failureCode?: string | null;
  method: string;
  amount: number;
  status: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
  externalId: string | null;
  externalStatus: string | null;
  failureMessage: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  message?: string;
};

export type DashboardData = {
  timezone: string;
  appointmentsToday: Array<{
    id: string;
    scheduledFor: string;
    concern: string;
    status: string;
    department?: "TIRE" | "MUFFLER" | "OTHER";
    customer: Customer;
    vehicle: Vehicle;
  }>;
  openJobs: number;
  /** outstanding is null when the role cannot see invoice amounts. */
  unpaidInvoices: { count: number; outstanding: number | null };
  /** null when the role cannot see collected amounts. */
  cashCollectedToday: number | null;
  paymentsToday: number;
  revenueByShop?: {
    tireShop: {
      revenue: number | null;
      paymentsCount: number;
      invoiced: number | null;
      invoicedCount: number;
    };
    mufflersShop: {
      revenue: number | null;
      paymentsCount: number;
      invoiced: number | null;
      invoicedCount: number;
    };
  } | null;
  openReconciliationItems: number;
  bayCount: number | null;
  /** Vehicles in the shop right now (checked in, not handed back). */
  inService: InServiceJob[];
  /** null when the role cannot see invoice amounts. */
  invoicedToday: { count: number; total: number } | null;
  lowStockCount: number | null;
  lowStockCountByShop?: {
    total: number;
    tireShop: number;
    mufflersShop: number;
  } | null;
  newBookingRequests: number | null;
  newBookingRequestsByShop?: {
    total: number;
    tireShop: number;
    mufflersShop: number;
  } | null;
  myOpenTasks: Array<{
    id: string;
    description: string;
    status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE";
    repairOrder: {
      id: string;
      number: string;
      status: RepairOrderStatus;
      concern: string;
      customer: { firstName: string; lastName: string };
      vehicle: { year: number | null; make: string | null; model: string | null; plate: string | null };
    };
  }>;
};

export type Membership = {
  id: string;
  role: Role;
  isActive: boolean;
  locationId: string | null;
  employmentType: EmploymentType | null;
  payType: PayType | null;
  /** Null when the viewer lacks payroll.read and this is not their own row. */
  payRateCents: number | null;
  hireDate: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    lastLoginAt: string | null;
  };
  location: { id: string; name: string } | null;
};

export type ShiftClockEntry = {
  id: string;
  userId: string;
  clockInAt: string;
  clockOutAt: string | null;
  note: string | null;
  user?: { firstName: string; lastName: string };
};

export type PartFitment = {
  id: string;
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  notes: string | null;
};

export type CatalogItem = {
  id: string;
  partNumber: string;
  description: string;
  category: string;
  costCents: number;
  priceCents: number;
  onHand: string;
  isActive: boolean;
  supplier: { id: string; name: string } | null;
  fitments: PartFitment[];
};

export type InServiceJob = {
  id: string;
  number: string;
  status: RepairOrderStatus;
  concern: string;
  department?: "TIRE" | "MUFFLER" | "OTHER";
  checkedInAt: string | null;
  promisedAt: string | null;
  customer: { firstName: string; lastName: string; companyName: string | null; phone: string | null };
  vehicle: { year: number | null; make: string | null; model: string | null; plate: string | null };
  /** balance is null when the role cannot see invoice amounts. */
  invoice: { id: string; number: string; status: InvoiceStatus; balance: number | null } | null;
};

export type InventoryKind = "TIRE" | "MUFFLER" | "OTHER";

export type InventoryProduct = {
  id: string;
  kind: InventoryKind;
  brand: string | null;
  name: string;
  size: string | null;
  sku: string | null;
  /** null when the role cannot see costs. */
  costCents: number | null;
  priceCents: number;
  reorderPoint: number;
  isActive: boolean;
  inStock: number;
  lowStock: boolean;
};

export type InventoryUnit = {
  id: string;
  serialNumber: string;
  status: "IN_STOCK" | "SOLD" | "REMOVED";
  costCents: number | null;
  receivedAt: string;
  soldAt: string | null;
  note: string | null;
  invoice: { id: string; number: string } | null;
};

export type AvailableProduct = Omit<InventoryProduct, "inStock" | "lowStock"> & {
  units: Array<{ id: string; serialNumber: string; receivedAt: string }>;
};

export type BookingRequest = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  vehicle: string | null;
  service: string;
  preferredDate: string | null;
  preferredTime: string | null;
  notes: string | null;
  status: "NEW" | "CONTACTED" | "BOOKED" | "CLOSED";
  createdAt: string;
};
