import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { CustomersPage } from "./pages/Customers";
import { CustomerDetailPage } from "./pages/CustomerDetail";
import { WorkBoardPage } from "./pages/WorkBoard";
import { JobWorkspacePage } from "./pages/JobWorkspace";
import { PosPage } from "./pages/Pos";
import { FinancePage } from "./pages/Finance";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { ApprovalPage } from "./pages/Approval";
import { AppointmentsPage } from "./pages/Appointments";
import { ReceiptPage } from "./pages/Receipt";
import { VehicleDetailPage } from "./pages/VehicleDetail";
import { TimeClockPage } from "./pages/TimeClock";
import { PartsCatalogPage } from "./pages/PartsCatalog";
import { LandingPage } from "./pages/Landing";
import { PayPage } from "./pages/Pay";
import { QuickSalePage } from "./pages/QuickSale";
import { InventoryPage } from "./pages/Inventory";
import { AuditTrailPage } from "./pages/AuditTrail";

function PosInvoiceRedirect() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  return <Navigate to={`/quick-sale?invoiceId=${invoiceId}`} replace />;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      {/* Public: the website, and customer links that carry their own scoped token. */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/approve/:token" element={<ApprovalPage />} />
      <Route path="/pay/:externalId" element={<PayPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="quick-sale" element={<QuickSalePage />} />
        <Route path="quick-sale/:invoiceId" element={<QuickSalePage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="vehicles/:id" element={<VehicleDetailPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="board" element={<WorkBoardPage />} />
        <Route path="jobs/:id" element={<JobWorkspacePage />} />
        <Route path="pos" element={<Navigate to="/quick-sale" replace />} />
        <Route path="pos/:invoiceId" element={<PosInvoiceRedirect />} />
        <Route path="receipts/:invoiceId" element={<ReceiptPage />} />
        <Route path="timeclock" element={<TimeClockPage />} />
        <Route path="parts-catalog" element={<PartsCatalogPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditTrailPage />} />
        <Route path="settings/audit" element={<AuditTrailPage />} />
      </Route>

      <Route
        path="*"
        element={
          <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
            <h1 className="text-lg font-semibold text-ink">That page does not exist</h1>
            <a href="/" className="text-sm text-brand-700 underline">
              Back to the home page
            </a>
          </div>
        }
      />
    </Routes>
  );
}
