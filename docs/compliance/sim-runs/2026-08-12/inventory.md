# Simulator inventory — 2026-08-12

Depth: deep. Scheme: NoMarkup. Bundle: com.nomarkup.app.

## Root chrome

| Screen | File | Entry | Auth | Primary APIs | a11y |
|--------|------|-------|------|--------------|------|
| Sign in | Auth/LoginView.swift | cold launch | no | POST /api/v1/auth/login | login.email, login.password, login.submit, login.passkey |
| Register | Auth/RegisterView.swift | Create account | no | POST /api/v1/auth/register | |
| Forgot password | Auth/ForgotPasswordView.swift | Forgot password? | no | POST /api/v1/auth/forgot-password | |
| Browse scaffold | RootTabView via Browse without signing in | CTA | no | public listings/jobs | root.tabview, tab.* |
| Home | Features/HomeView.swift | tab | yes | GET /jobs, /listings, health | home.hero, home.browseJobs, home.instantMatch, home.shopGoods, home.postJob, home.sellItem, home.marketDesk, home.stats, home.deskRefresh, home.deskStatus, home.revision |
| Marketplace | Features/MarketplaceView.swift | tab | optional | GET /listings, autocomplete | marketplace.list/loading/error/empty/map |
| Jobs | Features/JobsView.swift | tab | optional | GET /jobs | jobs.segment/filters/map/list/loading/error/empty |
| Messages | Features/MessagesView.swift | tab | yes | GET /channels | tab.messages |
| Account | Features/AccountView.swift | tab | yes | GET /users/me, unread-count | account.row.* |

## Account destinations (account.row.*)

profile, providerWorkspace, instantOffers, security, verification, postJob, drafts, sell, orders, contracts, recurringJobs, myBids, positions, myListings, watchlist, savedSearches, sellerAnalytics, sellerPayouts, businessFinance, insuranceQuote, salesExport, calendarExport, team, challenges, legalServices, quoteTemplates, verificationDocuments, paymentMethods, paymentsHistory, notifications, notificationPreferences, providers, following, followingFeed, properties, wishlist, blockedUsers, referrals, feedbackSurveys, savings, markets, fairPrice, marketplaceMap, trustTiers, privacyPolicy, termsOfService, termsAcceptance, communityGuidelines, support, exportData, deleteAccount, planLimits, featureFlags, admin

## Permission-gated

- Location: job check-in, jobs map, marketplace map, directions
- Photos/camera: listing photos, job photos, work evidence after-photo, profile photo
- Notifications: Account push status
- Face ID: BiometricGate / lock overlay / payment delete
- Sign in with Apple / Google / Facebook / passkeys

## Workflows (deep = all)

WF-AUTH.1–8, WF-TAB.1–3, WF-MKT.1–6, WF-JOB.1–7, WF-MSG.1–4, WF-ACC.1–6, WF-SYS.1–4, WF-NEG.1–4

## Notes

- iOS has no separate admin console; admin seed uses same 5-tab shell; admin.row is a consumer-facing console sheet.
- StoreKitEnabled defaults false.
- Check-in App Intent is deep-link-only.
- Unsigned Debug (`CODE_SIGNING_ALLOWED=NO`) produced Keychain -34018 on auto-login — signed rebuild required.
