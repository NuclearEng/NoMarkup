# NoMarkup — Product Walkthrough

> The stock market of home services. Reverse-auction bidding drives prices down while providers compete on quality, speed, and price.

**Last updated:** 2026-03-17 | **Screenshots:** Live app with real seed data

---

## Landing Page

Clean, conversion-focused homepage. Two CTAs: "Get started" (register) and "Browse jobs" (public marketplace).

Three value props: Reverse Auction, Verified Providers, Secure Payments.

![Landing Page](gstack/qa-reports/screenshots/showcase-00-landing.png)

---

## Authentication

### Login
Email/password with "Remember me" checkbox and "Forgot password?" link. Inline validation on submit.

![Login](gstack/qa-reports/screenshots/showcase-login-filled.png)

### Registration
Single-page form with display name, email, password, and confirmation. Inline Zod validation.

---

## Customer Experience

### Dashboard
After login, customers see their stats at a glance: Active Jobs, Bids Received, Pending Actions, Total Spend. Quick actions: "Post a Job" and "My Contracts". Recent jobs with status badges and live auction timers.

![Customer Dashboard](gstack/qa-reports/screenshots/showcase-01-dashboard.png)

### My Jobs
All posted jobs with status tabs (All, Active, Drafts, Completed, Cancelled). Each card shows bid count, price range, and auction countdown.

![My Jobs](gstack/qa-reports/screenshots/showcase-03-my-jobs.png)

### Job Detail — Live Auction
The heart of NoMarkup. A job with:
- **Live auction timer** counting down (2d 23h remaining)
- **Competing bids** from verified providers ($350 and $420)
- **Award Job** button to select a winner
- Job metadata: description, location, schedule, auction duration
- Breadcrumb navigation back to jobs list

![Job Detail](gstack/qa-reports/screenshots/showcase-02-job-detail.png)

### Live Auction Arena (10X Feature)
The "Robinhood moment" — watch prices drop in real-time as providers compete:
- **Current Lowest: $420** — live-updating lowest bid
- **Total Bids: 2** — real-time bid counter with trend indicator
- **Extensions: 1/3** — anti-snipe protection (max 3 extensions of 5 minutes each)
- **Price History chart** — SVG step chart showing price evolution over time
- **WebSocket streaming** — real-time bid events (shows "Offline" when bidding engine WebSocket is not connected, falls back to REST polling)
- Feature-flagged via `NEXT_PUBLIC_ENABLE_LIVE_AUCTION=true`

![Live Auction Arena](gstack/qa-reports/screenshots/showcase-26-auction-polished.png)

### Post a Job (7-Step Form)
Guided job posting wizard:
1. **Category** — 27 service categories (HVAC, Plumbing, Electrical, etc.) with search filter
2. **Details** — Title and description
3. **Location** — Address autocomplete
4. **Schedule** — Date selection, recurring toggle
5. **Photos** — Drag-and-drop upload (up to 10)
6. **Auction** — Duration, starting bid, instant-accept price
7. **Review** — Summary of all steps before posting

![Post Job](gstack/qa-reports/screenshots/showcase-11-post-job.png)

### Browse Jobs (Public Marketplace)
Search and filter available jobs. Filters: category, schedule type, price range, location/radius, recurring jobs toggle.

![Browse Jobs](gstack/qa-reports/screenshots/showcase-07-browse-jobs.png)

### Contracts
Track active and completed contracts with status tabs (All, Pending, Active, Completed, Cancelled). Each card shows contract number, amount, payment terms, and associated job.

![Contracts](gstack/qa-reports/screenshots/showcase-04-contracts.png)

### Profile
User profile with avatar, role badges (customer/provider), email verification status, member since date, MFA status, and "Become a Provider" CTA.

![Profile](gstack/qa-reports/screenshots/showcase-06-profile.png)

---

## Provider Experience

### Provider Dashboard
Providers see different stats: Active Bids, Active Contracts, Total Earnings, Win Rate. Quick actions include "Browse Jobs" to find new work. Extended sidebar with Working Capital, Business Tools.

![Provider Dashboard](gstack/qa-reports/screenshots/showcase-12-provider-dashboard.png)

### My Bids
Track all bids with status tabs (All, Active, Won, Lost). Each bid card shows: bid amount, original starting price (crossed out), placement date, award date, and status badge.

![Provider Bids](gstack/qa-reports/screenshots/showcase-13-provider-bids.png)

### Team Management
Manage company employees and their verification status. Add team members with roles (Technician, Lead, Manager, Apprentice), track background check status, licensing, and insurance. Empty state prompts first employee creation.

![Team Management](gstack/qa-reports/screenshots/showcase-27-team-management.png)

---

## Admin Panel

### Admin Dashboard
Full admin sidebar navigation with 12 sections: Overview, Users, Verification, Jobs, Disputes, Reviews, Fraud, Payments, Advances, Guarantee, Platform.

![Admin Dashboard](gstack/qa-reports/screenshots/showcase-15-admin-dashboard.png)

### User Management
Search, filter, and manage all platform users. View roles, status, join date. Actions: Suspend, Ban. Filter by status and role.

![Admin Users](gstack/qa-reports/screenshots/showcase-16-admin-users.png)

### Platform Analytics
Toggle analytics visibility for all users. View platform metrics: Total Users, Jobs Posted, Total GMV, Avg Bids per Job. Growth Trends chart with monthly/weekly/daily views. Category Performance breakdown.

![Admin Platform](gstack/qa-reports/screenshots/showcase-18-admin-platform.png)

---

## Mobile Responsive

All pages adapt to mobile viewports (375px+). Hamburger menu replaces top navigation. Forms remain full-width and touch-friendly (44px minimum touch targets).

![Mobile Landing](gstack/qa-reports/screenshots/showcase-19-landing-mobile.png)
![Mobile Login](gstack/qa-reports/screenshots/showcase-20-login-mobile.png)

---

## Technical Highlights

- **Full-stack:** Next.js 15 + Go microservices + Rust engines + PostgreSQL
- **Real-time:** WebSocket streaming for live auctions (anti-snipe protection)
- **27 service categories** across home services, commercial, professional
- **3 user roles:** Customer, Provider, Admin — each with tailored UI
- **51 routes** across public, auth, dashboard, and admin
- **322 tests** passing, 0 TypeScript errors
- **100/100 QA health score** across all pages
