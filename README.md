# Mark's Tire Shop & Muffler: Shop App

The website and counter system for **Mark's Tire Shop & Muffler LLC**, 5229 Saint
Claude Ave, New Orleans, LA 70117 · (504) 354-9396. Built on the repair-to-payment
workflow in the *Auto Shop Web App Developer Guide v1.0*.

## What is in it

| Screen | Where | What it does |
| --- | --- | --- |
| Public homepage | `/` | Book a service, check an estimate (number + phone), directions, call. **Staff Login** at the top. |
| Customer checkout | `/pay/:id` | Where a QR code or pay link opens on the customer's phone. |
| Dashboard | `/dashboard` | Cars in the bays, today's revenue, one-tap **Collect payment**, low-stock and website-booking reminders. |
| Point of Sale (POS) | `/pos` | Direct billing counter. Item Functions modal pulls live shop services and serialized inventory from the API. Flexible payment methods (Cash, Card, Check, QR code), custom tax modes. |
| Quick sale | `/quick-sale` | Bill a walk-in job, pick tire or muffler serials, take payment, print the receipt: one step. |
| Inventory | `/inventory` | Tires, mufflers, and parts by serial number. Type or scan serials in. Reorder reminder per item. |
| Parts Catalog | `/parts-catalog` | Parts database with make/model/year vehicle fitment tagging backed by NHTSA public vehicle data. |
| Work Board & Jobs | `/jobs` | Repair order board across shop lanes (Check-in, Diagnosis, In Progress, Complete). Inspections, estimates, customer approval links. |
| Time Clock | `/timeclock` | Clock in/out for staff, personal shift history, and operational payroll estimates by date range. |
| Finance | `/finance` | Double-entry operational subledger, invoices, payments, receivables, expenses, cash drawer sessions, and bank reconciliation. |
| Reports | `/reports` | Sales and profitability analysis with date range filters, predefined periods, and CSV export. |
| Audit Trail | `/audit` | Complete chronological security and operational log of system events with human-readable action badges. |
| Settings | `/settings` | Sales tax configuration, team members management (edit credentials, roles, pay rates, delete), and operational data reset. |
| Receipt | `/receipts/:id` | One-tap print, full page or 80mm receipt printer. Shows every service, part, serial, note and payment. |

Phones and tablets get a bottom tab bar with Collect in the middle, and list rows
you can **swipe left** for quick actions (Collect, Receipt, Receive stock). Desktops
and landscape tablets get a sidebar.

Shop name, address, phone and the services list shown on the website live in one
file: `frontend/src/lib/shop.ts`. Change them there.

## Recent Updates & Enhancements

| Area | Feature / Fix | Description |
| --- | --- | --- |
| 1. POS Item Functions | Live API-driven services & products | Replaced static/dummy presets with live queries to `/settings/labor-rates`, `/inventory/available`, and `/settings/catalog`. |
| 2. Team Member Management | Full profile editing & deletion modal | Edit staff first name, last name, email, and password in `/settings`. Added a custom modal for deleting team members safely. |
| 3. Operational Data Reset | Complete database reset | Danger Zone "Remove All Data" resets transactions, jobs, invoices, inventory, catalog items, labor rates, and time clock punches while protecting the owner account and audit logs. |
| 4. Time Clock Punches | Clean shift tracking | Shift clock punches are tracked per shop, isolated to the tenant, and properly wiped upon operational reset. |
| 5. Audit Trail | Dedicated audit page | Added a dedicated `/audit` route with KPI summary cards, human-readable action tags, and raw metadata inspection. |
| 6. Reports Filtering | Date range presets & CSV downloads | Upgraded `/reports` with quick range filters (Today, Last 7d, Month-to-date, Custom) and instant CSV report exports. |
| 7. Idempotency & Payments | Resilient checkout flow | The POS generates new idempotency keys per attempt and prevents race conditions or overpayment on balances. |
| 8. API Security | Strict authentication & CSRF | httpOnly SameSite cookies, JWT validation, rate-limiting, and tenant-scoped Prisma database queries. |


