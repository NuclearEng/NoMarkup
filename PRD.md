# NoMarkup — Product Requirements Document

**Version:** 2.0 (Draft — Investor & Engineering Ready)
**Date:** March 2, 2026
**Author:** Tanner Coker
**Audience:** Engineering Team, Investors, Leadership
**Status:** Draft — Alignment & Kickoff

---

## Table of Contents

1. [Overview & Vision](#1-overview--vision)
2. [Market Opportunity](#2-market-opportunity)
3. [Problem Statement](#3-problem-statement)
4. [Target Users & Personas](#4-target-users--personas)
5. [Competitive Landscape](#5-competitive-landscape)
6. [Core Concepts & Terminology](#6-core-concepts--terminology)
7. [Service Taxonomy](#7-service-taxonomy)
8. [Feature Requirements — MVP](#8-feature-requirements--mvp)
   - 8.1 User Registration & Onboarding
   - 8.2 Identity & Document Verification
   - 8.3 Job Posting & Reverse Auction
   - 8.4 Bidding System
   - 8.5 Provider Profiles & Terms
   - 8.6 Two-Way Reviews & Trust System
   - 8.7 AI/ML Fraud Detection
   - 8.8 In-App Chat
   - 8.9 Payments & Billing
   - 8.10 Map & Location Services
   - 8.11 Market Analytics & Pricing Intelligence
   - 8.12 Subscription & Monetization
   - 8.13 Admin & Internal Tooling
   - 8.14 Contract Management
   - 8.15 Job Completion & Handoff
   - 8.16 Cancellation, Abandonment & Unhappy Paths
   - 8.17 Notifications
   - 8.18 Recurring Job Management
   - 8.19 Multi-Property Dashboard
9. [Data Flywheel & AI Competitive Moat](#9-data-flywheel--ai-competitive-moat)
10. [NoMarkup Guarantee & Platform Trust](#10-nomarkup-guarantee--platform-trust)
11. [Growth Engine & Viral Loops](#11-growth-engine--viral-loops)
12. [Financial Services Layer](#12-financial-services-layer)
13. [NoMarkup Instant — Emergency On-Demand Tier](#13-nomarkup-instant--emergency-on-demand-tier)
14. [B2B & Enterprise Channel](#14-b2b--enterprise-channel)
15. [Platform Lock-In & Retention Strategy](#15-platform-lock-in--retention-strategy)
16. [Platform Expansion — Beyond Home Services](#16-platform-expansion--beyond-home-services)
17. [Key Metrics & North Star KPIs](#17-key-metrics--north-star-kpis)
18. [Non-Functional Requirements](#18-non-functional-requirements)
19. [Security & Compliance](#19-security--compliance)
20. [Tech Stack Recommendations](#20-tech-stack-recommendations)
21. [Rollout Strategy](#21-rollout-strategy)
22. [Future Phases (Out of MVP Scope)](#22-future-phases-out-of-mvp-scope)
23. [Open Questions](#23-open-questions)
24. [Appendices](#24-appendices)

---

## 1. Overview & Vision

**NoMarkup** is a reverse-auction service marketplace where customers post home-service jobs and providers compete on price — driving costs down through market dynamics while increasing take-home pay for skilled technicians.

The home services industry is broken. Large platforms (Angi, Thumbtack) and franchise service companies charge inflated margins that hurt both consumers and the technicians doing the work. A customer gets quoted $40,000 for an HVAC replacement when the parts cost $8,000 wholesale and shipping runs $2,000. The remaining $30,000 is margin — split between the company, the platform, and overhead that adds zero value to the person writing the check or the person doing the install.

NoMarkup eliminates that. Customers define the job, set their terms, and let qualified providers compete in a time-boxed reverse auction. Providers bid based on their actual costs and desired margin — not an artificially inflated price dictated by a franchise or lead-gen platform. The result: customers pay fair market rates, and providers keep more of what they earn.

### Core Principles

- **Market-driven pricing.** Reverse auctions let supply and demand set the price, not corporate margin targets.
- **Transparency.** Real-time market analytics show customers what a service should cost and show providers what the market will bear. No hidden fees, no inflated quotes.
- **Trust through verification.** Two-way reviews, verified identities, and AI-powered fraud detection ensure both sides of every transaction are legitimate.
- **Technician-first.** Independent technicians and small businesses can compete on equal footing with large companies — winning on quality, speed, and price rather than marketing spend.

### Scope

- **MVP:** Web application. Reverse-auction bidding marketplace with integrated payments, in-app chat, two-way reviews, AI fraud detection, and market pricing intelligence.
- **Launch market:** Seattle, WA. Scale path: city → state → national.
- **Platform expansion:** Native mobile applications (iOS/Android) post-MVP.
- **Future phases:** Materials/hardware procurement at volume — leveraging platform scale to negotiate wholesale pricing and eliminate supply-chain markups for both providers and customers.

### Revenue Model

MVP ships with both capabilities, decision on primary model to be made pre-launch:

- **Subscription fee** — Monthly fee for customers and/or service providers.
- **Transaction percentage** — Platform takes a percentage of each completed transaction.

## 2. Market Opportunity

### Total Addressable Market (TAM)

The U.S. home services market is valued at **$657 billion annually** (2025, Harvard Joint Center for Housing Studies). This includes all residential maintenance, repair, improvement, and emergency services — from routine lawn care to full HVAC replacements.

| Market Segment | Annual Spend (US) | NoMarkup Relevance |
|---|---|---|
| Home improvement & remodeling | $427B | High — large-ticket jobs, highest markup potential |
| Home maintenance & repair | $153B | High — recurring and one-time services, core MVP |
| Emergency home services | $77B | High — NoMarkup Instant tier (Section 13) |
| **Total** | **$657B** | |

### Serviceable Addressable Market (SAM)

NoMarkup targets digitally-influenced home services — jobs where the customer searches online, compares options, and books digitally. This represents approximately **40% of the TAM** based on current digital adoption in home services:

**SAM: ~$263 billion annually**

### Serviceable Obtainable Market (SOM) — Year 1

Seattle metro home services market: approximately **$8.5 billion annually**. With a target of 1% market penetration in year 1:

**SOM Year 1: ~$85 million GMV** → Platform revenue at 5-8% take rate: **$4.25M–$6.8M**

### Path to $1B+ GMV

| Timeline | Market | Target GMV | Revenue (5-8% take) |
|---|---|---|---|
| Year 1 | Seattle metro | $85M | $4.25M–$6.8M |
| Year 2 | Washington State + Portland | $350M | $17.5M–$28M |
| Year 3 | Pacific Northwest + 3 major metros | $1.2B | $60M–$96M |
| Year 5 | National (top 25 metros) | $5B+ | $250M–$400M |

These projections exclude financial services revenue (Section 12), which has the potential to **double the revenue per transaction** through financing, insurance, and provider working capital products.

### Why Now

1. **Post-COVID digital adoption.** Consumers expect to book everything online. The home services industry is the last major category that hasn't been fully digitized.
2. **Inflation and cost sensitivity.** Consumers are more price-conscious than ever. A platform that provably reduces costs has immediate product-market fit.
3. **Gig economy maturity.** Independent skilled tradespeople are increasingly comfortable with platform-based work. The stigma of "app-based work" has disappeared.
4. **AI/ML infrastructure is commoditized.** Building fraud detection, pricing intelligence, and matching algorithms is now achievable for a startup — not just Big Tech.
5. **Trust deficit at all-time high.** Consumer trust in contractors is at historic lows. A platform that solves trust through verification, transaction transparency, and guarantees wins by default.

## 3. Problem Statement

The home services industry has a transparency, accountability, and access problem that hurts customers and honest service providers alike. No existing platform solves it — they either add more fees on top of an already broken system or offer zero trust and verification.

### The Problem From Four Angles

**1. Systemic Price Inflation**

A homeowner needed HVAC and furnace replacements. A service provider quoted $40,000. The homeowner's brother — who owns an HVAC company — purchased the same parts wholesale for $8,000 and shipped them for $2,000. The $30,000 delta is pure margin: corporate overhead, franchise fees, and platform lead-gen costs that add zero value to the customer or the technician performing the install.

This is not an outlier. It is how the industry operates. Customers have no visibility into what parts and labor actually cost, and no leverage to challenge inflated quotes.

**2. Labor and Materials Fraud**

A homeowner hired a contractor to fix a leak. The technician completed the repair in one hour using approximately $125 in materials, then sat in his service vehicle for eight additional hours. The bill: 9 hours of labor at $125/hour and over $5,000 in parts. The homeowner had to review their own security camera footage, identify the actual materials used, and call the provider to dispute the charges.

The burden of proof fell entirely on the customer. There was no platform, no system, and no accountability mechanism to prevent or catch this. The customer had to be their own investigator.

**3. Discovery and Vetting Is Broken**

A homeowner needed a simple window seal. What should have been a straightforward job — identify a provider, get a fair price, get on a schedule — turned into weeks of vetting contractors. After all that effort, the contractor he found still didn't do quality work. There was no recourse.

The standard should be three clicks: post the job, pick a vetted provider, get scheduled. Every existing platform fails this test for most service categories.

**4. Business Owners Are Victims Too**

A service business owner discovered that his own employees were coming in on weekends, taking company equipment, and performing side work for his customers — using his tools, his reputation, and his client relationships to pocket income off the books.

There is no platform that gives business owners visibility into whether work is being performed legitimately under their name. The same lack of transparency that enables customer-facing fraud enables internal theft and moonlighting.

**5. Family Safety**

When a contractor walks into your home, they have access to your family, your belongings, and your personal space. Yet vetting contractors for criminal history, valid licensing, and insurance is rarely done by any existing platform — and almost never done by individual customers. Families are left trusting strangers with no verified background, no accountability trail, and no recourse if something goes wrong.

This is not a convenience problem. It is a safety problem. A marketplace that sends unverified individuals into people's homes without identity verification, background checks, and a documented transaction trail is putting families at risk of theft, fraud, and worse.

### Why Existing Platforms Don't Solve This

| Platform | What It Does | What It Doesn't Do |
|---|---|---|
| **Angi / Thumbtack** | Lead generation. Connects customers to providers. | Doesn't verify pricing fairness, doesn't process payments, doesn't ensure accountability. Adds another fee layer. |
| **TaskRabbit** | Task-based matching for simple jobs. | Limited service categories. No reverse auction. No market intelligence. |
| **Facebook Marketplace / Craigslist** | Free-form listings. | Zero verification, zero payment protection, zero trust layer. Attracts scams. |
| **Large franchise companies** (e.g., national HVAC, plumbing chains) | Brand recognition and marketing reach. | Inflated margins fund corporate overhead, not technician pay. Customers pay a premium for a logo. |

### The Root Cause

Every problem above stems from the same structural failure: **there is no transparent, verified, market-driven marketplace for home services.** Customers lack pricing intelligence. Honest providers lack a level playing field. Bad actors face no accountability. And no platform has the payment integration, identity verification, and fraud detection necessary to build real trust.

NoMarkup is that marketplace.

## 4. Target Users & Personas

NoMarkup serves two sides of a marketplace. Any user can hold both roles simultaneously. Users are not locked into a single persona — a plumber who needs their lawn mowed is both a provider and a customer.

### Customer Personas

**Homeowner**
- **Who:** Single-property homeowner in Seattle metro. Mix of urban condos, suburban houses, older homes needing ongoing maintenance.
- **Motivation:** Get fair pricing on home services without spending weeks vetting contractors. Know their family is safe when someone enters their home.
- **Pain points:** No visibility into what things should cost. Vetting is manual and unreliable. Has been overcharged, defrauded, or received poor quality work with no recourse. Jobs frequently run late or providers no-show with no accountability.
- **Success:** Posts a job, reviews vetted providers, selects one, and gets on a schedule — in minutes, not weeks. Pays a fair market rate. Work gets done on time, as scoped. Leaves a review. Moves on with their life.

**Property Manager**
- **Who:** Manages residential properties on behalf of owners. Handles maintenance coordination across multiple units and properties.
- **Motivation:** Reliable, repeatable service at consistent pricing. Needs to move fast when issues arise (burst pipe, broken HVAC) and have trusted providers on call.
- **Pain points:** Managing a rolodex of contractors manually. Inconsistent pricing across jobs. Difficulty scaling service relationships when taking on new properties.
- **Success:** Has a bench of verified, top-rated providers. Can post recurring and one-off jobs across all managed properties. Gets volume-consistent pricing. Tracks all spend and service history in one place.

**Multi-Property Owner**
- **Who:** Owns multiple residential properties (rentals, vacation homes, investment properties). Wants to build long-term provider relationships that scale across their portfolio.
- **Motivation:** One platform to manage services across all properties. Wants providers who know their properties and can handle recurring work reliably.
- **Pain points:** Coordinating service across multiple addresses is fragmented. No leverage on pricing despite bringing repeat, multi-property volume. Starting from scratch with new providers for each property.
- **Success:** Establishes ongoing relationships with providers who service multiple properties. Gets favorable pricing through volume and loyalty. Has a single dashboard for all service activity, payments, and reviews across their portfolio.

### Provider Personas

**Independent Technician**
- **Who:** Licensed, skilled tradesperson working independently. Electrician, plumber, HVAC tech, handyman, landscaper.
- **Motivation:** Get direct access to customers without paying franchise fees or lead-gen platforms that eat their margin. Set their own prices based on actual costs. Build a reputation on quality of work.
- **Pain points:** Competing against companies with marketing budgets, not better service. Lead-gen platforms charge per lead regardless of whether the job converts. No way to showcase their track record to new customers.
- **Success:** Wins jobs based on skills, reviews, and fair pricing. Keeps more of every dollar earned. Builds a growing base of repeat customers through the platform. No franchise overhead.

**Small Business Owner (Provider)**
- **Who:** Runs a service business with a small crew. Has a business license, EIN, and insurance.
- **Motivation:** Win volume. Compete on price and quality against larger companies. Keep employees busy and billable.
- **Pain points:** Large franchise companies dominate SEO and paid advertising. Existing platforms favor companies willing to pay the most for leads. Employees may moonlight using company resources with no accountability.
- **Success:** Fills the team's schedule through a steady pipeline of competitively won jobs. Has visibility into what work is being performed under the business name. Builds a verified reputation that attracts repeat and referral business.

### Dual-Role User

- **Who:** Any user who is both a customer and a provider. A plumber who needs their lawn mowed. A landscaper who needs electrical work.
- **Behavior:** Single account with both roles enabled. Can post jobs as a customer and bid on jobs as a provider. Reviews accumulate separately for each role.
- **Design implication:** The platform must support seamless role switching within a single account. Profile, reviews, and verification status are maintained independently for each role.

### Internal Personas

**NoMarkup Admin**
- **Who:** Internal team member managing platform operations.
- **Responsibilities:** Toggle verification requirements (on/off for MVP demo), review flagged accounts and transactions, manage service taxonomy, monitor platform health and fraud detection outputs, access hidden analytics dashboard (Shift+~ toggle).
- **Tools needed:** Admin panel with user management, verification overrides, fraud review queue, analytics dashboards.

**NoMarkup Support**
- **Who:** Internal team member handling user-facing issues.
- **Responsibilities:** Mediate payment disputes, handle escalations from reviews or fraud flags, assist with onboarding and document verification issues, manage account suspensions.
- **Tools needed:** Support ticket system, access to chat transcripts (with appropriate privacy controls), payment and transaction history, user verification status.

## 5. Competitive Landscape

### Direct Competitors

**Angi (formerly Angie's List / HomeAdvisor)**
- **Model:** Lead generation. Providers pay per lead or for premium placement. Angi takes a cut regardless of whether the job converts.
- **Verification:** Basic screening. No real-time identity verification or document validation at scale.
- **Pricing transparency:** None. Customers get quotes from providers with no market context for what the job should cost.
- **Payment:** Off-platform. Angi facilitates the introduction but does not process payments.
- **Review integrity:** Reviews are not tied to verified on-platform transactions. No AI fraud detection.
- **Who it favors:** Providers willing to pay the most for leads. Customers pay inflated prices to cover the provider's lead-gen costs.

**Thumbtack**
- **Model:** Lead generation. Providers pay to send quotes. Cost per lead varies by service category and market.
- **Verification:** Background checks available but not comprehensive. No business license or insurance verification built into the platform.
- **Pricing transparency:** Providers set their own prices. No market intelligence for customers.
- **Payment:** Primarily off-platform. Limited on-platform payment options.
- **Review integrity:** Reviews exist but are not verified against payment records. No fraud detection layer.
- **Who it favors:** Providers with marketing budgets. Independent technicians struggle to compete with companies buying more leads.

**TaskRabbit**
- **Model:** Task-based matching with platform fee. Focused on simpler, shorter-duration jobs (furniture assembly, moving help, minor repairs).
- **Verification:** Background checks on Taskers. Limited trade-specific license verification.
- **Pricing transparency:** Taskers set hourly rates. Customers can see rates upfront but have no market benchmark.
- **Payment:** On-platform. TaskRabbit processes payments and takes a service fee.
- **Review integrity:** Reviews tied to completed tasks. No AI-based fraud analysis.
- **Who it favors:** Customers seeking simple tasks. Not designed for complex, high-value home services (HVAC, electrical, plumbing).

**Yelp**
- **Model:** Advertising. Providers pay for premium placement and promoted listings. Reviews are free.
- **Verification:** None. Any business can claim a listing. No license, insurance, or identity verification.
- **Pricing transparency:** None. Yelp is a discovery platform, not a transactional one.
- **Payment:** Off-platform entirely. Yelp plays no role in the transaction.
- **Review integrity:** Yelp's review filter is opaque and controversial. Legitimate reviews are frequently hidden. No transaction verification. Reviews can be left by anyone, whether or not they were a real customer.
- **Who it favors:** Businesses willing to pay for advertising. The algorithm and ad placement determine visibility, not quality of service.

**Porch**
- **Model:** Lead generation tied to home purchase data. Partners with home improvement retailers and real estate companies.
- **Verification:** Basic pre-screening. Varies by provider tier.
- **Pricing transparency:** Limited. Provides cost estimates but not real-time market data.
- **Payment:** Primarily off-platform.
- **Review integrity:** Reviews exist but are not transaction-verified.
- **Who it favors:** Providers embedded in the Porch partner network. Independent operators have limited visibility.

### Indirect Competitors

**Facebook Marketplace**
- **Model:** Free listings. No fees. No transactional layer.
- **Verification:** None. Facebook profile is the only identity. No license, insurance, or background checks.
- **Pricing transparency:** None. Pure negotiation between strangers.
- **Payment:** Off-platform. Cash, Venmo, or whatever the parties agree to.
- **Review integrity:** No structured review system for services. Reputation is informal (comments, word of mouth).
- **Who it favors:** No one. Both parties take on maximum risk. Scams are common. No recourse.

**Craigslist**
- **Model:** Free classified listings. Minimal moderation.
- **Verification:** None. Anonymous postings are the norm.
- **Pricing transparency:** None.
- **Payment:** Off-platform. No protection.
- **Review integrity:** No review system whatsoever.
- **Who it favors:** Bad actors. The lack of any verification, accountability, or transaction infrastructure makes it the highest-risk option for both customers and providers.

**Nextdoor**
- **Model:** Neighborhood social network with business recommendations. Ad-supported.
- **Verification:** Address verification for residents. No verification for recommended businesses.
- **Pricing transparency:** None. Recommendations are anecdotal.
- **Payment:** Off-platform.
- **Review integrity:** Informal recommendations, not structured reviews. No transaction verification.
- **Who it favors:** Established local businesses with existing neighborhood relationships. New providers and independent technicians have no entry point.

**Large Franchise Service Companies** (ServiceMaster, Mr. Rooter, One Hour Heating & Air, etc.)
- **Model:** Franchise model. Technicians work under a brand that charges corporate overhead, franchise fees, and marketing costs — all passed to the customer.
- **Verification:** Internal employee vetting. Customers trust the brand, not the individual.
- **Pricing transparency:** Opaque. Quotes include embedded margin for corporate, franchise, and marketing overhead. Customers cannot see the actual cost of parts and labor.
- **Payment:** On-site or through the franchise. Prices are non-negotiable.
- **Review integrity:** Reviews on third-party platforms. The franchise has no internal mechanism to tie reviews to verified transactions.
- **Who it favors:** The corporate entity. Technicians earn a fraction of what the customer pays. Customers pay a premium for a logo.

### Competitive Differentiation — NoMarkup

| Capability | NoMarkup | Angi / Thumbtack | TaskRabbit | FB / Craigslist | Franchises |
|---|---|---|---|---|---|
| **Pricing model** | Reverse auction — market sets the price | Provider sets price + lead-gen fee | Provider sets hourly rate + platform fee | Unstructured negotiation | Corporate-set pricing with embedded margin |
| **Market pricing intelligence** | Built-in. Customers see fair market range. | None | None | None | None |
| **Payment processing** | On-platform. Milestones, upfront, recurring, payment plans. | Off-platform | On-platform (simple) | Off-platform | On-site / franchise billing |
| **Identity verification** | Full document verification: licenses, EIN, insurance, ID | Basic screening | Background check | None | Internal HR only |
| **Review integrity** | Two-way reviews verified by AI/ML against confirmed transactions | Unverified | Task-linked | None | Third-party only |
| **Fraud detection** | AI/ML: IP tracking, location analysis, bot detection, transaction verification | None | None | None | None |
| **Who benefits** | Both sides. Customers pay fair prices. Providers keep more margin. | Lead buyers | Simple-task Taskers | Neither (high risk) | Corporate entity |
| **Safety** | Verified identities, documented transaction trails, background accountability | Minimal | Background checks | None | Brand trust only |

### Summary

No existing platform combines reverse-auction pricing, on-platform payments, AI-verified reviews, market pricing intelligence, and comprehensive identity verification. Most platforms are either lead-generation businesses that add cost without adding trust, or unstructured marketplaces that offer no protection at all. NoMarkup is the first platform designed to make the market transparent, accountable, and fair for both sides of every transaction.

## 6. Core Concepts & Terminology

| Term | Definition |
|---|---|
| **Job** | A service request posted by a customer. Defines the scope, service category, location, schedule, and auction parameters. |
| **Reverse Auction** | The bidding model. Providers compete by offering lower prices. The customer selects from the bids — lowest price is not automatically selected; the customer can factor in reviews, qualifications, and profile. |
| **Bid** | A price submission from a provider on an open job. Contains the price and is optionally accompanied by a chat message. |
| **Offer Accepted Price** | An optional target price set by the customer. Providers can accept this price with one click (instead of entering a custom bid amount), signaling willingness to do the job at the customer's stated budget. Multiple providers can accept the offer price; the customer still selects which provider to award based on profile, reviews, and qualifications. This is not an auto-award — it is a pre-set price that streamlines the bidding process. |
| **Starting Bid** | An optional ceiling price set by the customer. All bids must come in at or below this amount. If not set, bidding is open-ended. |
| **Auction Window** | The time period during which a job accepts bids. Set by the customer (e.g., 24 hours, 3 days, 1 week). Customer can also close the auction manually. |
| **Award** | When a customer selects a provider's bid and the job moves from auction to contracted status. |
| **Milestone** | A defined checkpoint in a contract where a partial payment is released. Milestones are proposed by the provider and accepted/rejected by the customer. |
| **Global Terms** | Default payment and service terms set by a provider on their profile. Apply to all bids unless overridden by local terms. |
| **Local Terms** | Per-contract terms that override the provider's global terms. Negotiated via chat between customer and provider. |
| **Service Category** | A classification in the service taxonomy (e.g., HVAC > Furnace Replacement). Drives dropdown menus, search, and matching. |
| **Provider Profile** | A provider's public-facing page: qualifications, service categories, reviews, verification badges, global terms, and portfolio. |
| **Customer Profile** | A customer's public-facing page: reviews from providers, verification status, and job history (aggregate, not detailed). |
| **Trust Score** | A composite metric derived from reviews, verification status, transaction history, and fraud detection signals. Displayed on profiles for both customers and providers. |
| **Market Range** | The AI-generated price range for a given service category in a given market. Shown to customers during job posting and to providers during bidding. |
| **Verification Badge** | Visual indicator on a profile showing which verification steps have been completed (identity, license, insurance, EIN). |
| **Dual-Role Account** | A single user account that can operate as both a customer and a provider. Reviews and verification are tracked independently per role. |
| **Fraud Signal** | A data point flagged by the AI/ML system as potentially fraudulent: unusual IP patterns, review manipulation, bot activity, mismatched location data. |
| **Repost** | When a customer rejects all bids and creates a new auction for the same job. Reposts are tracked — frequent reposting flags potential bad-actor behavior. |
| **Recurring Job** | A job with a defined recurrence schedule (weekly, biweekly, monthly). The provider bids on the recurring rate. Payments process automatically per the schedule. |
| **Offer Accepted Price** | An optional target price set by the customer during job posting. Providers can accept this price with one click, signaling willingness to do the job at the customer's budget. The customer still selects the provider — acceptance is not an auto-award. |
| **Contract** | The formal agreement created after a bid is awarded. Contains job scope, payment terms, schedule, and milestones. Both parties must accept before work begins. Identified by a unique contract number (e.g., NM-2026-00001). |
| **Change Order** | A formal modification to an active contract after the first payment event. Requires acceptance by both parties. Used to add milestones, adjust scope, or amend terms. |
| **Feedback Score** | One of four Trust Score dimensions. Measures quality of service via star ratings, value-for-service, on-time delivery, and communication. |
| **Volume Score** | One of four Trust Score dimensions. Measures platform activity: completed transactions, repeat customers, response time, tenure. |
| **Risk Score** | One of four Trust Score dimensions. Measures verification completeness and compliance: identity, licensing, insurance, cancellation rate, dispute rate. |
| **Fraud Score** | One of four Trust Score dimensions. Inverse score measuring absence of fraudulent signals: account integrity, review integrity, transaction integrity, behavioral integrity. |
| **Property** | A service location associated with a customer's account. Multi-property owners manage multiple properties, each with its own address, nickname, and job history. |
| **NoMarkup Guarantee** | Platform guarantee on all on-platform transactions. If work isn't completed as agreed, NoMarkup pays to make it right — up to the full contract value. Funded by a 2-3% Guarantee fee within the platform take rate. |
| **NoMarkup Instant** | Emergency on-demand tier for urgent jobs. Customers describe the emergency, the platform matches them with a verified available provider, and work begins within hours. Premium pricing at 1.5-2x market rate. |
| **Data Flywheel** | The compounding intelligence advantage created by platform transaction data. Every completed job makes pricing more accurate, fraud detection more precise, and matching more effective. |
| **Take Rate** | Platform revenue as a percentage of GMV. Includes marketplace fees, Guarantee fund contribution, and financial services revenue. |
| **GMV (Gross Merchandise Value)** | Total value of all transactions processed through the platform. The primary measure of marketplace health. |
| **Liquidity** | The percentage of posted jobs that receive at least one bid within 24 hours. The primary measure of marketplace health on the supply side. |
| **Provider Working Capital** | Cash advances to providers against awarded contracts, enabling them to purchase materials before receiving payment. Automatically repaid from job payout. |
| **Disintermediation** | When users take their relationship off-platform to avoid fees. The primary threat to marketplace businesses. Countered by the Guarantee, reputation lock-in, financial services, and pricing intelligence. |

## 7. Service Taxonomy

The service taxonomy drives dropdown menus, search, job matching, and market analytics. It must be generic enough to cover all home services without requiring extensive custom scoping for routine projects, but specific enough that providers can find relevant jobs and customers get accurate market pricing.

### Taxonomy Structure

Three-level hierarchy: **Category > Subcategory > Service Type**

### Starter Taxonomy (MVP)

| Category | Subcategories | Example Service Types |
|---|---|---|
| **HVAC** | Heating, Cooling, Ventilation, Ductwork | Furnace install, AC repair, duct cleaning, thermostat install, heat pump replacement |
| **Plumbing** | Pipes, Fixtures, Water Heaters, Drains | Leak repair, faucet install, water heater replacement, drain clearing, sewer line repair |
| **Electrical** | Wiring, Panels, Lighting, Outlets | Panel upgrade, outlet install, light fixture install, wiring repair, EV charger install |
| **Roofing** | Repair, Replacement, Gutters, Inspection | Roof repair, full replacement, gutter cleaning, gutter install, roof inspection |
| **Painting** | Interior, Exterior, Staining, Prep Work | Interior room painting, exterior house painting, deck staining, drywall patching |
| **Landscaping** | Lawn Care, Tree Service, Hardscape, Irrigation | Lawn mowing, tree trimming, tree removal, patio install, sprinkler repair |
| **Cleaning** | Residential, Deep Clean, Move-in/Move-out, Windows | Regular cleaning, deep clean, post-construction cleanup, window washing |
| **Flooring** | Hardwood, Tile, Carpet, Vinyl | Hardwood install, tile install, carpet replacement, floor refinishing |
| **Pest Control** | Insects, Rodents, Wildlife, Prevention | Ant treatment, rodent removal, termite inspection, wildlife exclusion |
| **Appliance Repair** | Kitchen, Laundry, HVAC Appliances | Refrigerator repair, washer repair, dishwasher install, dryer vent cleaning |
| **Fencing** | Wood, Chain Link, Vinyl, Iron | Fence install, fence repair, gate install, post replacement |
| **Concrete & Masonry** | Driveways, Patios, Foundations, Retaining Walls | Driveway pour, patio install, foundation crack repair, retaining wall build |
| **Windows & Doors** | Installation, Repair, Sealing, Screens | Window install, window seal, door install, screen repair, weatherstripping |
| **Garage** | Doors, Openers, Organization, Flooring | Garage door install, opener repair, shelving install, epoxy flooring |
| **General Handyman** | Minor Repairs, Assembly, Mounting, Misc | Furniture assembly, TV mounting, shelf install, minor drywall repair, caulking |
| **Security** | Cameras, Alarms, Locks, Lighting | Camera install, alarm system install, lock rekey, motion light install |

### Taxonomy Design Principles

- **Admin-managed.** Categories are managed via the admin panel, not user-generated. This keeps the taxonomy clean and consistent.
- **Extensible.** New categories, subcategories, and service types can be added without schema changes.
- **Tagging support.** Jobs can be tagged with multiple service types when they span categories (e.g., a bathroom remodel may touch plumbing, tile, and painting).
- **Drives analytics.** Market pricing intelligence is calculated per service type per geographic market. The taxonomy is the foundation for all pricing data.

## 8. Feature Requirements — MVP

### 8.1 User Registration & Onboarding

**Overview:** Single registration flow that supports both customer and provider roles. Users can enable either or both roles at any time.

**Requirements:**

- **FR-1.1** Sign up via email/password or OAuth (Google, Apple).
- **FR-1.2** During registration, user selects initial role: Customer, Provider, or Both.
- **FR-1.3** Customer onboarding: name, address (service location), phone number, profile photo.
- **FR-1.4** Provider onboarding: business name (or individual name), service address/radius, phone number, profile photo, service categories (multi-select from taxonomy).
- **FR-1.5** Onboarding is a guided, step-by-step flow — not a single long form. Progress indicator shows completion percentage.
- **FR-1.6** Users can skip optional steps and return to complete them later. Required fields are clearly marked.
- **FR-1.7** A user can enable the second role at any time from account settings. Triggers the onboarding flow for that role.
- **FR-1.8** Email verification required before posting jobs or bidding.
- **FR-1.9** Phone number verification via SMS/OTP required before transacting.

### 8.2 Identity & Document Verification

**Overview:** Full document verification pipeline for providers. The UI and upload flows must be built for MVP. Verification enforcement is toggleable via admin panel for demo purposes.

**Requirements:**

- **FR-2.1** Provider verification documents (uploaded during onboarding or later):
  - Driver's license or government-issued photo ID
  - Business license (if applicable)
  - EIN documentation (if applicable)
  - Proof of insurance (general liability at minimum)
  - Trade-specific licenses (e.g., electrical license, plumbing license)
- **FR-2.2** Document upload UI: drag-and-drop or file select. Accepts PDF, JPG, PNG. File size limit: 10MB per document.
- **FR-2.3** Each document type has a status: Not Uploaded, Pending Review, Verified, Rejected (with reason).
- **FR-2.4** Verification badges display on provider profiles indicating which documents are verified.
- **FR-2.5** Admin panel toggle: "Require verification to bid" — ON/OFF. When OFF, providers can bid without verified documents (demo/MVP mode). When ON, providers must have minimum verification (ID + one qualifying document) to bid.
- **FR-2.6** Customer verification (lighter): name, address, phone, email. No document upload required for MVP. Verified badge awarded after email + phone + address confirmation.
- **FR-2.7** Business license verification: future integration with state/county licensing databases. For MVP, manual review by admin.
- **FR-2.8** Document expiration tracking: insurance and licenses have expiration dates. System alerts providers 30 days before expiration. Expired documents lose verified status. Active contracts are not affected by expiration during the contract term, but the provider cannot bid on new jobs until documents are renewed.
- **FR-2.9** Background check integration (pending Open Question #4): if background checks are included in MVP, integrate with a third-party provider (Checkr recommended). Background check status displayed as a separate badge on the provider's profile. Checks must be renewed annually. Background check is a one-time cost borne by the provider.
- **FR-2.10** Rejection and resubmission: when a document is rejected, the provider receives the rejection reason and can resubmit. Max 3 resubmission attempts per document type. After 3 rejections, the provider must contact support. Bids placed while a document was in "Pending Review" status remain active — they are not voided on rejection (the provider can resubmit while their bids stand).

### 8.3 Job Posting & Reverse Auction

**Overview:** Customers post jobs that become reverse auctions. Providers compete by bidding lower prices. The customer controls auction duration and selects the winning provider.

**Requirements:**

- **FR-3.1** Job posting form:
  - Service category (dropdown driven by taxonomy — Category > Subcategory > Service Type)
  - Job title (free text, 100 char max)
  - Job description (free text, 2000 char max)
  - Service location (address — can differ from account address for multi-property owners)
  - Photos (optional, up to 10 images)
  - Schedule preference: specific date, date range, or flexible
  - Recurrence: one-time or recurring (weekly, biweekly, monthly)
  - Starting bid (optional ceiling price)
  - Offer Accepted price (optional)
  - Auction duration (customer selects: 12 hours, 24 hours, 3 days, 7 days, custom)
  - Minimum provider review rating filter (optional, e.g., 4.0+ stars)
- **FR-3.2** Market range display: during job posting, show the customer the current market price range for the selected service type in their area (powered by Section 8.11). Display as a range bar with low/median/high.
- **FR-3.3** Job status lifecycle:
  - **Happy path:** Draft → Active (accepting bids) → Closed (auction ended) → Awarded → In Progress → Completed → Reviewed.
  - **Unhappy paths:**
    - Active → Cancelled (customer cancels before auction closes; all bidders notified)
    - Closed → Expired (no action within 48 hours)
    - Closed → Reposted (customer rejects all bids)
    - Awarded → Cancelled (customer or provider cancels before work starts; see Section 8.16)
    - In Progress → Disputed (either party opens a dispute; see Section 8.16)
    - In Progress → Abandoned (provider goes non-responsive; see Section 8.16)
    - Any active state → Suspended (admin action due to fraud or policy violation)
- **FR-3.4** Customer can close the auction early at any time and select a provider.
- **FR-3.5** Customer can reject all bids and repost. System tracks repost frequency per customer. High repost rates generate a fraud signal (see Section 8.7).
- **FR-3.6** When the auction window closes without customer action, the job moves to Closed status. Customer is notified and has 48 hours to award or repost before the job expires.
- **FR-3.7** Recurring jobs: customer defines recurrence at posting time. Provider bids on the per-occurrence rate. After award, the recurrence generates scheduled instances automatically.
- **FR-3.8** Job visibility: active jobs are visible to all providers in the matching service categories and geographic radius. Providers can filter and search by category, location, price range, and schedule.
- **FR-3.9** Zero-bid auction handling: if an auction closes with zero bids, the customer is notified with actionable suggestions: "Consider adjusting your starting bid," "Broaden your service category," or "Extend your auction window." The job moves to Closed (0 bids) status. The customer can repost with adjusted parameters. Zero-bid jobs are not counted as reposts for fraud signal purposes.
- **FR-3.10** Repost mechanics: when a customer reposts a job, a new job entity is created with a link to the original. Previous bids do not carry over — the auction starts fresh. The customer can modify job details (scope, starting bid, auction duration) during repost. Previous bidders receive a notification: "[Job Title] has been reposted with updated terms."
- **FR-3.11** Draft management: customers can save up to 10 drafts. Drafts are accessible from a "My Drafts" section in the dashboard. Drafts do not expire but are not visible to providers.

### 8.4 Bidding System

**Overview:** Providers submit bids on active jobs. Bids are visible to the customer. The customer selects the provider based on price, reviews, profile, and any chat interactions.

**Requirements:**

- **FR-4.1** Bid submission: provider enters a price. If a starting bid is set, bids must be at or below the starting bid.
- **FR-4.2** Bids are **visible to the customer only**. Providers cannot see other providers' bid amounts. This is a sealed-bid reverse auction.
- **FR-4.3** A provider can update their bid (lower it) before the auction closes. They cannot raise a bid once submitted.
- **FR-4.4** Offer Accepted: if a provider accepts the Offer Accepted price, the customer is notified. The customer still selects the provider — it is not auto-awarded. Multiple providers can accept the Offer Accepted price; the customer chooses among them.
- **FR-4.5** Bid display to customer: list view showing provider name, bid amount, trust score, review rating, verification badges, and a link to the provider's full profile.
- **FR-4.6** Customer can sort bids by: price (low to high), review rating, trust score, verification status.
- **FR-4.7** Customer can filter bids by: minimum review rating, verification status, service radius.
- **FR-4.8** When a customer awards a job, the winning provider is notified. All other bidders receive a "not selected" notification.
- **FR-4.9** Bid withdrawal: a provider can withdraw a bid before the auction closes. Frequent withdrawals are tracked and factor into trust score.

### 8.5 Provider Profiles & Terms

**Overview:** Provider profiles are public-facing pages that showcase qualifications, reviews, and terms. They serve as the primary trust signal for customers making award decisions.

**Requirements:**

- **FR-5.1** Profile fields:
  - Display name (business name or individual name)
  - Profile photo / business logo
  - Bio / description (500 char max)
  - Service categories (from taxonomy)
  - Service area (radius from address or specific zip codes)
  - Verification badges (auto-populated from verification status)
  - Review rating (aggregate) and review count
  - Trust score
  - Member since date
  - Jobs completed count
  - Response time (average time to first bid or chat response)
  - On-time completion rate
- **FR-5.2** Global terms: providers set default payment terms on their profile:
  - Payment timing: upfront, milestone-based, upon completion, payment plan, recurring
  - Milestone structure (if applicable): default milestone percentages
  - Cancellation policy
  - Warranty/guarantee terms
- **FR-5.3** Global terms are visible on the provider's profile and apply to all bids unless overridden.
- **FR-5.4** Local terms: per-contract terms negotiated via chat. Override global terms for that specific contract. Both parties must explicitly accept local terms in the chat or contract UI.
- **FR-5.5** Portfolio section: providers can upload photos of past work (up to 20 images) with captions.
- **FR-5.6** Profile completeness indicator: shows providers what percentage of their profile is filled out. Encourages completion.

### 8.6 Two-Way Reviews & Trust System

**Overview:** Both customers and providers leave reviews after job completion. Reviews are tied to verified on-platform transactions. Trust scores are composite metrics visible on profiles.

**Requirements:**

- **FR-6.1** After a job moves to Completed status, both parties are prompted to leave a review. Review window: 14 days after completion.
- **FR-6.2** Review structure:
  - Star rating (1–5)
  - Written review (2000 char max)
  - Category-specific ratings: quality of work, timeliness, communication, value (customer reviewing provider); payment promptness, accuracy of scope, communication, property access (provider reviewing customer)
- **FR-6.3** Reviews are only accepted for jobs that have a confirmed on-platform payment. No payment = no review. This is the foundation of review integrity.
- **FR-6.4** Reviews are published after both parties submit, or after the 14-day window closes — whichever comes first. This prevents retaliatory reviewing based on seeing the other party's review.
- **FR-6.5** Review responses: the reviewed party can post a single public response (500 char max) to any review.
- **FR-6.6** Trust score is a composite of four independently calculated dimensions (see Appendix C for full specification):
  - **Feedback Score (35%):** Star ratings, value-for-service ratings, on-time delivery rate, communication ratings.
  - **Volume Score (20%):** Completed transactions, repeat customer rate, response time, account tenure.
  - **Risk Score (25%):** Identity verification, business documentation, insurance status, cancellation/no-show rate, dispute rate.
  - **Fraud Score (20%):** Account integrity, review integrity, transaction integrity, behavioral integrity. Inverse score — higher means cleaner.
- **FR-6.7** Trust score is displayed as a 0–100 score with a tier badge (Under Review, New, Rising, Trusted, Top Rated). Customers can click through to see the breakdown across all four dimensions with detailed sub-scores.
- **FR-6.8** Review flagging: users can flag reviews for fraud or abuse. Flagged reviews enter the admin review queue.

### 8.7 AI/ML Fraud Detection

**Overview:** AI/ML system that monitors platform activity to detect and flag fraudulent behavior. This is an MVP requirement — the models can be basic at launch and improve over time, but the data collection and flagging infrastructure must be built from day one.

**Requirements:**

- **FR-7.1** Data collection (all activity logged from day one):
  - IP addresses per session
  - Device fingerprints (browser fingerprinting via canvas, WebGL, audio context, and installed fonts — MAC addresses are not accessible from web browsers)
  - Geolocation data (GPS if permitted, IP-based geolocation as fallback)
  - Session behavior (click patterns, time on page, navigation paths)
  - Account creation patterns (velocity, shared IPs across accounts)
  - Review submission patterns (timing, sentiment, linguistic similarity)
  - Bid patterns (velocity, pricing anomalies, win rate anomalies)
  - Payment patterns (chargebacks, disputes, refund rates)
- **FR-7.2** Review fraud detection:
  - Cross-reference reviewer IP/device with reviewed party's IP/device — flag matches
  - Detect review rings: clusters of accounts that only review each other
  - Linguistic analysis: flag reviews with suspiciously similar language across different reviewers
  - Timing analysis: flag bursts of reviews in short timeframes
  - Verify that a confirmed on-platform payment exists for every review (hard requirement, not just a signal)
- **FR-7.3** Account fraud detection:
  - Flag accounts created from the same IP/device
  - Flag accounts with the same or similar identity documents
  - Detect bot activity: CAPTCHA on registration, rate limiting on API endpoints, behavioral analysis (inhuman click speeds, linear mouse movement)
  - Flag accounts that only interact with a single other account (potential sock puppets)
- **FR-7.4** Bid manipulation detection:
  - Flag providers who consistently bid just below other providers (impossible in a sealed-bid system, but flag any data leakage)
  - Flag providers with abnormally high win rates
  - Flag customers who consistently repost to drive prices lower unfairly
- **FR-7.5** Fraud signal output: each signal generates a confidence score (0–1). Signals above a configurable threshold enter the admin fraud review queue.
- **FR-7.6** Automated actions at high confidence: temporary account suspension pending admin review, bid removal, review quarantine.
- **FR-7.7** Admin fraud dashboard: view all flagged signals, drill into user activity, approve/dismiss flags, take action (warn, suspend, ban).
- **FR-7.8** MVP approach: rule-based detection with basic ML models (anomaly detection on review/bid patterns). Collect all data from day one. Models improve as data volume grows.

### 8.8 In-App Chat

**Overview:** Real-time messaging between customers and providers. Used during the bidding process for questions and scope clarification, and during the contract for coordination and term negotiation.

**Requirements:**

- **FR-8.1** Chat access rules:
  - **Post-bid:** A provider who has submitted a bid on a job can chat with that job's customer. Chat opens automatically upon bid submission.
  - **Pre-bid inquiry:** A provider who has not yet bid can initiate a chat by clicking "Ask a Question" on the job detail page. This sends a chat request to the customer. The customer can accept or ignore the request. Accepted requests open a chat channel. This allows providers to clarify scope before committing to a bid.
  - **Post-award:** Chat continues between the awarded provider and customer through job completion. Chat channels with non-awarded providers remain accessible (read-only) but new messages are disabled after award.
  - **Self-bid prevention:** A dual-role user cannot bid on their own job posting. The system blocks this at the API level.
- **FR-8.2** Real-time messaging with typing indicators and read receipts.
- **FR-8.3** Message types: text, image attachments (for showing job site, materials, etc.), and file attachments (PDF for invoices, scope documents).
- **FR-8.4** Chat persists across the job lifecycle. Pre-bid conversations are preserved through award, contract, and completion.
- **FR-8.5** Push notifications for new messages (web push for MVP, mobile push post-MVP).
- **FR-8.6** Chat is searchable by the user within their own conversations.
- **FR-8.7** Chat transcripts are accessible to NoMarkup Support for dispute resolution (with appropriate privacy disclosures in ToS).
- **FR-8.8** Off-platform communication controls:
  - **Pre-award:** No exchange of phone numbers, email addresses, or off-platform contact information in chat. System detects and blocks attempts with a warning message. This preserves transaction integrity during the bidding phase.
  - **Post-award:** After a job is awarded, the provider needs to coordinate arrival, access, and logistics. The system provides a "Share Contact Info" button that both parties can use to opt in to sharing their phone number through the platform. Phone numbers shared this way are displayed in the chat but are not exportable. This balances coordination needs with platform integrity.
  - **Detection approach:** Regex pattern matching for phone numbers, email addresses, and common social handles. Warn and flag but do not block messages entirely — the message is held for the user to confirm they want to send it. False positives are preferable to blocked legitimate messages.
- **FR-8.9** Chat supports negotiation of local terms: a provider can send a "proposed terms" message type that the customer can Accept or Reject inline.
- **FR-8.10** Unread message badge on navigation. Conversation list sorted by most recent activity.

### 8.9 Payments & Billing

**Overview:** All payments processed on-platform via a payment processor (Stripe Connect recommended). Flexible payment structures defined per contract. On-platform payment is mandatory — it is the foundation of review integrity and fraud detection.

**Requirements:**

- **FR-9.1** Payment processor integration: Stripe Connect Express accounts. NoMarkup is the platform; providers are connected Express accounts. Express provides Stripe-hosted onboarding (reduces PCI and KYC burden) while giving NoMarkup control over payout timing (required for escrow behavior). See Appendix B for detailed rationale.
- **FR-9.2** Customer payment methods: credit/debit card, Apple Pay, Google Pay. Stored securely via payment processor (NoMarkup never stores raw card data).
- **FR-9.3** Provider payout methods: bank account (ACH) linked through the payment processor's onboarding flow.
- **FR-9.4** Payment structures (defined per contract):
  - **Full upfront:** Customer pays 100% before work begins.
  - **Upon completion:** Customer pays 100% after job is marked complete.
  - **Milestone-based:** Provider defines milestones with amounts. Customer approves each milestone. Payment releases on customer approval of each milestone.
  - **Payment plan:** Total amount split into scheduled installments.
  - **Recurring:** For recurring jobs — automatic payment per occurrence on the defined schedule.
- **FR-9.5** Milestone flow:
  1. Provider proposes milestones (description + amount) during bidding or via chat.
  2. Customer accepts or requests changes.
  3. As work progresses, provider marks a milestone complete.
  4. Customer reviews and approves the milestone.
  5. Payment for that milestone is released to the provider.
  6. If customer disputes a milestone, it enters the dispute resolution queue.
- **FR-9.6** Escrow: for upfront and milestone payments, funds are held by the payment processor until release conditions are met (milestone approval, job completion, or dispute resolution).
- **FR-9.7** Dispute resolution: either party can open a dispute. Dispute freezes the relevant payment. NoMarkup Support reviews chat transcripts, contract terms, and job details to mediate. Resolution: release payment, partial refund, or full refund.
- **FR-9.8** Platform fees: configurable per-transaction percentage and/or flat fee. Applied at payment time. Visible to both parties in the payment breakdown.
- **FR-9.9** Payment history: both parties can view full transaction history per contract, with itemized breakdowns (service amount, platform fee, tax if applicable).
- **FR-9.10** Automatic receipts sent via email after each payment.
- **FR-9.11** Refund support: full or partial refunds processed through the payment processor. Refund reason tracked. Platform fee handling on refunds: full refund = platform fee refunded; partial refund = platform fee reduced proportionally.
- **FR-9.12** Provider payout onboarding: providers must complete Stripe Express onboarding (identity verification, tax form W-9, bank account linking) before they can receive payouts. Providers can bid before completing Stripe onboarding, but payout cannot be processed until onboarding is complete. The system prompts providers to complete Stripe onboarding after their first bid is awarded.
- **FR-9.13** Provider payout timing: Stripe Connect standard payout schedule (2 business days after payment release). Providers can view payout status in their Stripe Express dashboard.
- **FR-9.14** Tax handling: NoMarkup generates 1099-K forms for providers who exceed IRS reporting thresholds ($600/year). Tax calculation and remittance for sales tax is out of scope for MVP — flagged for Phase 2 with a tax automation service (TaxJar, Avalara, or Stripe Tax).
- **FR-9.15** Currency: USD only for MVP.

### 8.10 Map & Location Services

**Overview:** Two map features: (1) providers can browse jobs on a map to find work near them, and (2) after a job is awarded, the provider gets directions to the customer's service address.

**Requirements:**

- **FR-10.1** Map integration: Google Maps API or Mapbox (evaluate cost and feature set).
- **FR-10.2** Provider job discovery map: interactive map showing active jobs as pins. Providers can filter by service category, price range, and distance. Clicking a pin shows job summary with a link to the full job posting.
- **FR-10.3** Job location display: during the bidding phase, jobs show approximate location only. Implementation: snap to zip code centroid (5-digit zip). This provides enough precision for providers to estimate travel time without revealing the customer's exact address. Exact address is revealed only to the awarded provider after the job is awarded. Non-awarded providers never see the exact address.
- **FR-10.4** Post-award directions: after a job is awarded, the provider sees the exact service address with a "Get Directions" button that opens Google Maps / Apple Maps / Waze with the address pre-filled.
- **FR-10.5** Service radius: providers define their service radius during onboarding. Jobs outside their radius are not shown by default (can be toggled to show all).
- **FR-10.6** Multi-property support: customers with multiple properties can select which property a job is for. Each property has its own address.
- **FR-10.7** Distance calculation: show estimated travel distance/time from provider's location to job site.

### 8.11 Market Analytics & Pricing Intelligence

**Overview:** AI-powered pricing intelligence that shows customers the fair market range for services and shows providers competitive pricing data. Hidden behind a Shift+~ toggle for MVP until sufficient data is collected.

**Requirements:**

- **FR-11.1** Market range calculation: for each service type in each geographic market (zip code or city level), calculate and display:
  - Low price (25th percentile of completed transactions)
  - Median price (50th percentile)
  - High price (75th percentile)
  - Number of data points
- **FR-11.2** Market range bar (always visible, not behind toggle): a simple range bar shown inline during job posting (for customers) and bid submission (for providers). This is a core feature of the marketplace, not part of the hidden analytics dashboard. Displays: "Based on [N] completed jobs in your area, [Service Type] typically costs between $X and $Y." When insufficient platform data exists, uses seeded data with a disclaimer: "Based on industry data." When no data exists for the service type/area, the range bar is hidden entirely.
- **FR-11.3** Market range display for providers: shown inline during bid submission (always visible, not behind toggle). "Other providers in your area typically price [Service Type] between $X and $Y."
- **FR-11.4** Pricing factors: the system adjusts market range based on:
  - Service type and scope
  - Geographic market (Seattle neighborhoods have different cost structures)
  - Seasonal trends (HVAC demand peaks in summer/winter)
  - Recurrence (recurring jobs may command lower per-occurrence rates)
- **FR-11.5** Data sources for MVP: seed with publicly available pricing data (HomeAdvisor cost guides, BLS labor statistics, manufacturer MSRP for common parts). Transition to platform transaction data as volume grows.
- **FR-11.6** Hidden advanced analytics dashboard (separate from the market range bar above): a full analytics overlay hidden from end users by default. Activated by holding Shift+~ on any page. This is an internal/demo feature, not discoverable by users. The market range bar (FR-11.2, FR-11.3) is always visible and is NOT behind this toggle.
- **FR-11.7** When toggled on, the analytics overlay shows:
  - Market range for the current service category
  - Price trend over time (chart)
  - Bid distribution for the current job (if viewing a job)
  - Provider win rate and average bid vs. market median
- **FR-11.8** Admin can toggle analytics visibility globally (make it visible to all users) when sufficient data confidence is reached.
- **FR-11.9** Data pipeline: all completed transactions feed into the analytics engine. Price, service type, location, and completion date are the minimum required fields.

### 8.12 Subscription & Monetization

**Overview:** Two monetization models built into the platform. Decision on primary model to be made pre-launch based on market testing. Both must be functional.

**Requirements:**

**Subscription Model:**
- **FR-12.1** Subscription tiers (configurable via admin):
  - **Free tier:** Browse the marketplace. Limited job posts (e.g., 1 active job at a time for customers, 5 bids per month for providers). No access to advanced analytics.
  - **Pro tier (Customer):** Unlimited job posts, priority support, advanced analytics access (when enabled), enhanced filters.
  - **Pro tier (Provider):** Unlimited bids, priority placement in search results, advanced analytics access, enhanced profile features (portfolio, verified badge prominence).
- **FR-12.2** Subscription billing: monthly recurring via the payment processor. Cancel anytime.
- **FR-12.3** Subscription management: user can upgrade, downgrade, or cancel from account settings.
- **FR-12.4** Free trial: configurable trial period for Pro tier (e.g., 14 or 30 days).

**Transaction Fee Model:**
- **FR-12.5** Platform fee: configurable percentage of each transaction (e.g., 5–10%). Applied to the provider's payout.
- **FR-12.6** Fee visibility: the platform fee is shown in the payment breakdown to both parties. No hidden fees.
- **FR-12.7** Fee structure is configurable per service category (some categories may have different fee rates).

**Shared:**
- **FR-12.8** Admin panel: configure subscription tier pricing, free tier limits, transaction fee percentages, and trial duration.
- **FR-12.9** Revenue reporting dashboard (admin): total subscription revenue, total transaction fee revenue, breakdown by tier and category.

### 8.13 Admin & Internal Tooling

**Overview:** Internal tools for NoMarkup team to manage the platform, moderate content, resolve disputes, and monitor system health.

**Requirements:**

- **FR-13.1** Admin dashboard (web-based, separate from consumer app):
  - User management: search, view, edit, suspend, ban users. View verification status and documents.
  - Job management: view all jobs, filter by status/category/location. Force-close or remove jobs.
  - Fraud review queue: list of flagged signals sorted by confidence. Drill into user activity. Approve/dismiss/act.
  - Dispute resolution queue: open disputes with links to chat transcripts, payment history, and contract terms.
  - Verification queue: pending document reviews. Approve/reject with reason.
  - Service taxonomy management: add/edit/remove categories, subcategories, and service types.
- **FR-13.2** Verification toggle: global switch to require or skip document verification for bidding (MVP demo mode).
- **FR-13.3** Analytics toggle: global switch to show or hide market analytics for end users.
- **FR-13.4** Subscription/fee configuration: set tier pricing, free tier limits, transaction fee percentages.
- **FR-13.5** System health dashboard: API response times, error rates, active users, jobs posted/completed per day, payment volume.
- **FR-13.6** Audit log: all admin actions are logged with timestamp, admin user, and action taken.
- **FR-13.7** Role-based access control (RBAC) for admin panel: Admin (full access), Support (dispute resolution + user management), Analyst (read-only dashboards).

### 8.14 Contract Management

**Overview:** After a customer awards a bid, a formal contract is created that governs the work, payment terms, schedule, and completion criteria. The contract is the binding agreement between customer and provider on the platform.

**Requirements:**

- **FR-14.1** Contract auto-generation: when a customer awards a bid, the system generates a contract entity containing:
  - Job details (title, description, service category, service address, photos)
  - Awarded bid amount
  - Provider identity (linked to verified provider profile)
  - Customer identity (linked to verified customer profile)
  - Payment terms: defaults to the provider's global terms. If local terms were accepted in chat (FR-8.9), those override global terms.
  - Schedule: derived from the job posting's schedule preference
  - Milestones (if applicable): as agreed in chat or from provider's default milestone structure
  - Contract status: Pending Acceptance → Active → Completed / Cancelled / Disputed
- **FR-14.2** Contract review and acceptance: after auto-generation, both parties must accept the contract before work begins.
  - Provider sees: "You've been awarded this job. Review and accept the contract to begin."
  - Customer sees: "Contract generated. Review the terms and confirm."
  - Either party can request changes via chat before accepting. Changes generate a revised contract.
  - Acceptance timeout: if either party does not accept within 72 hours, the contract is voided. The customer is notified and can award to another bidder or repost.
- **FR-14.3** Contract modification: after acceptance but before the first payment event, either party can propose a modification via chat. Modifications require both parties to re-accept. After the first payment, modifications require a formal change order (new milestone or amended terms) accepted by both parties.
- **FR-14.4** Contract display: a dedicated contract detail page accessible to both parties showing all terms, milestones (with status), payment history, schedule, and links to the chat thread.
- **FR-14.5** Contract PDF export: either party can download the contract as a PDF for their records.
- **FR-14.6** Contract numbering: each contract gets a unique, human-readable contract number (e.g., NM-2026-00001) for reference in support and disputes.

### 8.15 Job Completion & Handoff

**Overview:** Defines how work is confirmed as complete, how final payment is released, and how disputes during handoff are handled.

**Requirements:**

- **FR-15.1** Completion flow for "upon completion" and milestone-based final payment:
  1. Provider marks the job (or final milestone) as complete via the contract detail page.
  2. Customer receives a notification: "Your provider has marked [Job Title] as complete. Please review and confirm."
  3. Customer has three options: **Approve** (payment released), **Request Revision** (provider is notified of specific issues via chat), or **Dispute** (enters dispute flow, payment frozen).
  4. Approval timeout: if the customer does not respond within 7 days, the system sends a reminder at day 3 and day 6. If no response by day 7, payment auto-releases to the provider. Customer retains the right to open a dispute for 14 additional days after auto-release.
- **FR-15.2** Completion flow for "full upfront" payment: work is not gated by payment release (funds already in escrow). Provider marks complete. Customer confirms. Job moves to Completed. Escrow releases to provider. If customer disputes quality, they can open a dispute for a partial or full refund within 14 days of completion.
- **FR-15.3** Completion flow for recurring jobs: each occurrence has its own completion confirmation. Provider marks each occurrence complete. Customer approves (or auto-approves if they have enabled auto-approval for recurring jobs in their settings).
- **FR-15.4** Revision requests: a customer can request up to 3 revisions before the only options are Approve or Dispute. This prevents indefinite revision loops. Each revision request must include a written description of the issue (200 char min).
- **FR-15.5** Completion confirmation affects metrics: on-time completion rate is calculated from the scheduled date vs. the date the customer approves completion (or auto-release date).
- **FR-15.6** Post-completion: job status moves to Completed. Both parties are prompted to leave reviews (FR-6.1). Contract detail page shows final status with complete payment history.

### 8.16 Cancellation, Abandonment & Unhappy Paths

**Overview:** Defines all non-happy-path job states, their triggers, financial consequences, and impact on trust scores. These flows are critical for platform trust and must be built for MVP.

**Requirements:**

**Pre-Award Cancellation (Customer cancels active auction):**
- **FR-16.1** A customer can cancel an active auction at any time before award. All bidders receive a "Job Cancelled" notification. No financial penalty. The job moves to Cancelled status. Frequent cancellations (>3 in 30 days) generate a low-severity fraud signal.

**Post-Award Cancellation (Before work starts):**
- **FR-16.2** Customer-initiated cancellation after award but before first payment or work start:
  - Provider is notified immediately.
  - If no payment has been processed, no financial penalty. Contract voided.
  - If upfront payment was processed (in escrow), full refund to customer. Provider receives no payment.
  - Trust score impact: customer's cancellation rate is tracked. >2 post-award cancellations in 90 days triggers a medium-severity fraud signal.
- **FR-16.3** Provider-initiated cancellation after award but before work starts:
  - Customer is notified immediately. Customer can award to the next-best bidder (if auction was recent) or repost.
  - No financial penalty to customer.
  - Trust score impact: provider loses 5 trust score points per cancellation. >2 post-award cancellations in 90 days triggers a medium-severity fraud signal and a warning. >5 triggers automatic review by admin.

**Provider No-Show:**
- **FR-16.4** If a provider has been awarded a job with a scheduled date and does not mark any activity (no chat messages, no milestone updates, no completion mark) within 24 hours after the scheduled start date:
  - System sends an automated check-in to both parties: "Is this job on track?"
  - If the provider does not respond within 48 hours of the check-in, the customer can:
    - Trigger a "Provider No-Show" action, which cancels the contract, refunds any escrowed funds, and applies a -15 trust score penalty to the provider.
    - Or extend the deadline (if the provider communicated a delay via chat).
  - No-shows are a high-severity fraud signal. 2+ no-shows trigger automatic admin review and potential suspension.

**Provider Abandonment (Mid-job):**
- **FR-16.5** If a provider stops responding during an active job (In Progress status):
  - Customer can send a "Request Status Update" notification. If no provider response within 72 hours:
    - Customer can trigger "Provider Abandoned" action.
    - Any approved/released milestone payments are non-refundable (work was verified).
    - Pending milestones and unreleased payments are refunded to customer.
    - Contract moves to Abandoned status.
    - Provider receives -20 trust score penalty and a high-severity fraud signal.
    - Customer can repost the remaining scope as a new job.

**Mid-Job Dispute:**
- **FR-16.6** Either party can open a dispute at any time during an In Progress contract:
  - Dispute freezes all pending payments. Already-released payments are not frozen.
  - Work may continue at the provider's discretion, but no further payments release until the dispute is resolved.
  - Dispute resolution (see FR-9.7) outcomes: release frozen funds, partial refund, full refund, or contract termination with pro-rated payment.
  - Dispute SLA: NoMarkup Support targets initial response within 24 hours and resolution within 7 business days. Complex disputes may take longer — both parties are updated on status.

**Payment Failure:**
- **FR-16.7** If a customer's payment method fails (declined card, insufficient funds):
  - For milestone/completion payments: the customer is notified and has 48 hours to update their payment method. Provider is notified of the delay (without exposing the reason). If not resolved in 48 hours, the provider can pause work or cancel.
  - For recurring payments: 3 automatic retry attempts over 7 days (day 0, day 3, day 7). If all fail, the recurring contract is paused and both parties are notified. Recurrence resumes upon successful payment update.
  - For upfront payments: job cannot move to In Progress until payment succeeds. No retries — customer must manually retry.

**Chargeback Handling:**
- **FR-16.8** If a customer files a chargeback with their bank on a completed/released payment:
  - NoMarkup is notified via the payment processor's chargeback webhook.
  - The chargeback amount is temporarily deducted from the provider's pending payouts (Stripe Connect standard behavior).
  - NoMarkup Support reviews the transaction: chat transcripts, completion confirmation, milestones approved, and any prior disputes.
  - If the chargeback is deemed unjustified, NoMarkup submits evidence to the payment processor to contest it.
  - Customer's account is flagged. 2+ chargebacks in 12 months triggers account suspension pending review.
  - Provider is protected from chargeback losses on transactions where completion was confirmed by the customer and no dispute was opened.

### 8.17 Notifications

**Overview:** Centralized notification system that delivers timely, relevant alerts across multiple channels. Notifications are critical to marketplace velocity — bid notifications, chat messages, and payment events must reach users quickly.

**Requirements:**

- **FR-17.1** Notification channels:
  - **In-app:** Real-time notification bell in the navigation bar with unread count badge. Notification center dropdown showing recent notifications grouped by type.
  - **Email:** Transactional emails for critical events (bid awarded, payment received, dispute opened, document status change). Digest emails for non-urgent events (new bids on your job, weekly summary).
  - **Web push:** Browser push notifications for time-sensitive events (new chat messages, bid activity, payment events). Requires user opt-in via browser prompt.
- **FR-17.2** Notification types and default channels:

  | Event | In-App | Email | Web Push |
  |---|---|---|---|
  | New bid on your job | Yes | Digest | Yes |
  | Bid awarded to you | Yes | Immediate | Yes |
  | Bid not selected | Yes | Immediate | No |
  | New chat message | Yes | No (unless offline > 1hr) | Yes |
  | Chat request (pre-bid inquiry) | Yes | Immediate | Yes |
  | Payment received | Yes | Immediate | No |
  | Payment failed | Yes | Immediate | Yes |
  | Milestone submitted for approval | Yes | Immediate | Yes |
  | Job marked complete | Yes | Immediate | Yes |
  | Dispute opened | Yes | Immediate | Yes |
  | Review received | Yes | Immediate | No |
  | Document status change | Yes | Immediate | No |
  | Subscription expiring | Yes | Immediate (7 days, 3 days, 1 day) | No |
  | Auction closing soon (< 2hr) | Yes | Immediate | Yes |
  | Provider no-show check-in | Yes | Immediate | Yes |
  | Fraud flag on your account | Yes | Immediate | No |
  | Contract pending acceptance | Yes | Immediate | Yes |

- **FR-17.3** Notification preferences: users can customize which notifications they receive on which channels from account settings. Critical notifications (disputes, payment failures, account flags) cannot be disabled.
- **FR-17.4** Notification batching: non-urgent email notifications are batched into a single digest (configurable: daily or weekly). In-app and push are always real-time.
- **FR-17.5** Notification read state: clicking a notification marks it as read and navigates to the relevant page (job, chat, contract, payment).
- **FR-17.6** Email notifications include a one-click "View in NoMarkup" button linking directly to the relevant page. Unsubscribe link in every email (required by CAN-SPAM).

### 8.18 Recurring Job Management

**Overview:** Full lifecycle management for recurring jobs, beyond the initial posting and bidding defined in Section 8.3.

**Requirements:**

- **FR-18.1** Recurrence configuration: customer sets frequency at job posting time (weekly, biweekly, monthly). After award, recurrence generates individual job instances automatically on the defined schedule.
- **FR-18.2** Instance management: each recurring instance appears in both parties' dashboards as an upcoming, in-progress, or completed occurrence. The contract detail page shows a timeline view of all instances.
- **FR-18.3** Auto-approval option: for recurring jobs, the customer can enable "auto-approve completion" in the contract settings. When enabled, each occurrence is automatically marked complete and payment releases without manual approval. Customer can disable this at any time.
- **FR-18.4** Rate adjustment: either party can propose a rate change for future occurrences. The other party accepts or rejects via chat. Rate changes apply only to future instances — completed instances retain their original rate. If the parties cannot agree, either can cancel the recurrence.
- **FR-18.5** Recurrence cancellation: either party can cancel the recurrence with 1 occurrence notice (e.g., if the job recurs weekly, cancellation takes effect after the next scheduled instance). No penalty for cancellation of a recurring contract in good standing. The completed instances remain as individual completed jobs for review and analytics purposes.
- **FR-18.6** Pause/resume: either party can pause the recurrence (e.g., customer is on vacation, provider is unavailable). Paused recurrences do not generate new instances until resumed. Max pause duration: 90 days before the recurrence auto-cancels.
- **FR-18.7** Provider substitution: if a provider needs to permanently end a recurring contract, the customer is notified and can repost the recurring job as a new auction for the remaining schedule. Completed instances with the original provider are preserved.
- **FR-18.8** Recurring payment failure: if a recurring payment fails, the recurrence is paused (not cancelled). The system follows the retry logic in FR-16.7. Recurrence resumes automatically upon successful payment.

### 8.19 Multi-Property Dashboard

**Overview:** Dedicated management view for customers who own or manage multiple properties. Addresses the Property Manager and Multi-Property Owner personas from Section 3.

**Requirements:**

- **FR-19.1** Property management: customers can add, edit, and remove properties from their account. Each property has: address, nickname (e.g., "Lake House," "Rental Unit 3B"), photos (optional), and notes (e.g., "gate code: 1234").
- **FR-19.2** Property dashboard: a single view showing all properties with summary cards for each:
  - Active jobs per property
  - Upcoming scheduled work
  - Total spend (month/year)
  - Preferred providers (providers who have completed 3+ jobs at this property)
- **FR-19.3** Per-property job history: drill into any property to see all completed, active, and upcoming jobs. Filter by service category and date range.
- **FR-19.4** Cross-property job posting: when posting a job, multi-property customers select which property it's for. The job inherits that property's address and any notes.
- **FR-19.5** Cross-property analytics (behind Shift+~ toggle): total spend across all properties by service category, provider performance across properties, cost comparisons between properties.
- **FR-19.6** Bulk job posting (future consideration, architecture ready): ability to post the same job across multiple properties simultaneously (e.g., "lawn mowing for all 5 rental units"). For MVP, jobs are posted individually per property.

## 9. Data Flywheel & AI Competitive Moat

### Overview

NoMarkup's most defensible asset is not the marketplace itself — it is the **compounding intelligence** generated by every transaction on the platform. Each completed job makes pricing more accurate, fraud detection more precise, and matching more effective. After 12 months of transaction data, no competitor can replicate the intelligence layer. After 24 months, the gap becomes insurmountable.

This is not a feature. It is the core business strategy.

### The NoMarkup Flywheel

```
More Providers → Lower Prices (competition) → More Customers
     ↑                                              ↓
More Revenue ← More Transactions ← More Jobs Posted
     ↓                                              ↓
Better Data → Smarter Pricing → Higher Trust → More Repeat Usage
     ↓
Better Fraud Detection → Safer Platform → Stronger Reputation
     ↓
Financial Services Unlock → Higher Revenue Per Transaction
```

Each rotation of the flywheel accelerates the next:

1. **Pricing intelligence compounds.** Every completed transaction adds a real data point to the market range model. After 1,000 transactions in a service category, NoMarkup's pricing data is more accurate than any published cost guide. After 10,000, it is the definitive source.
2. **Fraud detection improves with volume.** Rule-based detection (MVP) evolves into statistical anomaly detection as patterns emerge. Review manipulation, bid gaming, and account fraud become progressively harder as the training set grows.
3. **Provider matching improves.** As the platform accumulates data on which providers win bids, complete on time, and earn high reviews for specific job types, the system can proactively recommend providers to customers — reducing time-to-award and increasing satisfaction.
4. **Trust compounds and transfers.** A provider with 50 verified, transaction-linked reviews on NoMarkup has a reputation asset that doesn't exist anywhere else. That provider will not leave the platform. Their customers won't either.

### Data Assets (Collected From Day One)

| Data Asset | Source | Competitive Value |
|---|---|---|
| Transaction-verified pricing by service type, geography, and season | Every completed job | No competitor has real transaction prices. HomeAdvisor publishes estimates. NoMarkup has actuals. |
| Provider performance metrics (on-time rate, completion rate, review scores) | Reviews, milestone tracking, job lifecycle | Enables quality-based matching, not just price-based. |
| Fraud signal corpus | IP/device fingerprints, behavioral patterns, review text, payment patterns | ML models trained on real fraud attempts. Each caught fraud makes the system smarter. |
| Customer behavior patterns | Job posting patterns, bid selection criteria, repeat hire rates | Enables demand forecasting, seasonal pricing adjustments, and proactive provider recommendations. |
| Market liquidity data | Bid counts per job, time-to-first-bid, time-to-award | Identifies supply gaps by category and geography. Directs provider recruitment and marketing spend. |

### Moat Depth Over Time

| Timeframe | Moat Strength | Why |
|---|---|---|
| Month 1–6 | Weak | Insufficient data. Competitors could replicate features. |
| Month 6–12 | Moderate | Pricing intelligence becomes credible. Fraud detection catches first real patterns. |
| Month 12–24 | Strong | Thousands of verified transactions. Pricing data is more accurate than any competitor. Provider reputation graphs are deep. |
| Month 24+ | Insurmountable | Multi-year transaction history, mature ML models, verified provider reputations that took years to build. A new entrant would need to acquire this data — they can't generate it. |

### Engineering Implications

- All data collection infrastructure must be built for MVP — even if the ML models consuming it are basic at launch.
- Data schema must be designed for analytics from day one (not retrofitted later).
- Every user action is an event. Event sourcing architecture is recommended for the analytics pipeline.
- All pricing, review, and fraud data must be retained indefinitely (not subject to data retention purging). Anonymized after account deletion per CCPA, but retained for aggregate analytics.

---

## 10. NoMarkup Guarantee & Platform Trust

### Overview

The NoMarkup Guarantee is the platform's answer to the most fundamental marketplace question: **"Why should I transact through you instead of going direct?"** Without a guarantee, once a customer finds a provider they like, they will take the relationship off-platform to avoid fees. The guarantee makes the platform indispensable.

### The Guarantee

**"If the work isn't completed as agreed, NoMarkup will make it right — up to the full contract value."**

This means:
- If a provider fails to complete the work as defined in the contract, NoMarkup will either pay another provider to finish/fix the job or issue a full refund to the customer.
- The guarantee covers: incomplete work, work that doesn't meet the agreed scope, provider abandonment, and provider no-show.
- The guarantee does NOT cover: customer-initiated scope changes after work begins, normal wear and tear, or cosmetic preferences not in the original scope.

### How It Works

1. Customer opens a Guarantee claim via the dispute flow (FR-16.6).
2. NoMarkup Support reviews: contract terms, chat transcripts, milestone history, photos (before/after if available), and both parties' accounts of the situation.
3. If the claim is valid:
   - **Option A:** NoMarkup assigns a replacement provider from the platform's verified provider pool to complete or remediate the work. NoMarkup covers the cost from the Guarantee fund.
   - **Option B:** If no suitable replacement is available, NoMarkup issues a full or partial refund to the customer from the Guarantee fund.
4. The original provider's trust score is penalized. Repeat Guarantee claims against a provider trigger suspension.

### Funding the Guarantee

- A **Guarantee fee** of 2–3% is included in the platform fee on every transaction (not an additional charge — absorbed into the existing take rate).
- The Guarantee fund is a reserve pool. At 2% of GMV with $85M Year 1 GMV, the fund generates **$1.7M/year** to cover claims.
- Historical data from similar marketplaces suggests a claim rate of 1–3% of transactions. At average job values of $500–$2,000, the fund is more than sufficient.
- As claim rates decrease over time (better providers, better matching, better fraud detection), the Guarantee fund becomes increasingly profitable.

### Strategic Value

| Value | Impact |
|---|---|
| **Customer acquisition** | "Guaranteed by NoMarkup" is a marketing differentiator no competitor offers. |
| **Platform lock-in** | Customers transact on-platform because the guarantee only applies to on-platform jobs. |
| **Provider quality pressure** | Providers know that bad work triggers a claim, a trust score hit, and potential suspension. This self-selects for quality. |
| **Insurance revenue** | For high-value jobs ($10K+), offer optional enhanced guarantees at a premium (extended coverage, faster resolution, dedicated support). This is an insurance product. |

### MVP Implementation

- The Guarantee is **announced and marketed from day one** even during beta.
- During beta (low volume), Guarantee claims are funded from operating capital, not a formal reserve.
- The Guarantee fund becomes a formal reserve when GMV exceeds $1M/month.
- Guarantee terms, claim process, and coverage limits are documented in the ToS and on a dedicated Guarantee landing page.

---

## 11. Growth Engine & Viral Loops

### Overview

Marketplace growth must compound organically. Paid acquisition is necessary to spark initial growth, but a sustainable marketplace needs **viral loops** where each user acquired generates additional users at zero marginal cost. The target: **40–60% of new users from organic channels** by Month 12.

### Viral Loop 1: Referral Program (Both Sides)

- **Customer referral:** Customer invites a friend or neighbor → referred customer gets $25 credit toward their first job → referring customer gets $25 credit when the referred customer completes their first job.
- **Provider referral:** Provider refers another provider → referrer gets $50 credit when the referred provider completes their first job on the platform.
- **Cross-referral:** Providers can refer customers (and vice versa). The referrer gets credit regardless of which role the referred user activates.
- **Tracking:** Unique referral links and codes. Dashboard showing referral status, pending credits, and earned credits.
- **Fraud prevention:** Referral credits are only released after a verified, completed transaction. Self-referrals detected and blocked via device fingerprinting and address matching.

### Viral Loop 2: Social Proof Sharing

After a job is completed and reviewed:
- **Savings share card:** If the customer's accepted bid was below the market median, the system generates a shareable card: *"I saved $1,200 on HVAC repair through NoMarkup. My provider was rated 4.9 stars."* Customer can share to Facebook, Nextdoor, X, or via text/email.
- **Review share card:** Customers are prompted to share their review as a visual card with the provider's name, rating, and service type.
- **Provider portfolio share:** Providers can share completed job photos and review cards to their own social media with a "Find me on NoMarkup" link.
- **All share cards include a referral link** tied to the sharing user's account.

### Viral Loop 3: Neighborhood Density Effect

- When multiple jobs are completed on the same street or in the same neighborhood, the platform identifies a density cluster.
- **Neighborhood mailer:** (Post-MVP) Physical postcards to addresses near completed jobs: *"Your neighbor just saved $X on [Service] through NoMarkup. See what your home services should cost."* Includes a neighborhood-specific landing page URL.
- **Provider vehicle program:** Offer providers free NoMarkup-branded vehicle magnets/decals. When a provider's truck is parked in a driveway, it's marketing to the entire street. Providers who display branding get a small monthly credit.
- **Nextdoor integration:** Auto-suggest that customers post their positive experience on Nextdoor (with a pre-written template they can customize).

### Viral Loop 4: SEO Content Moat

- Auto-generate landing pages for every service type in every city: *"What does HVAC replacement cost in Seattle?"*
- Powered by **real transaction data**, not estimates. This is a critical differentiator — every existing cost guide (HomeAdvisor, Fixr, Angi) uses estimated data. NoMarkup publishes actuals.
- Pages update automatically as new transactions complete.
- Each page includes a CTA: *"Get competitive bids on your [Service] in [City] — free."*
- **SEO volume target:** 1,000+ indexed pages within 6 months of launch per metro area (16 categories × ~60 service types × multiple neighborhoods).
- These pages become the top Google results for "[service] cost in [city]" queries and funnel high-intent customers directly into the marketplace.

### Viral Loop 5: Powered by NoMarkup

- Every receipt, invoice, and contract PDF generated by the platform includes a *"Powered by NoMarkup — Fair Prices, Verified Providers"* footer with a link to the marketplace.
- Every email notification to customers includes a referral CTA in the footer.
- Providers who receive 5-star reviews are sent a "Top Rated" digital badge they can embed on their website, Google Business Profile, or social media — linking back to their NoMarkup profile.

### Growth Metrics

| Metric | Target (Month 12) |
|---|---|
| Organic/referral as % of new signups | 40–60% |
| Referral conversion rate | 15–25% (referred user completes first transaction) |
| Savings share rate | 20% of customers share after a job where they saved money |
| SEO-driven signups per month | 500+ (scaling with content volume) |
| Provider-to-customer referral rate | 10% of providers refer at least one customer |

---

## 12. Financial Services Layer

### Overview

NoMarkup's position at the center of every home services transaction creates a **financial services opportunity** that can double or triple revenue per transaction. Marketplace fee alone is a 5-8% take rate. Adding financial products pushes the **effective take rate to 12-20%** — transforming NoMarkup from a marketplace into a fintech-enabled platform.

This is the playbook that made Stripe ($95B), Square ($40B), Toast ($15B), and Shopify ($100B) into category-defining companies. NoMarkup has the same structural advantage: it sits between the buyer and seller on every transaction.

### Product 1: Provider Working Capital (Phase 2)

**Problem:** Independent providers need to purchase materials before they get paid. Banks won't lend to sole proprietors and small contractors. Providers either front the cost personally (cash flow strain) or mark up materials to cover the risk (customer pays more).

**Solution:** NoMarkup advances funds to providers against awarded contracts.

- **Eligibility:** Provider must have a Trust Score of 70+ and at least 5 completed jobs on the platform.
- **Advance amount:** Up to 50% of the awarded contract value, capped at $10,000 per advance.
- **Repayment:** Automatically deducted from the provider's payout when the job completes (or from milestone payments).
- **Fee:** 2–5% flat fee on the advance amount (not interest — this is a merchant cash advance, not a loan, reducing regulatory burden).
- **Risk underwriting:** NoMarkup has the transaction data, review history, completion rate, and chargeback history to underwrite this risk far better than any bank. Default risk is low because repayment is automatically deducted from the payout.

**Revenue potential:** If 20% of providers take advances on 30% of their jobs, at a 3% fee: $85M GMV × 20% × 30% × 3% = **$153K Year 1.** At national scale ($5B GMV): **$9M/year** from advances alone.

### Product 2: Customer Financing / BNPL (Phase 2)

**Problem:** Large home service jobs ($5K–$50K for HVAC, roofing, remodeling) are difficult for customers to pay in full. Many customers delay needed work because they can't afford the lump sum.

**Solution:** Offer installment financing at point of payment.

- **Implementation:** Partner with Affirm, Klarna, or build on Stripe's installment product.
- **Terms:** 3, 6, or 12 month installment plans. 0% APR for short terms (subsidized by NoMarkup as a growth driver) or market-rate APR for longer terms.
- **Customer experience:** During checkout, customer sees: "Pay $5,000 today or $435/month for 12 months."
- **Provider impact:** Provider gets paid in full immediately. NoMarkup fronts the full amount and collects installments from the customer (or the financing partner does).

**Revenue potential:** If 15% of jobs over $2,000 use financing, at a 3-5% financing fee: significant revenue and a **massive driver of marketplace GMV** (customers complete larger jobs they would have otherwise deferred).

### Product 3: NoMarkup Insurance (Phase 3)

**Problem:** High-value home service jobs carry risk. What if the contractor damages property? What if the work fails after 6 months?

**Solution:** Per-job insurance products offered at point of contract.

- **Basic coverage (included in Guarantee):** Work completion guarantee as described in Section 10.
- **Enhanced coverage (paid add-on):** Property damage protection, extended workmanship warranty (1 year), expedited claim resolution, dedicated support agent.
- **Pricing:** 1–3% of contract value for enhanced coverage.
- **Implementation:** Partner with an insurance underwriter (e.g., Hiscox, Next Insurance) or a managing general agent (MGA) to issue policies. NoMarkup is the distribution channel and takes a commission.
- **Long-term play:** As claims data accumulates, NoMarkup can become its own MGA — underwriting policies directly using platform data for risk assessment.

### Product 4: Provider Business Services (Phase 3)

**Problem:** Independent contractors and small businesses struggle with bookkeeping, taxes, and business administration.

**Solution:** Offer business services bundled with the Pro subscription.

- **1099-K management and tax estimates:** Auto-generate quarterly estimated tax payments based on platform earnings.
- **Expense tracking:** Providers tag material purchases against jobs. Integrated with the payment system.
- **Invoice generation:** Professional invoices generated from contract and payment data.
- **Business analytics:** Revenue trends, profitability per job type, customer retention metrics.
- **Implementation:** Partner with QuickBooks, Wave, or FreshBooks for accounting integration. Tax estimation via Stripe's built-in 1099 tools or a partner like Wingspan.

### Financial Services Revenue Model

| Product | Revenue Mechanism | Est. Revenue at $5B GMV |
|---|---|---|
| Provider working capital | 2-5% fee on advances | $6M–$15M/year |
| Customer BNPL | 3-5% financing fee (or partner rev share) | $15M–$25M/year |
| Per-job insurance | 1-3% premium (commission from underwriter) | $10M–$30M/year |
| Provider business services | Monthly SaaS fee ($20-50/month) | $5M–$12M/year |
| **Total financial services revenue** | | **$36M–$82M/year** |

This is **on top of** the $250M–$400M marketplace fee revenue, pushing total revenue potential to **$286M–$482M at national scale**.

---

## 13. NoMarkup Instant — Emergency On-Demand Tier

### Overview

The MVP reverse auction model is optimized for planned work. But the highest-urgency, highest-margin use case in home services is **emergency repair**: a burst pipe at 2AM, a furnace failure in January, a gas leak. These customers can't wait 3 days for an auction.

NoMarkup Instant is an on-demand matching tier — think Uber for home repair. Customers describe the emergency, the platform matches them with an available verified provider, and the provider is on-site within hours.

### How It Works

1. Customer taps "Emergency / I Need Help Now" on the homepage.
2. Customer selects service category and describes the emergency (free text + optional photo).
3. The system identifies available providers in the customer's area who:
   - Are verified (minimum ID + insurance)
   - Have a Trust Score of 60+
   - Have opted in to receive Instant requests
   - Are within the service radius
4. Matching options:
   - **Broadcast match:** All qualifying providers receive a push notification with the job details. First provider to accept gets the job.
   - **AI match (future):** The platform recommends the best provider based on proximity, past performance on similar jobs, and availability.
5. Provider accepts the job. Customer is notified with the provider's name, photo, trust score, reviews, and ETA.
6. Provider arrives. Work is performed. Payment is processed immediately upon completion.

### Pricing

- **Premium pricing:** Instant jobs are priced at **1.5–2x the market median** for the service type. This premium compensates providers for dropping everything and responding immediately.
- **Transparent premium:** Customer sees: "Standard market range: $200–$400. Emergency rate: $400–$600. This premium compensates your provider for immediate availability."
- **Provider incentive:** Providers who opt in to Instant keep a higher percentage of the premium (reduced platform fee on Instant jobs).

### Provider Availability

- Providers opt in to Instant from their profile settings.
- Providers set their Instant availability schedule (e.g., "Available for emergencies Mon–Fri 6AM–10PM").
- Providers can toggle availability on/off in real time (e.g., currently on a job, not available).
- Providers who accept and then no-show on an Instant job receive a severe trust penalty (more than standard no-show, because the customer is in an emergency).

### Revenue Impact

Emergency home services is a **$77B annual market** in the US. These are the highest-value, most urgent transactions — customers are willing to pay a premium for speed and reliability. At a 2x price premium with a 10% take rate:

- Even capturing 0.1% of the emergency market = **$7.7M GMV** with strong margins.

### MVP vs. Phase 2

- **MVP:** The "Emergency / I Need Help Now" button and intake form are built. Jobs are posted as rapid auctions with a 2-hour window and a "first provider to accept at the market-premium price wins" mechanic. This validates demand without building full real-time matching.
- **Phase 2:** Full broadcast matching, real-time provider availability, ETA tracking, and AI-powered provider recommendation.

---

## 14. B2B & Enterprise Channel

### Overview

The consumer marketplace is the beachhead. The enterprise channel is the **revenue multiplier**. A single enterprise client (property management company, home warranty provider, insurance company) can generate more GMV than thousands of individual consumers. Enterprise contracts are also stickier — multi-year agreements with high switching costs.

### Target Enterprise Segments

**Property Management Companies**
- **Who:** Greystar, Lincoln Property, CBRE Residential, and thousands of regional firms managing millions of residential units.
- **Their need:** A reliable, cost-effective contractor network for maintenance and repair across their portfolio. Currently managed via scattered vendor lists, phone calls, and manual invoicing.
- **NoMarkup value:** Single platform for all service procurement. Verified providers. Market-rate pricing (not inflated contract rates). Consolidated billing and reporting. Multi-property dashboard (FR-19).
- **Contract model:** Enterprise subscription + negotiated transaction fee (lower than consumer rate, compensated by volume).

**Home Warranty Companies**
- **Who:** American Home Shield, First American, Choice Home Warranty. These companies sell home warranty plans and need contractor networks to fulfill claims.
- **Their need:** Access to verified, quality contractors at predictable pricing. Currently, warranty companies have contractor networks with high turnover and inconsistent quality.
- **NoMarkup value:** Verified provider pool with transparent pricing. Reverse auction for each claim drives cost down (warranty companies are extremely cost-sensitive). Quality enforcement via reviews and Trust Score.
- **Contract model:** Per-claim fee or monthly access fee + reduced transaction rate.

**Insurance Companies (Restoration)**
- **Who:** State Farm, Allstate, USAA, Liberty Mutual. When a homeowner files a claim (water damage, fire, storm), the insurance company needs contractors to perform restoration work.
- **Their need:** Fast dispatch of verified restoration contractors. Cost control. Quality documentation (before/after photos, scope compliance).
- **NoMarkup value:** Instant tier for emergency dispatch. Verified providers with insurance. Full documentation trail (photos, chat, contract, milestone tracking). Pricing transparency via market range data.
- **Contract model:** Enterprise API access + per-job fee.

**Real Estate Brokerages**
- **Who:** Redfin, Compass, Keller Williams, RE/MAX. Agents help buyers and sellers prepare homes for sale or address inspection findings.
- **Their need:** Trusted referrals for home repair and improvement. Currently relies on agent rolodex (inconsistent quality).
- **NoMarkup value:** Branded co-marketing: *"Recommended by [Brokerage] — powered by NoMarkup."* Agents can send clients directly to NoMarkup with pre-populated job details from the home inspection report.
- **Contract model:** Referral partnership. Revenue share on transactions originated through the brokerage.

**HOA Management Companies**
- **Who:** Associa, FirstService Residential, RealManage. Manage common areas, landscaping, and maintenance for homeowner associations.
- **Their need:** Cost-effective service procurement with board-level transparency and reporting.
- **NoMarkup value:** Reverse auction drives competitive pricing (HOAs are budget-conscious). Reporting dashboard for board presentations. Recurring job management for ongoing maintenance contracts.
- **Contract model:** Enterprise subscription.

### Enterprise API

To serve enterprise clients, NoMarkup must offer a **programmatic interface** for integration with enterprise systems:

- **Job posting API:** Enterprise systems can create jobs programmatically (e.g., a warranty claim triggers an automatic job posting on NoMarkup).
- **Provider network API:** Query available providers by category, location, and Trust Score.
- **Webhook notifications:** Real-time event notifications for job status changes, bid activity, payment events.
- **Reporting API:** Pull transaction history, spend analytics, and provider performance data into enterprise BI tools.
- **White-label option (Phase 3):** Enterprise clients can embed NoMarkup's marketplace in their own portal under their branding.

### Revenue Impact

| Enterprise Segment | Est. Addressable (Annual) | NoMarkup Capture (1%) | Revenue (8% take) |
|---|---|---|---|
| Property management | $45B | $450M GMV | $36M |
| Home warranty | $7B | $70M GMV | $5.6M |
| Insurance restoration | $15B | $150M GMV | $12M |
| Real estate referrals | $20B | $200M GMV | $16M |
| HOA management | $8B | $80M GMV | $6.4M |
| **Total** | **$95B** | **$950M GMV** | **$76M** |

Enterprise revenue is **incremental to consumer marketplace revenue** and has higher retention (multi-year contracts vs. per-transaction consumer relationships).

---

## 15. Platform Lock-In & Retention Strategy

### Overview

The most common failure mode for service marketplaces is **disintermediation** — users find each other through the platform, then transact off-platform to avoid fees. Every lock-in mechanism must make the platform more valuable than going direct.

### Lock-In Layer 1: NoMarkup Guarantee (Section 10)

- The Guarantee only applies to on-platform transactions.
- Off-platform, the customer has zero protection.
- **Message to users:** *"When you transact through NoMarkup, your work is guaranteed. Off-platform, you're on your own."*

### Lock-In Layer 2: Reputation Non-Portability

- Provider reviews, Trust Score, and verification status **exist only on NoMarkup.**
- A provider with 50 five-star reviews and a "Top Rated" badge cannot take that reputation to another platform or to direct client relationships.
- Leaving the platform means starting over from zero.
- **Implication:** The more a provider invests in their NoMarkup profile, the higher the switching cost.

### Lock-In Layer 3: Financial Services Integration

- If a provider's working capital line, tax prep, and bookkeeping run through NoMarkup, switching means losing their financial infrastructure.
- If a customer's financing plan is through NoMarkup, they must continue transacting on-platform to manage their installments.
- **Implication:** Financial services create multi-touch relationships that go beyond individual transactions.

### Lock-In Layer 4: Pricing Intelligence Exclusivity

- Market range data is only visible on-platform.
- Customers cannot see what a service should cost anywhere else — NoMarkup's pricing data is derived from real transactions, not estimates.
- Providers cannot see competitive pricing data anywhere else.
- **Implication:** Both sides of the marketplace have an informational advantage by staying on-platform.

### Lock-In Layer 5: Recurring Contracts & Automation

- Recurring jobs are auto-scheduled, auto-billed, and auto-tracked.
- Switching means manually coordinating schedules, chasing payments, and tracking service history.
- Multi-property owners with dozens of recurring contracts across multiple properties would face weeks of re-coordination to move off-platform.
- **Implication:** Operational convenience creates passive lock-in that grows with usage.

### Lock-In Layer 6: Network Density

- As provider and customer density increases in a neighborhood, the platform becomes the default way to find and hire services.
- Providers' existing customer base is on the platform. New customers arrive through the platform. Going direct means leaving money on the table.
- **Implication:** Local network effects create geographic lock-in.

### Retention Metrics

| Metric | Target (Month 12) | Target (Month 24) |
|---|---|---|
| Customer retention (month-over-month) | 70% | 80% |
| Provider retention (month-over-month) | 75% | 85% |
| Repeat transaction rate (customers) | 40% | 55% |
| Off-platform leakage rate | < 15% | < 8% |
| Recurring contract as % of total GMV | 25% | 40% |

---

## 16. Platform Expansion — Beyond Home Services

### Overview

Home services is the beachhead. The reverse-auction + verification + payment + guarantee model is **horizontal** — it works for any skilled service where customers need to find, vet, and pay a professional. The platform expansion path takes NoMarkup from a $657B TAM to a **$2T+ TAM**.

### Expansion Wedges (Ordered by Adjacency)

**Tier 1: Direct adjacencies (Year 2–3)**

| Vertical | TAM | Why It's Adjacent |
|---|---|---|
| Auto repair & maintenance | $300B | Same trust/pricing/verification challenges. Customers are overcharged for parts and labor. |
| Moving services | $18B | Logistics-heavy, price-opaque, trust-critical. Perfect for reverse auction. |
| Pet services | $12B | Growing, fragmented, trust-dependent (people trust you with their pets like their homes). |
| Home cleaning (commercial) | $90B | Extension of residential cleaning into offices, retail, warehouses. |

**Tier 2: Adjacent professional services (Year 3–5)**

| Vertical | TAM | Why It's Adjacent |
|---|---|---|
| Legal services (simple) | $50B | Wills, contracts, estate planning. Price-opaque, high markup, trust-critical. |
| Accounting & tax prep | $50B | Independent CPAs vs. H&R Block franchise model — same markup dynamic as home services. |
| Event services | $80B | Photography, catering, DJ, venues. Fragmented, price-opaque, reverse auction is natural. |
| Tutoring & education | $25B | Fragmented, difficult to vet quality, pricing varies wildly. |

**Tier 3: Large vertical platforms (Year 5+)**

| Vertical | TAM | Why It's Adjacent |
|---|---|---|
| Healthcare (elective) | $200B+ | Dental, vision, cosmetic. Massive price opacity. Patients shop for quality and price. |
| Commercial construction | $500B+ | The enterprise version of home services at massive scale. |

### Expansion Strategy

- **Same technology, new taxonomy.** The platform infrastructure (auctions, payments, reviews, fraud detection, chat, contracts) is category-agnostic. Expansion into a new vertical requires: new service taxonomy categories, category-specific verification requirements, and seeded pricing data.
- **Data moat transfers.** Fraud detection, user behavior models, and the matching algorithm apply across verticals. A provider who is verified in home services can extend into adjacent categories (e.g., a handyman who also does auto maintenance).
- **Customer base transfers.** Existing customers who trust NoMarkup for home services will try it for auto repair, moving, and other services — reducing customer acquisition cost for new verticals.

### Total Addressable Market — Expanded

| Scope | TAM |
|---|---|
| Home services (current) | $657B |
| Tier 1 adjacencies | $420B |
| Tier 2 adjacencies | $205B |
| Tier 3 verticals | $700B+ |
| **Total platform TAM** | **$2T+** |

---

## 17. Key Metrics & North Star KPIs

### Overview

These are the metrics NoMarkup will live and die by. They should be tracked from day one of beta, reviewed weekly by leadership, and reported quarterly to investors. The engineering team must build instrumentation for all of these into the analytics pipeline.

### North Star Metric

**Gross Merchandise Value (GMV):** Total value of all transactions processed through the platform. This is the single number that captures marketplace health — it grows when more customers post, more providers bid, and more jobs are completed.

### Primary KPIs

| Metric | Definition | Target (Month 6) | Target (Month 12) | Target (Month 24) |
|---|---|---|---|---|
| **GMV** | Total transaction value | $2M | $8.5M | $50M |
| **Take rate** | Platform revenue / GMV | 6% | 7% | 8-10% (with financial services) |
| **Revenue** | Total platform revenue | $120K | $595K | $5M |
| **Active customers** | Customers with at least 1 transaction in last 90 days | 200 | 1,000 | 5,000 |
| **Active providers** | Providers with at least 1 completed job in last 90 days | 75 | 300 | 1,500 |

### Marketplace Health Metrics

| Metric | Definition | Target |
|---|---|---|
| **Liquidity** | % of posted jobs receiving at least 1 bid within 24 hours | > 80% |
| **Time to first bid** | Median time from job posting to first bid received | < 4 hours |
| **Time to award** | Median time from job posting to provider selection | < 48 hours |
| **Bids per job** | Average number of bids per completed job | 3–7 |
| **Fill rate** | % of posted jobs that result in a completed transaction | > 60% |
| **Zero-bid rate** | % of posted jobs that receive zero bids | < 10% |

### Unit Economics

| Metric | Definition | Target |
|---|---|---|
| **Customer Acquisition Cost (CAC)** | Total marketing spend / new transacting customers | < $50 |
| **Customer Lifetime Value (LTV)** | Average revenue per customer over their platform lifetime | > $200 |
| **LTV:CAC ratio** | Must exceed 3:1 for a sustainable marketplace | > 4:1 |
| **Average job value** | Average transaction amount per completed job | $500–$2,000 |
| **Average provider monthly revenue** | Monthly GMV per active provider | $3,000+ |
| **Payback period** | Months to recoup CAC from a customer | < 6 months |

### Trust & Quality Metrics

| Metric | Definition | Target |
|---|---|---|
| **Average review rating** | Mean star rating across all reviews | > 4.3 |
| **On-time completion rate** | % of jobs completed on or before scheduled date | > 85% |
| **Dispute rate** | % of completed transactions with a dispute filed | < 3% |
| **Guarantee claim rate** | % of completed transactions triggering a Guarantee claim | < 1% |
| **Fraud detection rate** | % of fraudulent activity caught before customer impact | > 90% |
| **Chargeback rate** | % of transactions resulting in chargebacks | < 0.5% |

### Growth Metrics

| Metric | Definition | Target (Month 12) |
|---|---|---|
| **Organic/referral as % of signups** | New users from non-paid channels | > 40% |
| **Referral conversion rate** | Referred users who complete first transaction | > 15% |
| **Provider-side virality** | New providers acquired via provider referrals | > 20% |
| **Monthly active user growth** | Month-over-month growth in MAU | > 15% |
| **Geographic expansion readiness** | Liquidity score (bids per job) in new target markets | > 3 bids/job |

### Retention Metrics

| Metric | Definition | Target (Month 12) |
|---|---|---|
| **Customer M1 retention** | % of customers who transact again within 30 days | > 25% |
| **Customer M3 retention** | % of customers who transact again within 90 days | > 40% |
| **Provider monthly retention** | % of providers active month-over-month | > 75% |
| **Recurring contract retention** | % of recurring contracts active after 6 months | > 70% |
| **Net Promoter Score (NPS)** | Customer and provider NPS | > 50 |

### Financial Services Metrics (Phase 2+)

| Metric | Definition | Target |
|---|---|---|
| **Provider advance adoption** | % of eligible providers who take at least one advance | > 20% |
| **BNPL adoption** | % of jobs over $2,000 using customer financing | > 15% |
| **Advance default rate** | % of provider advances not repaid | < 2% |
| **Insurance attach rate** | % of jobs over $5,000 purchasing enhanced coverage | > 10% |

### Reporting Cadence

| Audience | Cadence | Metrics |
|---|---|---|
| Engineering team | Real-time dashboards | All metrics via live dashboards |
| Leadership | Weekly review | GMV, revenue, active users, liquidity, NPS |
| Investors | Quarterly report | All primary KPIs, unit economics, growth metrics |
| Board | Quarterly board deck | GMV trajectory, burn rate, path to profitability, competitive position |

## 18. Non-Functional Requirements

### Performance
- **NFR-1** Page load time: < 2 seconds on 4G connection (LCP).
- **NFR-2** Time to interactive: < 3 seconds on 4G connection.
- **NFR-3** API response time: < 200ms for reads, < 500ms for writes (p95).
- **NFR-4** Real-time chat: message delivery < 500ms end-to-end.
- **NFR-5** Search results (jobs, providers): < 1 second including map rendering.
- **NFR-6** Support 10,000 concurrent users at launch (Seattle market). Architecture must scale horizontally to 100,000+ for national expansion.

### Availability & Reliability
- **NFR-7** Uptime target: 99.9% (excluding scheduled maintenance).
- **NFR-8** Payment processing: zero data loss. All payment operations must be idempotent and recoverable.
- **NFR-9** Graceful degradation: if the analytics engine is down, the marketplace continues to function. If chat is down, users see a clear error and can retry.
- **NFR-10** Database backups: automated daily backups with point-in-time recovery. 30-day retention.

### Scalability
- **NFR-11** Stateless application layer: horizontal scaling via container orchestration.
- **NFR-12** Database: read replicas for query-heavy operations (job search, analytics). Write scaling via connection pooling and query optimization.
- **NFR-13** File storage: two distinct storage tiers.
  - **Public assets** (profile photos, job photos, portfolio images): object storage (S3 or equivalent) served via CDN. Public read access.
  - **Private documents** (identity documents, insurance, licenses): separate access-controlled bucket. No CDN. Never served publicly. Access requires authenticated API call with authorization check and audit logging (see SEC-8).
- **NFR-14** Chat: WebSocket connections with a scalable message broker (Redis Pub/Sub or equivalent).

### Accessibility
- **NFR-15** WCAG 2.1 AA compliance for all user-facing pages.
- **NFR-16** Keyboard navigable. Screen reader compatible.
- **NFR-17** Responsive design: fully functional on desktop, tablet, and mobile browsers (mobile-first for consumer-facing pages).

### Observability
- **NFR-18** Structured logging on all services. Centralized log aggregation.
- **NFR-19** Application performance monitoring (APM): traces on all API endpoints.
- **NFR-20** Error tracking with alerting: real-time alerts on error rate spikes, payment failures, and fraud signal surges.
- **NFR-21** Business metrics dashboard: jobs posted, bids submitted, auctions completed, payment volume — updated in real time.

## 19. Security & Compliance

### Authentication & Authorization
- **SEC-1** Authentication: bcrypt password hashing (or Argon2id). OAuth 2.0 for social login. JWTs for session management with short-lived access tokens and rotating refresh tokens.
- **SEC-2** Multi-factor authentication (MFA): available for all users, required for admin accounts. MFA methods: authenticator app (TOTP) and SMS fallback. Recovery: users receive 10 one-time backup codes during MFA setup. Admin MFA reset requires a second admin to approve the reset request. If only one admin exists, MFA reset requires identity verification via the platform owner's email on record.
- **SEC-3** Role-based access control: Customer, Provider, Admin, Support, Analyst. Permissions enforced at the API layer.
- **SEC-4** Session management: automatic logout after inactivity. Default timeouts: 60 minutes for customers, 120 minutes for providers (providers are often on job sites and need longer sessions), 30 minutes for admin accounts. All configurable. Active WebSocket connections (chat) reset the inactivity timer. Concurrent session limit: 3 devices per account.

### Data Protection
- **SEC-5** Encryption at rest: all data encrypted using AES-256 (or cloud provider equivalent).
- **SEC-6** Encryption in transit: TLS 1.3 on all connections. No exceptions.
- **SEC-7** PII handling: personal data (names, addresses, phone numbers, documents) stored in dedicated encrypted fields. Access logged.
- **SEC-8** Document storage: uploaded identity documents stored in a separate, access-controlled bucket with encryption. Documents are never served publicly. Access requires authenticated API call with authorization check.
- **SEC-9** Payment data: NoMarkup never stores raw card numbers. All payment data handled by the payment processor (PCI DSS compliance delegated to Stripe or equivalent).

### API Security
- **SEC-10** Rate limiting on all public endpoints. Stricter limits on authentication endpoints (login, registration, password reset).
- **SEC-11** CSRF protection on all state-changing requests.
- **SEC-12** Input validation and sanitization on all user inputs. Parameterized queries (no raw SQL). Output encoding to prevent XSS.
- **SEC-13** CORS policy: restrict to known origins.
- **SEC-14** API versioning: all endpoints versioned. Deprecation policy for breaking changes.

### Fraud & Abuse Prevention
- **SEC-15** CAPTCHA on registration and password reset. For document uploads, use invisible CAPTCHA (reCAPTCHA v3 or equivalent) that scores risk silently — only challenge users who score as likely bots. This prevents stacking multiple CAPTCHA challenges during the provider onboarding flow.
- **SEC-16** Bot detection: behavioral analysis, device fingerprinting, IP reputation checks (see Section 8.7).
- **SEC-17** Off-platform communication blocking: detect and warn when users attempt to share phone numbers, emails, or external links in chat.

### Compliance
- **SEC-18** CCPA compliance: users can request data export and deletion. Privacy policy and ToS required at registration.
- **SEC-19** SOC 2 Type II: target for post-MVP. Architecture and practices should be designed with SOC 2 in mind from day one.
- **SEC-20** PCI DSS: compliance delegated to payment processor. NoMarkup maintains SAQ-A or SAQ-A-EP status.
- **SEC-21** Data retention policy: define retention periods for chat transcripts, transaction records, fraud logs, and user data. Implement automated purging for expired data.

## 20. Tech Stack Recommendations

The following stack is recommended for best-in-class performance, developer productivity, and scalability. Final decisions should be made by the engineering team during sprint 0.

### Frontend
| Layer | Technology | Rationale |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | Server-side rendering for SEO and performance. React Server Components for efficient data loading. Industry standard for production web apps. |
| Language | **TypeScript** | Type safety across the entire frontend. Shared types with API layer. |
| Styling | **Tailwind CSS** | Utility-first, performant, consistent design system. |
| Component Library | **shadcn/ui** | Accessible, unstyled primitives. Full design control. |
| State Management | **React Query (TanStack Query)** | Server state management with caching, optimistic updates, and real-time sync. |
| Maps | **Mapbox GL JS** or **Google Maps JS API** | Evaluate cost. Mapbox is more customizable; Google Maps has better address/directions integration. |
| Real-time | **Socket.io client** or **native WebSockets** | For chat and live bid updates. |

### Backend
| Layer | Technology | Rationale |
|---|---|---|
| Runtime | **Node.js** or **Go** | Node.js for faster initial development and shared TypeScript types. Go for raw performance on high-throughput services (chat, analytics). Consider Node for MVP, Go for performance-critical services. |
| API Framework | **Next.js API Routes** (if Node) or **Gin/Echo** (if Go) | Next.js API routes collocate with frontend. Separate Go services for performance-critical paths. |
| API Protocol | **REST** with OpenAPI spec | Standard, well-tooled, easy to document. GraphQL considered but adds complexity for MVP. |
| Authentication | **NextAuth.js** or **Auth.js** | Handles OAuth, JWT, session management. Battle-tested. |
| Real-time | **Socket.io** or **WebSocket server** | Chat and live updates. Can run as a separate service. |
| Background Jobs | **BullMQ** (Node) or **Temporal** | Queued jobs for: document verification processing, fraud analysis, notification delivery, analytics aggregation. |

### Data
| Layer | Technology | Rationale |
|---|---|---|
| Primary Database | **PostgreSQL** | Relational integrity for transactional data (users, jobs, bids, contracts, payments). PostGIS extension for geospatial queries. |
| Cache | **Redis** | Session cache, rate limiting, real-time pub/sub for chat, job feed caching. |
| Search | **PostgreSQL full-text search** (MVP) → **Elasticsearch** (scale) | Start simple. Move to Elasticsearch when search complexity or volume demands it. |
| File Storage | **AWS S3** or **Google Cloud Storage** | Identity documents, job photos, profile images. Served via CDN. |
| Analytics Store | **PostgreSQL** (MVP) → **ClickHouse** or **BigQuery** (scale) | Transaction analytics and market pricing. Start in Postgres, migrate to columnar store as data grows. |

### AI/ML
| Layer | Technology | Rationale |
|---|---|---|
| Fraud Detection | **Python (scikit-learn, XGBoost)** or **managed ML (AWS SageMaker, Vertex AI)** | Rule-based engine for MVP with ML models layered on as data accumulates. |
| NLP (review analysis) | **OpenAI API** or **Claude API** | Linguistic similarity detection for fake reviews. Sentiment analysis. |
| Pricing Intelligence | **Python (pandas, statsmodels)** | Statistical analysis on transaction data. Percentile calculations, trend detection, seasonal adjustment. |

### Infrastructure
| Layer | Technology | Rationale |
|---|---|---|
| Cloud Provider | **AWS** or **GCP** | Both viable. AWS has broader service catalog. GCP has better ML integration. |
| Container Orchestration | **Kubernetes (EKS/GKE)** or **Vercel** (frontend) + **Cloud Run** (backend) | Vercel for Next.js frontend (optimal DX and performance). Cloud Run or EKS for backend services. |
| CI/CD | **GitHub Actions** | Standard. Integrates with all deployment targets. |
| Monitoring | **Datadog** or **Grafana Cloud** | APM, logging, alerting in one platform. |
| Error Tracking | **Sentry** | Real-time error tracking with source maps and stack traces. |
| Payment Processor | **Stripe Connect** | Industry standard for marketplace payments. Handles escrow, split payments, provider onboarding, Apple Pay, Google Pay. |

## 21. Rollout Strategy

### Phase 1: Internal Alpha (Weeks 1–2 post-build)
- Deploy to staging environment.
- Internal team tests all flows end-to-end: registration, job posting, bidding, chat, payment, reviews.
- Verification toggle OFF (demo mode).
- Analytics hidden (Shift+~ only).
- Seed the platform with test data: fake jobs, providers, reviews to validate UI and analytics pipeline.

### Phase 1.5: Supply-Side Bootstrapping (Weeks 2–3, overlaps with Alpha)
- **Goal:** Onboard a minimum of 25 verified providers across at least 5 service categories before inviting any customers. A marketplace with zero providers has zero value to customers.
- **Priority categories for Seattle launch:** General Handyman, Cleaning, Landscaping, Plumbing, Electrical (highest demand, broadest appeal).
- Source providers through: local trade associations, Seattle contractor Facebook groups, Nextdoor recommendations, direct outreach to independent contractors, partnerships with local trade schools.
- Offer Pro tier free for 6 months to first 50 providers as a launch incentive.
- Seed the analytics engine with market pricing data (per FR-11.5) so the market range bar has data from day one.

### Phase 2: Closed Beta — Seattle (Weeks 3–6)
- Invite 50–100 early users: mix of homeowners and service providers in Seattle metro.
- **Minimum viable liquidity target:** At least 3 providers per service category before inviting customers for that category. Categories with < 3 providers are hidden from customers until supply is sufficient.
- Source customers through personal networks, local community groups, and targeted social media.
- Verification toggle ON — but with manual review (not automated).
- Collect feedback on: onboarding flow, job posting UX, bidding experience, chat usability, payment clarity.
- Monitor fraud detection system — tune thresholds based on real activity.
- Begin collecting transaction data for market analytics.
- **Support readiness:** At least 1 support agent trained on the platform before beta begins. Dispute resolution and verification review must be handled within SLA from day one.

### Phase 3: Open Beta — Seattle (Weeks 7–12)
- Open registration to all Seattle-area users.
- Marketing push: social media, local advertising, partnerships with Seattle home services communities.
- Enable subscription model (free tier + Pro trial).
- Analytics enabled for internal review. Evaluate whether to make visible to users.
- Performance testing under real load. Scale infrastructure as needed.
- Iterate on fraud detection models with real data.

### Phase 4: General Availability — Seattle (Weeks 13+)
- Full launch in Seattle market.
- All features enabled and stable.
- Monetization active (subscription and/or transaction fees — decision made based on beta learnings).
- Customer support fully staffed (hire and train support agents by Week 11 at latest — 2 weeks before GA).
- Verification toggle ON with enforcement.
- Market range bar visible to all users (seeded data supplemented by platform transaction data from beta).
- Begin planning expansion to additional Washington state markets.

### Expansion Path
- **City → State:** After Seattle is stable and growing, expand to other Washington cities (Tacoma, Bellevue, Spokane).
- **State → Regional:** Pacific Northwest (Oregon, Idaho).
- **Regional → National:** Major metro areas first (Portland, San Francisco, Denver, Austin, etc.), then fill in.
- **Web → Mobile:** Native iOS and Android apps developed in parallel with geographic expansion.

## 22. Future Phases (Out of MVP Scope)

The following features are explicitly out of scope for MVP but should be considered in the architecture so they are not prohibitively expensive to add later.

### Phase 2: Materials & Hardware Procurement
- Corporate accounts with material vendors and suppliers.
- Volume discount negotiation leveraging platform scale.
- Drop-ship hardware directly to customer's service address.
- NoMarkup passes through retail cost to customer — revenue from supplier discount delta.
- Provider-facing catalog: browse available materials at platform-negotiated prices.
- Material cost integration into job bidding: providers can itemize parts from the catalog in their bids.

### Phase 3: Financial Services Launch (see Section 12)
- Provider working capital advances against awarded contracts.
- Customer BNPL / installment financing for jobs over $2,000.
- Enhanced NoMarkup Guarantee with paid premium tier for high-value jobs.
- Provider business services: bookkeeping integration, tax estimation, expense tracking.

### Phase 4: Native Mobile Applications
- iOS and Android apps with feature parity to web.
- Push notifications for bids, chat messages, job updates, payment events.
- Camera integration for document upload and job site photos.
- GPS-based job discovery for providers (nearby jobs shown on map).
- Offline support for chat message drafting and job browsing.

### Phase 5: NoMarkup Instant — Full Launch (see Section 13)
- Full real-time broadcast matching for emergency jobs.
- Provider availability tracking with GPS-based ETA.
- AI-powered provider recommendation for emergency matching.
- Premium pricing engine with dynamic surge pricing based on demand.

### Phase 6: B2B & Enterprise Channel (see Section 14)
- Enterprise API for programmatic job posting, provider queries, and reporting.
- White-label option for property management companies and home warranty providers.
- Enterprise sales team and account management.
- Custom integrations with property management software (Yardi, AppFolio, Buildium).

### Phase 7: Advanced AI/ML
- Automated provider-job matching: AI recommends providers to customers based on past behavior, preferences, and job characteristics.
- Dynamic pricing suggestions: AI suggests optimal bid prices to providers based on market conditions and their win rate.
- Automated scope estimation: AI generates scope of work templates based on service type and job description.
- Predictive fraud detection: proactive flagging before fraud occurs based on behavioral patterns.
- Chatbot assistance: AI-powered chat assistant that helps customers write job descriptions and helps providers craft competitive bids.

### Phase 8: Platform Expansion — New Verticals (see Section 16)
- Tier 1: Auto repair, moving services, pet services, commercial cleaning.
- Tier 2: Legal services, accounting, event services, tutoring.
- Tier 3: Healthcare (elective), commercial construction.
- Each vertical requires: new taxonomy categories, category-specific verification, and seeded pricing data.

### Phase 9: Platform Intelligence & Content
- Public-facing market reports powered by real transaction data (SEO moat — see Section 11).
- Provider business analytics: revenue trends, job completion rates, customer retention, competitive positioning.
- Customer spend analytics: total spend by category, savings vs. market average, provider performance tracking.
- Provider teams: a single provider account can have multiple technicians with job assignment and schedule management.

## 23. Open Questions

### Sprint 0 Blockers (must resolve before development begins)

| # | Question | Impact | Proposed Owner |
|---|---|---|---|
| 1 | **Cloud provider:** AWS vs. GCP? | Infrastructure, ML pipeline, cost, all deployment decisions | Engineering |
| 2 | **Backend language:** Node.js (shared types with frontend) vs. Go (performance) vs. hybrid? Recommendation: Node.js/TypeScript for MVP (shared types, faster velocity, one language), introduce Go only for performance-critical services post-launch. | Architecture, hiring, velocity | Engineering |
| 3 | **Map provider:** Google Maps API vs. Mapbox? Cost comparison at 10K users needed. Google has better directions integration (FR-10.4); Mapbox is more customizable and cheaper at scale. | Frontend, cost | Engineering |
| 4 | **Background checks:** Do we run background checks on providers for MVP, or defer to Phase 2? If yes, which vendor (Checkr, Sterling, etc.)? This is central to the safety thesis (Problem Statement #5) — deferring it weakens the core value proposition. | Trust & safety, cost, onboarding friction | Product / Engineering |

### Pre-Launch Decisions (must resolve before beta)

| # | Question | Impact | Proposed Owner |
|---|---|---|---|
| 5 | **Subscription pricing:** What are the monthly rates for Pro tier (customer and provider)? | Monetization, go-to-market | Product / Business |
| 6 | **Transaction fee percentage:** What percentage does NoMarkup take per transaction? | Monetization, provider economics | Product / Business |
| 7 | **Primary monetization model:** Subscription, transaction fee, or hybrid for launch? | Marketing and pricing strategy | Product / Business |
| 8 | **Free tier limits:** How many active jobs for free customers? How many bids per month for free providers? Engineering needs hard numbers to build subscription enforcement. | Growth, conversion to paid | Product |
| 9 | **Insurance requirements:** Do we require providers to carry a minimum level of insurance to bid? What minimum? | Trust & safety, provider onboarding friction | Product / Legal |
| 10 | **Data seeding for analytics:** Which public data sources do we license for initial market pricing data? Scraping competitor data has legal risk. BLS data is free. Manufacturer MSRPs require partnerships. | Analytics accuracy at launch | Engineering / Data / Legal |
| 11 | **SMS/OTP provider:** Twilio, AWS SNS, or other? VOIP number acceptance policy (fraud risk: VOIP numbers are commonly used for fake accounts). | Registration, fraud prevention, cost | Engineering |
| 12 | **Apple Sign In for web:** Required on iOS apps but optional on web. Since MVP is web-only, do we implement it now for future consistency, or add it with native mobile? | Onboarding, future consistency | Engineering |

### Development-Phase Decisions (can resolve during sprints)

| # | Question | Impact | Proposed Owner |
|---|---|---|---|
| 13 | **Review visibility timing:** Do we show reviews immediately after both submit, or add a 24-hour cooling period? | Trust, user experience | Product |
| 14 | **Priority placement for Pro providers (FR-12.1):** How does this manifest in the UI? Higher position in bid list? Badge? Highlighted listing on map? Needs a concrete spec. | Monetization, UX | Product / Design |
| 15 | **Cold start bootstrapping:** How many providers need to be onboarded before inviting customers? Which service categories are prioritized for Seattle launch? What is minimum viable liquidity? | Go-to-market, beta planning | Product / Growth |
| 16 | **Provider capacity management:** Should providers have a max concurrent job limit? Self-set or platform-enforced? Prevents overcommitment and no-shows. | Quality, trust | Product |
| 17 | **NLP review analysis privacy:** Sending user-generated reviews to OpenAI/Claude API has privacy implications. User consent required? What about the LLM provider's data retention? | Privacy, compliance, architecture | Legal / Engineering |

## 24. Appendices

### Appendix A: Job Lifecycle State Diagram

```
                          ┌──────────────────────────────────────────────┐
                          │              HAPPY PATH                      │
                          └──────────────────────────────────────────────┘

Draft → Active (accepting bids) → Closed (auction window expired or manually closed)
                                      ↓
                                   Awarded (customer selects provider)
                                      ↓
                                   Contract Pending (both parties review/accept)
                                      ↓
                                   In Progress (work begins)
                                      ↓
                                   Completed (work confirmed, final payment released)
                                      ↓
                                   Reviewed (both parties submit reviews or 14-day window closes)

                          ┌──────────────────────────────────────────────┐
                          │             UNHAPPY PATHS                     │
                          └──────────────────────────────────────────────┘

Active    → Cancelled          Customer cancels auction. Bidders notified.
Active    → Closed (0 bids)    Auction closes with no bids. Customer notified
                               with suggestions (adjust starting bid, broaden category).

Closed    → Reposted           Customer rejects all bids, creates new auction.
                               Original job linked to repost. Repost count tracked.
Closed    → Expired            Customer takes no action within 48 hours.

Awarded   → Cancelled          Customer or provider cancels before work starts.
                               See FR-16.2, FR-16.3 for financial consequences.
Contract  → Voided             Neither party accepts within 72 hours.
Pending                        Customer can award to next-best bidder or repost.

In Progress → Disputed         Either party opens dispute. Payments frozen.
                               See FR-16.6 for resolution flow.
In Progress → Abandoned        Provider non-responsive for 72 hours after
                               status update request. See FR-16.5.
In Progress → Cancelled        Mutual cancellation. Pro-rated payment per
                               completed milestones.

Any State → Suspended          Admin action due to fraud or policy violation.
                               All activity frozen pending review.
```

### Appendix B: Payment Flow

```
Job Awarded → Contract Accepted → Payment Terms Locked
  ↓
┌──────────────────────────────────────────────────────────────────────┐
│ PAYMENT         │ HAPPY PATH                │ FAILURE PATH           │
│ STRUCTURE       │                           │                        │
├─────────────────┼───────────────────────────┼────────────────────────┤
│ Full Upfront    │ Customer charged. Funds   │ Charge fails → Job     │
│                 │ held in escrow via Stripe │ cannot start. Customer │
│                 │ until completion.         │ updates payment method. │
├─────────────────┼───────────────────────────┼────────────────────────┤
│ Upon Completion │ Provider marks complete → │ Charge fails → 48hr    │
│                 │ Customer approves (or     │ window to update.      │
│                 │ auto-release at 7 days) → │ Provider notified of   │
│                 │ Customer charged → Payout. │ delay. See FR-16.7.   │
├─────────────────┼───────────────────────────┼────────────────────────┤
│ Milestone       │ Each milestone: provider  │ Milestone disputed →   │
│                 │ marks complete → customer │ Frozen pending Support  │
│                 │ approves (or auto-release │ review. Approved        │
│                 │ at 7 days) → payment      │ milestones are final   │
│                 │ released.                 │ and non-refundable.    │
├─────────────────┼───────────────────────────┼────────────────────────┤
│ Payment Plan    │ Scheduled installments    │ Failed installment →   │
│                 │ charged automatically per │ 3 retries over 7 days. │
│                 │ agreed dates.             │ All fail → contract    │
│                 │                           │ paused.                │
├─────────────────┼───────────────────────────┼────────────────────────┤
│ Recurring       │ Auto charge per           │ Failed charge →        │
│                 │ occurrence on schedule.   │ 3 retries over 7 days. │
│                 │                           │ All fail → recurrence  │
│                 │                           │ paused. See FR-18.8.   │
└─────────────────┴───────────────────────────┴────────────────────────┘
  ↓
Provider Payout (minus platform fee) → Bank Account (ACH)
Payout timing: Stripe Connect standard schedule (2 business days after release).
  ↓
┌──────────────────────────────────────────────────────────────────────┐
│ CHARGEBACK PATH                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ Customer files bank chargeback → NoMarkup notified via webhook →    │
│ Amount deducted from provider pending payouts → Support reviews →   │
│ Evidence submitted to contest if unjustified → Customer flagged.    │
│ Provider protected if completion was confirmed. See FR-16.8.        │
└──────────────────────────────────────────────────────────────────────┘
```

**Stripe Connect Account Type:** Express. Rationale:
- Express accounts provide a Stripe-hosted onboarding flow (reduces NoMarkup's PCI and KYC burden).
- NoMarkup controls payout timing (required for escrow-like behavior using separate charges and transfers).
- Providers see a branded Stripe dashboard for their payout history.
- Express supports all required payment methods (cards, Apple Pay, Google Pay) and payout methods (ACH).
- Custom accounts offer more control but require building the entire onboarding and dashboard UI — unnecessary complexity for MVP.

**Currency:** USD only for MVP. Multi-currency deferred to national expansion phase.

### Appendix C: Composite Scoring Model

The Trust Score is a composite of four distinct scoring dimensions, each independently calculated and visible on profiles. This allows customers and providers to evaluate specific aspects of trustworthiness, not just a single opaque number.

**Overall Trust Score range:** 0–100 (clamped, never negative). New accounts start at a baseline of 50.

---

#### Dimension 1: Feedback Score (35% of Trust Score)

Measures quality of service delivery and customer satisfaction.

| Component | Weight (within dimension) | Normalization | Description |
|---|---|---|---|
| Overall Star Rating | 40% | (avg_rating / 5) × 100 | Weighted average of all ratings. Recent reviews (last 90 days) weighted 2x. Accounts with < 3 reviews use baseline of 50. |
| Value for Service | 25% | (avg_value_rating / 5) × 100 | Sub-rating from reviews: "Was the price fair for the quality of work?" |
| On-Time Delivery | 25% | on_time_pct × 100 | Percentage of jobs completed on or before the scheduled date. Jobs with "flexible" schedule excluded. Measured from scheduled date to customer-confirmed completion date. |
| Communication | 10% | (avg_communication_rating / 5) × 100 | Sub-rating from reviews: "How was the provider's communication?" |

**Display:** Shown as a star rating (1–5) with drill-down into sub-ratings. "4.7 stars — 92% on-time — 47 reviews."

---

#### Dimension 2: Volume Score (20% of Trust Score)

Measures platform activity, experience, and reliability at scale.

| Component | Weight (within dimension) | Normalization | Description |
|---|---|---|---|
| Completed Transactions | 50% | min(completed_jobs / 50, 1) × 100 | Total completed on-platform transactions. Caps at 50 for max score. |
| Repeat Customer Rate | 25% | (repeat_customers / total_customers) × 100 | Percentage of unique customers who have hired this provider more than once. |
| Response Time | 15% | Tiered: < 1hr = 100, < 4hr = 75, < 24hr = 50, > 24hr = 25 | Average time to respond to chat messages and bid inquiries. Business hours (8am–8pm local) only. |
| Account Tenure | 10% | min(months / 12, 1) × 100 | Caps at 12 months for max score. |

**Display:** Shown as a tier badge: "47 jobs completed — 68% repeat customers."

---

#### Dimension 3: Risk Score (25% of Trust Score)

Measures account verification, compliance, and safety posture. Higher is better (lower risk = higher score).

| Component | Weight (within dimension) | Normalization | Description |
|---|---|---|---|
| Identity Verification | 30% | Binary: verified = 100, not = 0 | Government-issued photo ID verified. |
| Business Documentation | 25% | (verified_biz_docs / 3) × 100 | Points for: business license (33), EIN (33), trade license (34). |
| Insurance Verification | 25% | Binary: verified = 100, not = 0 | General liability insurance verified and current (not expired). |
| Cancellation/No-Show Rate | 10% | (1 - cancel_rate) × 100 | Lower cancellation and no-show rates = higher score. |
| Dispute Rate | 10% | (1 - dispute_rate) × 100 | Lower dispute rate = higher score. Disputes resolved in provider's favor do not count against them. |

**Display:** Shown as verification badges with a risk level: "Fully Verified — ID, License, Insurance" or "Partially Verified — ID only."

---

#### Dimension 4: Fraud Score (20% of Trust Score)

Measures the absence of fraudulent signals. This is an inverse score — higher means cleaner (less fraud detected).

| Component | Weight (within dimension) | Normalization | Description |
|---|---|---|---|
| Account Integrity | 30% | 100 - (active_flags × severity_weight) | No shared IPs/devices with other accounts, no duplicate documents, no bot behavior. |
| Review Integrity | 25% | 100 - (review_flags × severity_weight) | No review manipulation signals: no review rings, no linguistic similarity patterns, no burst timing. |
| Transaction Integrity | 25% | 100 - (txn_flags × severity_weight) | No chargeback patterns, no dispute abuse, no refund abuse. |
| Behavioral Integrity | 20% | 100 - (behavior_flags × severity_weight) | No excessive reposts, no frequent bid withdrawals, no off-platform communication attempts. |

**Severity weights for deductions:**

| Flag Severity | Points Deducted Per Flag |
|---|---|
| Low | 5 |
| Medium | 15 |
| High | 30 |

**Floor:** Fraud Score cannot go below 0. A Fraud Score of 0 triggers automatic account suspension pending admin review.

**Display:** Not shown numerically to end users. Manifests as: "Account in Good Standing" (score > 70), "Under Review" (score 30–70), or account suspended (score < 30).

---

#### Overall Trust Score Calculation

```
Trust Score = (Feedback Score × 0.35) + (Volume Score × 0.20) + (Risk Score × 0.25) + (Fraud Score × 0.20)
```

Clamped to 0–100. Recalculated on every relevant event (new review, new transaction, new verification, new fraud signal).

**Tier labels (based on overall Trust Score):**

| Score Range | Tier | Display |
|---|---|---|
| 0–29 | Under Review | Red badge. Account may be restricted. |
| 30–49 | New | Gray badge. Limited platform history. |
| 50–69 | Rising | Blue badge. Building track record. |
| 70–84 | Trusted | Green badge. Strong track record. |
| 85–100 | Top Rated | Gold badge. Exceptional track record. |

**Profile display:** The overall Trust Score tier badge is shown on profiles and in bid listings. Customers can click through to see the breakdown across all four dimensions with detailed sub-scores.

### Appendix D: Fraud Signal Categories

| Category | Signals | Severity |
|---|---|---|
| **Review Manipulation** | Same IP/device as reviewer, review rings, linguistic similarity, burst timing | High |
| **Account Fraud** | Shared IP/device across accounts, duplicate documents, bot behavior | High |
| **Bid Manipulation** | Abnormal win rates, shill bidding patterns, price manipulation | Medium |
| **Transaction Fraud** | Chargeback patterns, dispute frequency, refund abuse | High |
| **Bad Actor Behavior** | Frequent reposts (customer), frequent bid withdrawals (provider), off-platform communication attempts | Low–Medium |