## Security

- Staff sessions are an **httpOnly, SameSite cookie**, never readable by page script. Cookie-authenticated writes must carry `X-Requested-With` (CSRF).
- Login is rate-limited per device and per account; unknown emails take as long to reject as wrong passwords.
- A password change signs out every other session.
- JWT algorithm pinned; production refuses a weak `JWT_SECRET`.
- Cross-shop holes closed: webhooks only touch the sending shop's payments; part usage cannot decrement another shop's stock.
- Every public endpoint (booking, estimate lookup, checkout, approval) is rate-limited; booking has a bot honeypot; estimate lookup needs the phone on file.
- Bad query parameters return 400, not 500. Request ids are sanitised.
- The mock processor and "simulate" buttons are off in production unless `ALLOW_DEMO_PAYMENTS=true`.

**Deploy the web app and `/api` on the same site** (for example `shop.example.com`
and `shop.example.com/api`) so the session cookie is sent.

React + Vite on the front, Node + Express + Prisma + MySQL behind it, one
background worker, and a seed script that fills the database with a working shop.

This is the **MySQL / cPanel build**. It targets shared hosting: MySQL 8 or
MariaDB 10.6+, the SPA served from `public_html`, and the API running as a
cPanel Node.js app with `/api` proxied to it. See
[docs/DEPLOY-CPANEL.md](docs/DEPLOY-CPANEL.md) for the deployment, and
[docs/tenant-isolation.md](docs/tenant-isolation.md) for what moving off
PostgreSQL cost in tenant-isolation terms.

---

## What you need first

| Tool | Version | Where |
| --- | --- | --- |
| Node.js | 20.11 or newer (22 LTS recommended) | https://nodejs.org |
| MySQL | 8.0 or newer, or MariaDB 10.6+ | https://dev.mysql.com/downloads/ or Docker Desktop |

Match the server's major version locally where you can. MariaDB and MySQL
differ on JSON handling, and two fields here are JSON columns.

Check them:

```bash
node -v
npm -v
mysql --version    # or: docker --version
```

## Setup

```bash
# 1. Environment
cp .env.example .env          # on Windows PowerShell: copy .env.example .env

# 2. Database
docker compose up -d db       # if you have Docker
#   ...or create the database yourself and set DATABASE_URL in .env:
#   mysql -u root -e "CREATE DATABASE autoshop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

# 3. Install, generate the client, create the schema, load demo data
npm run setup
```

`npm run setup` installs both halves, runs `prisma generate`,
`prisma migrate deploy` and the seed. The seed prints the demo logins and a
live customer approval link when it finishes.

The database must use `utf8mb4`. Search in this app relies on MySQL's
case-insensitive collation, which is what `utf8mb4_unicode_ci` gives you; a
binary or `_bin` collation will make customer and parts search case-sensitive.

## Running it

```bash
npm run dev          # API on :4000 and web on :5173
npm run dev:worker   # in a second terminal: outbox and webhook worker
```

Open http://localhost:5173 for the public homepage. **Staff Login** (or
http://localhost:5173/login) signs in to the counter.

| Command | Where | What it does |
| --- | --- | --- |
| `npm run dev` | root | API (:4000) and Web SPA (:5173) together |
| `npm run dev:worker` | root | Background worker (notifications, webhook retries, link expiry) |
| `npm run seed:admin` | `backend/` | Create or update the owner/admin account without wiping operational data |
| `npm run db:seed` | root | Wipe and reload full synthetic demo data |
| `npm run db:reset` | root | Drop, recreate schema, and reseed |
| `npm test` | root | Domain unit tests (pricing, permissions, state machines) |
| `npm run typecheck` | root | Type-check both frontend and backend |
| `npm run build` | root | Production build of both apps |

> **Hostinger / cPanel Auto-Bootstrap**: When the backend server boots up (`node dist/index.js` or `npm start`), it automatically checks and bootstraps the admin account (`mohammad@markstire.com` / `AutoShop2026!`) as an active `OWNER`. You do not need SSH terminal access on Hostinger hPanel to run seed scripts manually.

## Accounts & Roles

Password for every account: `AutoShop2026!`

| Email | Role | What it demonstrates |
| --- | --- | --- |
| `mohammad@markstire.com` | Owner / Admin | Full administrative access: shop settings, staff management, financial reports, refunds, and operational reset |
| `manager@markstire.test` | Manager | Operations and refunds up to $500 |
| `advisor@markstire.test` | Service advisor | Counter, customer service, estimates; no cost or margin data |
| `tech@markstire.test` | Technician | Assigned repair tasks and shift punch clock only; no payments |
| `books@markstire.test` | Bookkeeper | General ledger, receivables, reconciliation; no operational changes |
| `consultant@markstire.test` | Manager at two shops | Multi-shop organization picker at sign-in |
| `owner@crescentcity.test` | Owner of second shop | Tenant isolation: cannot see the primary shop's data |

The dashboard itself differs by role: the owner sees the whole shop plus a 30-day sales
snapshot, a manager/advisor/bookkeeper sees today's operations, and a technician
(`tech@markstire.test`) sees a clock-in widget and only their own assigned tasks — no
financial tiles at all, since the payload strips them server-side for that role.

## Walking the workflow

0. **Walk-in or appointment** — from any owner/manager dashboard, *Walk-in* opens a
   three-step check-in (find or add the customer, find or add the vehicle, describe
   the concern) without leaving the dashboard. Or book an **appointment**, then
   *Check in* — either path creates the repair order and carries the customer,
   vehicle, mileage and concern across.
1. **Work board** — jobs sit in every lane; drag, scroll or use the ←/→ buttons to see
   lanes past the fold. Advance one; the move is audited and optimistically locked.
2. **A job** — five tabs: overview, inspection, estimates, parts & time, invoice.
   Record a multi-point inspection (photos work), then build an estimate and tick
   *send to the customer*. You get a link like `/approve/<token>`. Adding a part
   offers to filter the catalog to only what is tagged as fitting this job's vehicle.
3. **The approval link** — open it in a private window. No login. Untick a line to
   approve part of the estimate.
4. **Back on the job** — create the invoice from approved work, then issue it. Only
   approved lines appear.
5. **POS**: collect by cash, check, "Card (other machine)", card terminal or QR code. For a walk-in with no job, use **Quick sale** instead. Pick *QR code* and a scannable code
   renders client-side over the checkout link; open it on a phone and pay, and the
   POS screen flips to paid by itself. *Test: approve* moves the mock processor;
   *Check now* asks the processor, which is what actually posts the money.
6. **Receipt** — *View receipt* prints from the frozen snapshot, not the live
   customer record.
7. **Finance** — six tabs. The trial balance now includes that sale, its tax and
   the processor fee, and it balances. Refund a payment, confirm a payout into the
   bank, or open and close the cash drawer and watch the variance raise an
   exception.
8. **Extra work** — back on the estimate, *Revise for extra work*. The old version
   is superseded and its approval link stops working.
9. **Time clock** — every signed-in person can clock in and out from `/timeclock`
   (or the widget on a technician's dashboard). As owner or bookkeeper, the same
   page adds everyone's hours and a payroll estimate for a date range, built from
   the pay rate configured for each person in Settings → Team.
10. **Parts and vehicles** — `/parts-catalog` searches the shop's own parts, or
    narrows to a make/model/year using free NHTSA reference data. Tag which
    vehicles a part fits from there, or manage fitment inline from *Manage* on
    a part row.

## Architecture

```
auto-shop-web-app/
├── backend/                  Express + Prisma, the modular monolith
│   ├── prisma/schema.prisma   Full schema: tenancy, CRM, workflow, billing, ledger
│   ├── prisma/seed.ts         Demo data + the guide's worked finance example
│   └── src/
│       ├── domain/            Business rules: pricing, ledger, invoicing, states
│       ├── modules/           REST routes under /api/v1
│       ├── middleware/        Auth, tenancy, role permissions
│       ├── providers/         Payment adapters behind one internal contract
│       └── worker/            Outbox dispatch, webhook retry, link expiry
└── frontend/                  React + Vite + Tailwind
    ├── src/pages/             Role-split dashboard, appointments, customers,
    │                          vehicles, work board, job workspace, POS, receipt,
    │                          finance, reports, settings, time clock, parts
    │                          catalog, public approval
    ├── src/components/        Shared UI plus the job workspace modules
    │                          (tasks, parts, time, inspection, line editor),
    │                          the QR code renderer, the walk-in flow and the
    │                          time-clock widget
    └── src/lib/               API client, auth context, formatting
```

### Where the guide's rules live

| Rule | File |
| --- | --- |
| Money as integer minor units | `backend/src/lib/money.ts` |
| Server-side pricing and tax | `backend/src/domain/pricing.ts` |
| Balanced double-entry posting | `backend/src/domain/ledger.ts` |
| Invoice issuance, credits, refunds | `backend/src/domain/invoicing.ts` |
| Four separate state machines | `backend/src/domain/states.ts` |
| Tenant scope from the session, never the request | `backend/src/middleware/auth.ts` |
| Role permissions | `backend/src/middleware/rbac.ts` |
| Idempotent payments, ambiguous outcomes | `backend/src/modules/payments.routes.ts` |
| Webhook inbox: verify, dedupe, then process | `backend/src/modules/webhooks.routes.ts` |
| Transactional outbox | `backend/src/lib/outbox.ts` + `src/worker/` |
| Expiring single-resource approval links | `backend/src/modules/approvals.routes.ts` |
| Transactional messaging kept apart from marketing | `backend/src/lib/notifications.ts` |
| Private file storage behind signed links | `backend/src/lib/storage.ts` |
| Tenant isolation, and what MySQL costs it | `docs/tenant-isolation.md` |
| Shift clock in/out, separate from per-job time | `backend/src/modules/timeClock.routes.ts` |
| Pay rate gated narrower than job cost | `backend/src/middleware/rbac.ts` (`payroll.read`/`payroll.write`) |
| Parts fitment tagged by the shop, not a licensed catalog | `backend/prisma/schema.prisma` (`PartFitment`) |
| Free NHTSA make/model reference, cached | `backend/src/modules/vehicles.routes.ts` |

### Deliberate design choices

- **Money is never a float.** Every amount is an integer of US cents. Quantities and
  labor hours are fixed-precision decimals.
- **The browser never decides a total.** It sends quantities and unit prices; the
  server prices the lines and applies tax.
- **The browser never declares a payment succeeded.** An attempt is confirmed by a
  signed webhook or an authoritative status lookup. A timeout is `UNKNOWN`, not
  failed, and lands in the reconciliation queue.
- **Issued invoices are not deleted.** Corrections are credit notes; ledger
  corrections are linked reversing entries.
- **Approval is tied to an immutable estimate version.** A price change creates a
  new version and the old link stops working.
- **Costs are flagged, not assumed.** A job billing parts with no recorded part cost
  shows as *costs incomplete* rather than 100% margin.
- **Tenant scope comes from the authenticated membership**, never from an id in the
  request.
- **Pay is more sensitive than job cost.** A manager who can already see shop-wide
  margins still cannot see a coworker's pay rate; that needs `payroll.read`, granted
  to owner and bookkeeper only. Everyone sees their own rate.
- **A QR code is drawn in the browser, never fetched from a third-party image API.**
  The code just encodes the same signed checkout link a card payment already uses;
  sending that link to an external service to render it would leak it for no reason.
- **Vehicle fitment is the shop's own tag, not a licensed catalog.** Make/model
  choices come from NHTSA's free public reference data; which of the shop's own
  parts fits which vehicle is entered by the shop, the same way a manual parts line
  always was.

## Deviations from the guide

The guide recommends Next.js and NestJS. You asked for React + Vite and Node, so
the web client is a Vite SPA and the API is Express. The module boundaries, the
versioned `/api/v1` contract and the domain rules are unchanged, so the backend is
still reusable by a native client later.

## Not built, and why

These are named in the guide as later, gated or requiring commercial agreements:

- **Stripe, Square and Adyen adapters.** The adapter contract and registry are in
  place; only a `mock` provider is implemented. `backend/src/providers/registry.ts`
  refuses to offer a provider that has no adapter, so the UI never shows a card
  button that cannot work. Implementing a real provider means writing one file
  against its SDK and registering it.
- **Terminal hardware.** Readers and tokens are not interchangeable between
  providers and need testing on the shop's own network.
- **CARFAX, PartsTech, MOTOR, ALLDATA.** The guide records these as integration
  candidates, not confirmed partnerships. VIN decoding, and now the make/model
  reference lookup on Parts & vehicles, both use NHTSA vPIC, which is free and needs
  no key. Which of the shop's own parts fits which vehicle is a fitment tag the shop
  enters (`PartFitment`), not a licensed universal parts-to-vehicle lookup; parts and
  labor pricing are still entered manually.
- **Payroll tax filing, direct deposit, pay stubs.** The time clock and the payroll
  summary (`/time-clock/payroll-summary`) are an operational estimate — hours ×
  configured rate — for the owner to review. It is explicitly not a payroll tax
  filing, and the response says so.
- **S3-compatible file storage.** Photo upload, tenant-scoped keys, magic-number
  type checking and short-lived signed links all work, but the default store
  writes to local disk (`UPLOAD_DIR`). Swap the adapter in
  `backend/src/lib/storage.ts` for S3 before running on more than one machine.
- **A real email or SMS transport.** The messaging layer, recipient resolution
  and message bodies are built, and the transactional/marketing separation is
  enforced. The only registered transport prints to the console and says so. Add
  a provider to `TRANSPORTS` in `backend/src/lib/notifications.ts`; a transport
  named in config but not implemented fails loudly rather than pretending.
- **A database-level tenant boundary.** The PostgreSQL build shipped row-level
  security policies as an opt-in second layer. MySQL has no equivalent feature,
  so that file was removed rather than ported, and tenant scope is now enforced
  in the application layer only. This is a real reduction in defence-in-depth:
  one route that forgets `tenantScope(req)` is a cross-tenant leak with nothing
  behind it. [docs/tenant-isolation.md](docs/tenant-isolation.md) sets out what
  holds the line instead and what to do before putting a second shop in one
  database.
- **Per-route cross-tenant tests.** The mitigation above is only as good as the
  reviewing. There is no test yet that requests organization B's rows as
  organization A and expects a 404. Add one per route module.

## Before any real money moves

From the guide's production gate (page 14):

- [ ] An accountant approves the posting policy in `src/domain/accounts.ts`
- [ ] Sales tax rate and what it applies to are confirmed for your jurisdiction (the seed uses a 9.5% placeholder on parts only)
- [ ] A real payment provider adapter is implemented and certified
- [ ] Cross-tenant access tests pass for every route module (see `docs/tenant-isolation.md`)
- [ ] The application connects as a MySQL user scoped to its own database, not the cPanel account's primary user
- [ ] Backups run and a restore drill has succeeded
- [ ] Owner and admin accounts have MFA
- [ ] Secrets live in a secret store, not `.env`
- [ ] A controlled real-payment and refund test, authorised by the business owner
- [ ] Payroll figures (pay rates, hours, the payroll estimate) are confirmed with an
      accountant or payroll provider before being relied on for anything but an
      internal estimate

`backend/prisma/seed.ts` posts the guide's worked finance example through the real
ledger and asserts the checks on page 9. If the posting policy ever drifts, the seed
fails loudly rather than producing a quietly wrong database.
