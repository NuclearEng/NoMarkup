# Full iOS surface inventory — 2026-08-22

Scope: every **user-reachable** SwiftUI screen, tab, sheet, App Intent, widget, and deep link in `ios/NoMarkup` + `ios/NoMarkupWidget`. Product code was not edited.

Account tab rows (`account.row.*`) are already inventoried in [`docs/compliance/sim-runs/2026-08-21-account-audit/00-inventory.md`](../2026-08-21-account-audit/00-inventory.md). This file **includes that hub by reference**, plus tabs, Home / Jobs / Marketplace / Messages, login, nested details, intents, widgets, permissions, and XCUITest coverage.

**Delta vs 2026-08-21 Account inventory:** hub now also has `account.row.requestLog` → `ClientActionLogView.swift` (on-device API request log). `allAccountNavigationRowIDs` in `ScreenshotWalkUITests` includes it.

Paths below are relative to repo root (`ios/NoMarkup/…` unless noted).

---

## 1. App chrome (always-on)

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Signed-out shell | `Auth/LoginView.swift` | Cold launch when `AuthViewModel.isAuthenticated == false` (`NoMarkupApp.swift` `RootView`) | No | `POST /auth/login` via `AuthViewModel.login()` | `login.email`, `login.password`, `login.submit`, `login.error`, `login.status`, `login.passkey` (flag `passkeys`), `login.facebook` |
| MFA challenge | `Auth/LoginView.swift` (`mfaForm`) | After login when `auth.needsMFA` | In-progress login | `AuthViewModel.verifyMFA()` | Label “Authenticator code”; submit “Verify authenticator code and sign in” — **no stable id** |
| Biometric app lock overlay | `NoMarkupApp.swift` `biometricLockOverlay` | Signed-in + Security “Require Face ID for sensitive actions” + background/cold | Yes | Local `BiometricGate` (LAContext) | `lock.overlay`, `lock.unlock` |
| Offline banner | `NoMarkupApp.swift` `OfflineNetworkBanner` | `NetworkMonitor` unsatisfied | Either | None | `banner.offline` |
| Age gate (18+) overlay | `Features/AgeGateView.swift` | `.ageGateWhenNeeded()` on `RootView` when `GET /me/age-status` `verified: false` | Yes (scaffold skipped) | `fetchAgeStatus`, `setDateOfBirth` | `ageGate.dialog`, `ageGate.retry`, `ageGate.checkError`, `ageGate.checking` |
| Age-blocked | `AgeGateView.swift` `AgeStatusBlockedView` | Under-18 server response | Yes | Same | (blocked copy; retry id when failed) |
| Notification pre-prompt alert | `NoMarkupApp.swift` | First watch/bid value moment (`PushRegistration.shouldShowPermissionPrePrompt`) | Yes | `UNUserNotificationCenter.requestAuthorization` after confirm | System alert; copy in `NotificationPermissionCopy` |
| Root tab shell | `Features/RootTabView.swift` | Signed-in (incl. DEBUG scaffold) | Yes (scaffold = browse-only) | Unread: `fetchChatChannels`, `fetchUnreadNotificationCount` | `root.tabview`, `tab.home`, `tab.marketplace`, `tab.jobs`, `tab.messages`, `tab.account` |
| Post-register onboarding sheet | `Features/OnboardingWizardView.swift` | `RootTabView` when `auth.shouldPresentOnboarding` | Yes | Same as Account Finish setup (`fetchMe`, `updateMe`, OTP, `enableRole`) | `account.finishSetup` only on Account row; wizard itself unlabeled root |
| Deep-link destination sheet | `RootTabView` `presentedRoute` / `deepLinkSheetView` | App Intent, `nomarkup://`, APNs `action_url` | Yes (unsigned → LoginView; intents fail closed) | Destination-specific | Destination ids |
| Harness request-log probe | `RootTabView` `UITestRequestLogProbe` | `LaunchTestAuth.isHarness` only | n/a | `ClientActionLog` | `debug.requestLog.latest` |

UIKit bridges (not standalone product screens): `LegalWebView.swift` `SafariView` (`SFSafariViewController`); `Core/CameraImagePicker.swift` (`UIImagePickerController`); Stripe PaymentSheet; Sign in with Apple (`ASAuthorization`); Google/Facebook `ASWebAuthenticationSession`.

---

## 2. Auth destinations

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Sign in | `Auth/LoginView.swift` | Root when signed out | No | Login, optional passkey | See §1 |
| Create account | `Auth/RegisterView.swift` | Login “Create account” (`AuthRoute.register`) | No | Register + optional passkey enroll | `register.addPasskey`, `register.skipPasskey` |
| Reset password | `Auth/ForgotPasswordView.swift` | Login “Forgot password?” | No | Request reset + token/new password | *(none)* |
| Sign in with Apple | `Auth/SignInWithAppleButton.swift` | Login (hidden in UITest launch) | No | `POST /auth/apple/native` | Label “Sign in with Apple” |
| Continue with Google | `Auth/GoogleSignInButton.swift` | Login if `AppConfig.isGoogleSignInConfigured` | No | OAuth session | Label “Continue with Google” |
| Continue with Facebook | `Auth/FacebookSignInButton.swift` | Login if Facebook configured | No | OAuth; redirect `nomarkup://oauth2redirect/facebook` | `login.facebook` |
| Passkey sign-in | `Auth/PasskeyAuth.swift` + Login | `passkeys` feature flag | No | WebAuthn options/verify | `login.passkey` |
| DEBUG scaffold | Login “Browse without signing in” | `#if DEBUG` only | No (fake session) | None | Hint only |
| Login legal links | Login footer | Safari `Link` | No | None (`AppConfig.privacyURL` / `termsURL`) | *(none)* |

---

## 3. Five tabs

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| **Home** | `Features/HomeView.swift` | Tab `tab.home` | Signed-in chrome; catalog public | `health()`, `fetchJobs` (open), `fetchListings`; widget snapshot `fetchMyListingBids` / `fetchMyJobBids` | `home.hero`, `home.browseJobs`, `home.instantMatch`, `home.shopGoods`, `home.postJob`, `home.sellItem`, `home.marketDesk`, `home.stats`, `home.viewAllJobs`, `home.sellItem.marketplace`, `home.deskRefresh`, `home.deskStatus`, `home.revision` |
| **Marketplace** | `Features/MarketplaceView.swift` | Tab `tab.marketplace`; Home “Shop goods”; search intent | List public; sell needs auth | `fetchListings`, `autocompleteListings` | `marketplace.search`, `marketplace.map`, `marketplace.loading`, `marketplace.error`, `marketplace.empty`, `marketplace.list` |
| **Jobs** | `Features/JobsView.swift` | Tab `tab.jobs`; Home “Browse open jobs”; `/jobs` | Browse public; **Mine** needs auth | Browse `fetchJobs`; Mine `fetchMe` + `fetchMyJobs` | `jobs.segment`, `jobs.filters`, `jobs.map`, `jobs.search`, `jobs.loading`, `jobs.error`, `jobs.empty`, `jobs.list`, `jobs.browse.drainEmpty`, `jobs.mine.empty` |
| **Messages** | `Features/MessagesView.swift` | Tab `tab.messages`; deep link `/messages` | **Yes** (scaffold empty) | `fetchChatChannels` (`q` when searching) | `messages.row.{channelId}` |
| **Account** | `Features/AccountView.swift` | Tab `tab.account`; `nomarkup://account` | Hub visible; most rows disabled unsigned/scaffold | Hub: `currentUserID`, `fetchUnreadNotificationCount`, `fetchMe` | All `account.row.*` + `account.finishSetup` — **see 2026-08-21 inventory** |

### Home nested

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Post a job sheet | `PostJobView.swift` | Home `home.postJob` / `home.instantMatch` (`preferInstantMatch`); Account `account.row.postJob`; intent `OpenPostJobIntent`; `nomarkup://post-job` | Yes to submit | `createJob`, `createInstantMatch`, `fetchProperties`, `fetchMarketRange`, `fetchFairPrice` | `postJob.wizardChrome`, `postJob.matching`, `postJob.title`, `postJob.description`, `postJob.category`, `postJob.back`, `postJob.continue`, `postJob.submit` |
| Sell an item sheet | `CreateListingView.swift` | Home `home.sellItem`; Marketplace empty CTA; Account `account.row.sell` | Yes to publish | `createListing`, `fetchFairPrice` | `createListing.wizardChrome`, `createListing.title`, `createListing.description`, `createListing.condition`, `createListing.category`, `createListing.pickupZip`, `createListing.publish`, `createListing.back`, `createListing.continue`, `createListing.submit` |
| Job detail | `JobDetailView.swift` | Home `navigationDestination(JobSummary)` | Public read; bid/award auth | See §4 | `jobDetail.report`, `jobDetail.spectateSection`, `jobDetail.replaySection`, `jobDetail.liquidity`, `jobDetail.spectate`, `jobDetail.replay` |
| Listing detail | `ListingDetailView.swift` | Home listing cards | Public read; bid/buy auth | See §5 | `listingDetail.spectate`, `listingDetail.replay`, `listingDetail.spectateSection`, `listingDetail.replaySection`, `listingDetail.bidAuthDisclosure` |

---

## 4. Jobs catalog + detail

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Jobs browse / mine | `JobsView.swift` | Tab | Browse no / Mine yes | `fetchJobs`, `fetchMyJobs`, `fetchMe` | See §3 |
| Browse filters bar | `JobsView.swift` | `jobs.filters` toggle | No | Same list request with category / schedule / min bid | `jobs.filters` |
| Jobs map | `JobsMapView.swift` | Jobs toolbar `jobs.map` | No | `fetchJobsMap`; **location** optional | Location pre-prompt alert |
| Job detail | `JobDetailView.swift` | List / map pin / `nomarkup://jobs/{id}` / push | Read public | `fetchJob`, `fetchJobBids`, `fetchMyJobBids`, `fetchMarketRange`, `fetchFairPrice`, `fetchJobs` (similar), `fetchJobAuctionState`, `fetchJobAuctionEvents`, `placeJobBid`, `updateJobBid`, `withdrawJobBid`, `acceptJobOffer`, `awardJobBid`, `createInstantMatch`, `closeJob`, `cancelJob`, `repostJob`, `createChatChannel`, `reportJob` | See §3 |
| Place / lower bid (inline) | `JobDetailView.swift` | Scroll on open job (provider) | Yes | `placeJobBid` / `updateJobBid` | Labels “Place a bid (dollars)” / “Lower your bid (dollars)” |
| Report job sheet | `JobDetailView.swift` | `jobDetail.report` | Yes | `reportJob` | `jobDetail.report` |
| Spectate terminal | `SpectateTerminalView.swift` | Job `jobDetail.spectate` | No | `fetchJobAuctionState`, `fetchJob` + WS spectator | `jobDetail.spectate` / section |
| Auction replay | `AuctionReplayView.swift` | Job `jobDetail.replay` | No | `fetchJobAuctionEvents` | `auctionReplay.job` |
| Trust score | `TrustScoreView.swift` | Job provider row | No | `fetchUserTrustScore`, `fetchUserTrustHistory` | *(none)* |
| Category picker | `CategoryPickerView.swift` | Post job / filters / fair price | No | `fetchServiceCategories` | Used inside parents (`postJob.category`, `fairPrice.category`) |

Job confirm dialogs (not separate files): award, close, cancel, withdraw, accept offer.

---

## 5. Marketplace catalog + detail

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Marketplace list | `MarketplaceView.swift` | Tab | No | `fetchListings`, `autocompleteListings` | See §3 |
| Marketplace map | `ParitySurfacesView.swift` `MarketplaceMapView` | Marketplace toolbar `marketplace.map`; Account `account.row.marketplaceMap` | No | `fetchListings`; **location** optional | `marketplace.map.root`, `marketplace.map.refresh` |
| Listing detail | `ListingDetailView.swift` | List / map / `nomarkup://listings/{id}` | Read public | `fetchListing`, `fetchSimilarListings`, `fetchListingOffers`, `fetchListingBids`, `fetchWatchlist`, `placeListingBid`, `retractListingBid`, `buyNow`, `watchListing` / `unwatchListing`, `createListingOffer` / `updateOffer`, `createListingBidBond` / `confirmListingBidBond`, `createListingPromotion` / `confirmListingPromotion`, `cancelListing`, `reportListing` | See §3 |
| Place bid (inline) | `ListingDetailView.swift` | Buyer on active listing | Yes | `placeListingBid` (+ bond PaymentSheet) | Bid section labels; `listingDetail.bidAuthDisclosure` |
| Report listing sheet | `ListingDetailView.swift` | Toolbar | Yes | `reportListing` | |
| Bid-bond alert | `ListingDetailView.swift` | High-value bid | Yes | Bid-bond + Apple Pay | |
| Promote listing (seller) | `ListingDetailView.swift` | Seller chrome | Yes | Promotion create/confirm + PaymentSheet | |
| Buy now | `ListingDetailView.swift` | When buy-now price set | Yes | `buyNow` + PaymentSheet | Label “Buy now with Apple Pay” |
| Listing spectate / replay | Same as jobs | Listing ids | No | Listing fetch / `fetchListingReplay` | `listingDetail.spectate*`, `listingDetail.replay*`, `auctionReplay.listing` |
| Create listing sheet | `CreateListingView.swift` | Empty catalog CTA / Home / Account | Yes | See §3 | See §3 |

---

## 6. Messages

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Inbox | `MessagesView.swift` | Tab | Yes | `fetchChatChannels` | `messages.row.{id}` |
| Thread | `MessagesView.swift` `ChatThreadView` | Inbox row | Yes | `fetchChannelMessages`, `fetchChatChannel`, `sendChannelMessage` / image / file, `markChannelRead`, WS `/ws/chat` | Composer labeled “Message” |
| Camera attach sheet | `CameraImagePicker` from thread | Camera button | Yes + camera permission | Image upload + `sendChannelImageMessage` | |
| Propose terms sheet | Thread toolbar (provider) | Yes | `sendProposedTerms` | |
| Share-contact confirm alert | Thread toolbar | Yes | `shareChannelContact` | |
| Block-user alert | Thread | Yes | `blockUser` | |
| Report user sheet | Thread | Yes | `reportUser` | |
| Terms accept/reject | Thread cards | Customer | `respondToProposedTerms` | |
| Web Safari sheet | Thread links | Either | None | |

---

## 7. Account destinations (by reference + delta)

**Canonical row table:** [`2026-08-21-account-audit/00-inventory.md`](../2026-08-21-account-audit/00-inventory.md) — Screen | File | Entry (`account.row.*`) | Auth | APIs | a11y.

Hub file: `Features/AccountView.swift`. Nested files (unchanged unless noted):

`ProfileSettingsView`, `ProviderWorkspaceView` (+ `ProviderCategoriesEditView`), `ProviderInstantOffersView`, `SecuritySettingsView`, `VerificationCenterView`, `PostJobView`, `JobDraftsView`, `CreateListingView`, `MyOrdersView`, `ContractsView` → `ContractDetailView`, `RecurringJobsView`, `MyBidsView`, `PositionsBlotterView`, `MyListingsView` → `ListingDetailView`, `WatchlistView`, `SavedSearchesView`, `SellerAnalyticsView`, `SellerPayoutsView`, `BusinessFeaturesHubView` (+ BNPL/insurance/advances/instant-payout/expenses/tax — **iOS hard-off** money rails), `InsuranceQuoteFlowView`, `SalesExportView`, `CalendarExportView`, `EmployeesView`, `ChallengesView`, `LegalServicesView` (**hard-off row**), `QuoteTemplatesView`, `VerificationDocumentsView`, `PaymentMethodsView`, `PaymentsHistoryView`, `NotificationsView`, `NotificationPreferencesView`, `ProvidersView` → `ProviderDetailView` → `TrustScoreView` / `UserReviewsView`, `FollowingView`, `FeedView`, `PropertiesView` → `PropertyDetailView`, `WishlistView`, `BlockedUsersView`, `ReferralsView`, `NPSSurveysView`, `SavingsView`, `MarketsView`, `FairPriceIndexView`, `MarketplaceMapView`, `TrustTiersView`, `LegalWebView` / Safari, `TermsAcceptanceView`, `AccountDeletionView`, `PlanLimitsView`, `RegulatedRailsStatusView`, `AdminConsoleView`.

**Added since that inventory:**

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Request log | `ClientActionLogView.swift` | `account.row.requestLog` | No (local) | None (device `ClientActionLog`) | `requestLog.root`, `requestLog.httpCount`, `requestLog.row.{uuid}`, `requestLog.clear` |

Account hub chrome (sheets): onboarding, export share, legal Safari, sign-out confirm — see 2026-08-21 § Hub chrome.

### Account inner screens not fully listed as rows

| Screen | File | Entry path | Auth required | Primary APIs | a11y ids |
|---|---|---|---|---|---|
| Contract detail | `ContractDetailView.swift` | Contracts list; `nomarkup://contracts/{id}`; check-in intent | Party | `fetchContract`, accept/start/complete/cancel, milestones, `createContractPayment` / `processContractPayment` / `releasePayment`, check-in/out (**GPS**), dispute/review/guarantee, invoices | Many confirm dialogs; camera for evidence |
| Order dispute / no-show / review sheets | `MyOrdersView.swift` | Orders rows | Yes | `fileOrderDispute`, `reportOrderNoShow`, `createListingOrderReview`; pay `payOrder` | Pay labeled “Pay with Apple Pay” |
| Lower service bid sheet | `MyBidsView.swift` | My bids | Yes | `updateJobBid` | |
| Property add/edit sheets + detail | `PropertiesView.swift`, `PropertyDetailView.swift` | `account.row.properties` | Yes | `fetchProperties`, create/update/delete; spend/preferred providers/contracts/jobs | |
| Provider detail | `ProviderDetailView.swift` | Providers / Following | Follow/block need auth | `fetchProvider`, follow/unfollow, `blockUser`, `reportUser` | |
| User reviews | `UserReviewsView.swift` | Provider detail | Respond/flag auth | Reviews APIs | |
| Employee create sheet | `EmployeesView.swift` | Team | Provider | `createEmployee` | |
| Quote template create sheet | `QuoteTemplatesView.swift` | Quote templates | Provider | `createQuoteTemplate` | |
| Verification document upload sheet | `VerificationDocumentsView.swift` | Docs row | Provider | Upload + camera/PDF | |
| NPS survey sheet | `NPSSurveysView.swift` | Feedback | Yes | `submitNPS` | |
| Payment method remove confirm + biometric | `PaymentMethodsView.swift` | Payment methods | Yes | `deletePaymentMethod` + Face ID | `paymentMethods.root` |
| Stripe Connect Safari | `SellerPayoutsView.swift` | Seller payouts | Yes | `fetchStripeOnboardingLink` | `sellerPayouts.root` |
| Business hub children | `BusinessFeaturesHubView.swift` | `businessHub.root` | Yes | See 2026-08-21 nested table | `businessHub.root`, `business.row.invoices`, `business.row.insuranceQuote`, `insurance.quote.*`, `provider.invoices.root` |

---

## 8. Admin console sections

Entry: Account `account.row.admin` → `AdminConsoleView` (`ParitySurfacesView.swift`) when `fetchMe().hasAdminRole`. Root ids: `admin.console.root`, `admin.console.tabs`, `admin.console.tabs.menu`, `admin.console.tabs.sheet`, `admin.console.tab.{slug}`, `admin.{slug}.root`.

| Section (menu label) | slug / root id | File | Primary APIs (representative) |
|---|---|---|---|
| Flags | `flags` | `ParitySurfacesView` | `fetchAdminFlags`, `updateAdminFlag` (+ rollout %) |
| Jobs | `jobs` | `AdminOpsViews.swift` `AdminJobsOpsView` | `fetchAdminJobs`, suspend/remove |
| Listings | `listings` | `AdminListingsOpsView` | suspend/reactivate/cancel |
| Disputes | `disputes` | console | `fetchAdminDisputes`, `resolveAdminDispute` |
| Goods disputes | `goods-disputes` | `AdminGoodsDisputesOpsView` | resolve + refund/transfer |
| Guarantee | `guarantee` | `AdminModerationOpsViews.swift` | review claims / payout |
| Verify | `verify` | `AdminVerificationOpsView` | approve/reject docs |
| Licenses | `licenses` | `AdminLicensesOpsView` | verify/reject |
| Insurance | `insurance` | `AdminInsuranceOpsView` | review claims |
| Reviews | `reviews` | `AdminFlaggedReviewsOpsView` | uphold/dismiss/remove |
| Users | `users` | console | suspend/ban/reactivate/`finalizeAdminUserDeletion` |
| Goods (reports) | `goods` | console | `resolveAdminGoodsReport` |
| Jobs reports | `jobs-reports` | console | `resolveAdminJobReport` |
| Users reports | `users-reports` | console | `resolveAdminUserReport` |
| Fraud | `fraud` | console | `fetchAdminFraudAlerts`, `reviewAdminFraudAlert` |
| Advances | `advances` | console | review/disburse |
| Fees | `fees` | `AdminFeesView` | platform fee config |
| Banking | `banking` | `AdminBankingView` | platform bank token |
| Platform | `platform` | `AdminPlatformMetricsView` | metrics |
| Markets | `markets` | `AdminMarketsOpsView` | toggle markets |
| Taxonomy | `taxonomy` | `AdminTaxonomyOpsView` | questions CRUD |
| Insurers | `insurers` | `AdminInsurersOpsView` | approve/suspend/create |
| Challenges | `challenges` | `AdminChallengesOpsView` | create challenges |

Action sheets: flag reason, fraud review, dispute resolve, user action, section picker. Per-row ids like `admin.flag.toggle.{key}`, `admin.user.ban.{id}`, etc.

---

## 9. Deep links

Scheme **`nomarkup://`** (also `http`/`https` path). Parser: `Core/DeepLinkRouter.swift`. Push leftover: `NotificationDeepLink` in `NotificationsView.swift`.

| URL / path | Route | UI |
|---|---|---|
| `/bids`, `/my-bids` | `.bids` | Sheet `MyBidsView` (Account tab selected) |
| `/watchlist` | `.watchlist` | Sheet `WatchlistView` |
| `/messages`, `/chat`, `/channels` | `.messages` | **Switch Messages tab** (no sheet) |
| `/notifications` | `.notifications` | Sheet `NotificationsView` |
| `/account`, `/me`, `/profile` | `.account` | Switch Account tab |
| `/post-job`, `/jobs/new` | `.postJob` | Sheet `PostJobView` (Jobs tab) |
| `/jobs` | `.jobsBrowse` | Switch Jobs tab |
| `/jobs/{uuid}` | `.job` | Sheet `JobDetailView` |
| `/jobs?q=` | `.catalogSearch(.jobs)` | Jobs tab + search field |
| `/listings/{id}`, `/marketplace/listings/{id}`, `/auctions/{id}` | `.listing` | Sheet `ListingDetailView` |
| `/marketplace?q=` | `.catalogSearch(.marketplace)` | Marketplace tab + search |
| `/orders`, `/orders/{id}` | `.orders` | Sheet `MyOrdersView` (no order-detail init) |
| `/contracts/{id}` | `.contract` | Sheet `ContractDetailView` |
| `/check-in`, `/check-in/{contractId}` | `.checkIn` | Contracts list or `ContractDetailView(autoCheckInOnAppear:)` |
| `nomarkup://stripe-redirect` | ignored (`nil`) | Stripe return URL only |
| `nomarkup://oauth2redirect/facebook` | OAuth, not a product dest | Facebook session |

Rejected schemes: `javascript:`, `file:`, `data:`.

---

## 10. App Intents, Shortcuts, widgets, Live Activities

### App Intents (`ios/NoMarkup/Intents/`)

All production `perform()` paths **require a stored session** (`IntentAuthGuard`) except they open the app; signed-out Siri gets sign-in error (iOS 18 `UserActionRequired.signin`).

| Intent | File | Opens | Session |
|---|---|---|---|
| `OpenMyBidsIntent` | `OpenMyBidsIntent.swift` | `.bids` | Required; returns active bid count from widget snapshot |
| `OpenWatchlistIntent` | `OpenWatchlistIntent.swift` | `.watchlist` | Required |
| `OpenPostJobIntent` | `OpenPostJobIntent.swift` | `.postJob` | Required |
| `CheckInToJobIntent` | `CheckInToJobIntent.swift` | `.checkIn(contractID:)` — **does not POST** in production | Required; GPS POST only if test injects `checkInAPI` |
| `SearchCatalogIntent` | `SearchNoMarkupIntent.swift` | `.catalogSearch` marketplace (or jobs) | Required |
| `SearchNoMarkupIntent` (iOS 18 `system.search`) | same | Same | Required |
| `OpenListingIntent` | `ListingVisualIntelligence.swift` | `.listing(id:)` | Required |
| Visual Intelligence semantic search | same, `#if canImport(VisualIntelligence)`, iOS 26 device | Listing entities from snapshot | Device-only framework |

Entities: `JobEntity`, `ListingEntity`, `ContractEntity`. Shortcuts phrases: `NoMarkupAppShortcuts.swift` (My Bids, Watchlist, Check In, Post Job, Search).

### Widget extension (`ios/NoMarkupWidget/`)

| Surface | File | Families | Tap URL |
|---|---|---|---|
| Active Bids | `ActiveBidsWidget.swift` | small, medium, accessory rectangular/circular | `nomarkup://bids` |
| Next Closing | `NextClosingWidget.swift` + `NextClosingConfigurationIntent` | small, medium, accessory rectangular | `nomarkup://job/{id}` or `listing/{id}` or `bids` |
| Auction Live Activity | `AuctionLiveActivityWidget.swift` | Lock Screen + Dynamic Island | `nomarkup://{job\|listing}/{auctionID}` |
| Control: Post a Job (iOS 18) | `NoMarkupWidgetBundle.swift` `PostJobControlWidget` | Control Center / Lock Screen | `nomarkup://post-job` via `OpenURLIntent` |
| Control: Check In (iOS 18) | `CheckInControlWidget` | same | `nomarkup://check-in` |

Live Activities started from bid paths (`AuctionLiveActivityController`). Account row `account.row.widgets` is **copy only**, not a destination.

---

## 11. Permission-gated surfaces

Info.plist: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`. **No** microphone / tracking. Apple Pay merchant `merchant.com.nomarkup.app`. `NSSupportsLiveActivities = true`.

| Permission | Where it is requested / used | Notes |
|---|---|---|
| **Camera** | `CameraImagePicker` + `PhotosPicker`: Post job / Create listing (`ImageUploader` photo row); Profile avatar; Verification documents; Chat thread; Contract evidence / check-in photos | Pre-flight `AVCaptureDevice`; denied → Settings alert. Simulator: camera source often unavailable (control disabled). |
| **Photo library** | Same upload sites | Purpose string covers profile, portfolio, jobs, listings, claims. |
| **Location (When In Use)** | `JobsMapView` / `MarketplaceMapView` (`MapLocationManager.requestWhenInUseAuthorization` after in-app pre-prompt); `JobSiteLocationProvider` on **contract check-in/out**; CheckIn intent test path only | Combined purpose string (market nearby + job-site). Markets list itself is **not** GPS — city catalog. Jobs browse shows market-picker copy in empty drain. |
| **Notifications** | Not on login. Pre-prompt then `UNUserNotificationCenter`; Account “Turn on push”; value moments (watch/bid) | `PushRegistration`. Account can open iOS Settings if denied. |
| **Face ID / device biometrics** | Optional app lock overlay; Account deletion submit; remove payment method; Security toggle; Passkeys (system) | `NSFaceIDUsageDescription`. Simulator: no Face ID hardware (`DeviceCapabilityUITests.testFaceIDHardwareRequiresPhysicalDevice`). |
| **Apple Pay** | Stripe PaymentSheet (`RailACheckout`): listing bid bond / buy now / promote; orders pay; contract escrow / recurring; payment-method SetupIntent | Simulator cannot present Wallet sheet (`testApplePayRequiresPhysicalDevice` skips). Merchant id shown on Account wiring. |
| **Sign in with Apple** | Login (hidden under `-ui-testing`) | Entitlement `com.apple.developer.applesignin`. |

---

## 12. Workflow list (user-reachable)

### Auth
Cold launch → Login → email/password (or SIWA / Google / Facebook / passkey) → optional MFA → tab shell. Register (role Customer/Provider/Both) → optional passkey offer → onboarding sheet. Forgot password request + token form. Scaffold browse (DEBUG). Sign out confirm. Age gate DOB. Biometric lock when enabled.

### Browse jobs
Home `home.browseJobs` or Jobs tab → browse segment → search / filters / map → job detail → spectate / replay / similar → (provider) place/lower bid UI → (customer) award / instant match / close / message.

### Browse marketplace
Home `home.shopGoods` or Marketplace tab → search / autocomplete / map → listing detail → watch → bid UI / buy now / offers → spectate / replay.

### Bid
**Services:** Job detail `placeJobBid` / `updateJobBid` / withdraw; My bids services tab. **Goods:** Listing `placeListingBid` (+ bond), retract; My bids goods tab; Positions blotter (read). Watchlist / saved searches as alerts. Widgets/Live Activities reflect active bids.

### Message
Messages tab → thread → send text / camera / library / PDF → search in thread → share contact / propose terms / accept-reject / block / report. Channel created from awarded job (`createChatChannel`).

### Account destinations
Every `account.row.*` in the 2026-08-21 table + `account.row.requestLog`. Public without auth: Providers, Markets, Fair price, Marketplace map, Trust tiers, legal Safari, Plan limits, Feature flags.

### Admin console sections
Flags, Jobs, Listings, Disputes, Goods disputes, Guarantee, Verify, Licenses, Insurance, Reviews, Users, Goods reports, Jobs reports, Users reports, Fraud, Advances, Fees, Banking, Platform, Markets, Taxonomy, Insurers, Challenges.

### Provider money
Instant offers accept/decline; Seller payouts (Stripe Connect); Business hub (expenses/invoices/tax live; BNPL/insurance/advances/instant payout **hard-off**); Payment methods; Payments history; Sales CSV; Contracts escrow pay/release; Recurring first-visit pay. Apple Pay / Stripe escrow — not IAP (IAP only Plan limits when `storeKitEnabled`).

---

## 13. XCUITest method map vs screens

Sources: `ios/NoMarkupUITests/ScreenshotWalkUITests.swift`, `NoMarkupUITests.swift`, `TabAuditUITests.swift`, `DeviceCapabilityUITests.swift`.

| Test method | What it actually opens | Depth |
|---|---|---|
| **ScreenshotWalk `test01CustomerCoreWalk`** | Login form; Home hero/desk/stats; Marketplace settle + first listing (watch toggle, bid **UI no submit**); Jobs browse + first job detail; Messages list + first thread + composer focus | Catalog **smoke** |
| **`test02CustomerAccountWalk`** | Account hub + labeled destinations (see 2026-08-21); export; sign-out **dialog not confirmed**; notif prefs; post-job **form no submit**; inner workflows (profile save, plan limits, payment methods load, list hubs, delete **open only**) | Account **open** |
| **`test03ProviderWalk`** | Provider Account money/OS rows; Marketplace listing; Jobs bid UI; Messages; provider2 empties | Provider **open** |
| **`test04FreshCustomerStatesWalk`** | customer2 Messages empty; My bids / Orders / Watchlist / Properties empty | Empty states |
| **`test05AdminSessionWalk`** | Admin Home + Account; Feature flags; Admin console section menu: Disputes, Users, Fraud, Jobs, Fees, Banking, Markets, Platform, Advances, Taxonomy, Insurers, Challenges, Verify, Licenses, Insurance, Reviews | Admin **open**, no mutations asserted |
| **`test06CustomerAccountRowIDSweep`** | Every `allAccountNavigationRowIDs` except admin (assert absent); legal Safari; request log | Hub coverage |
| **`test09AccountRowTapSmoke`** | profile, security, paymentMethods, orders, planLimits, requestLog | Smoke |
| **`test07ProviderMoneyHubWalk`** | Instant offers / payouts / business hub **critical roots** + full row sweep | Provider money **open** |
| **`test08AdminAccountAndConsole`** | Admin console + Flags/Disputes/Users/Fraud/Jobs/Fees/Banking + full row sweep | Admin + catalog |
| **NoMarkupUITests `testColdLaunchShowsLoginOrTabs`** | Login **or** tabs | Launch |
| **`testLoginWithEnvCredentials`** | Auto-login env | Auth |
| **`testSignedInTabNavigation`** | Tab bar cycle | Shell |
| **`testHomeHeroAndMarketDesk`** | Home ids | Home |
| **`testJobsBrowseSettles`** | Jobs list/empty/error | Jobs |
| **`testAccountHubLinks`** | A few Account labels | Account |
| **`testAccountCriticalMoneyRows`** | Payment methods / payouts-ish | Money |
| **`testMarketplaceOpenFirstListing`** | First listing | Marketplace |
| **`testRoleShellCustomer/Provider/Admin`** | Tab shell | Shell |
| **`testCatalogAllPersonasRequestLogAndRows`** | Four personas + request log + admin row presence | Persona |
| **TabAudit `testTabsCustomerAndProviderAudit`** | Home / Marketplace+listing+watch / Jobs / Messages / Account wiring for customer **and** provider | Tab audit |
| **DeviceCapability `testApplePayRequiresPhysicalDevice`** | Orders Apple Pay control | **Sim skip** |
| **`testAPNsDeviceTokenRequiresPhysicalDevice`** | Push | **Sim skip** |
| **`testFaceIDHardwareRequiresPhysicalDevice`** | Face ID | **Sim skip** |
| **`testAccessibilityAuditLoginScreen`** | Login AX | Login |
| **`testAccessibilityAuditHomeAndAccountIfSignedIn`** | Home + Account AX | Partial |

Walk **does not** submit money, confirm Delete Account, confirm Sign out as a product dest (harness `signOutIfNeeded` does confirm to reset session), grant camera/location, or drive Siri/widgets.

### Coverage vs inventory — untested or screenshot-only

| Surface | XCUITest status |
|---|---|
| Register / Forgot password / MFA / SIWA / Google / Facebook / passkey login | **Untested** (SIWA hidden in UITest) |
| DEBUG scaffold browse | **Untested** |
| Age gate submit | Helper `completeAgeGateIfPresent` only |
| Biometric lock overlay | **Untested** |
| Home Post job / Instant match / Sell **sheets** | CTAs asserted; sheets **not** walked from Home (Post job walked from Account, no submit) |
| Jobs **Mine** segment | **Untested** |
| Jobs filters bar | **Untested** |
| Jobs map (`jobs.map`) | **Untested** |
| Marketplace search / autocomplete | **Untested** |
| Marketplace map from tab | Account map row is opened in sweep; tab toolbar map **not** specifically |
| Listing: submit bid, buy now, bond, offers, promote, report, spectate, replay, cancel | Bid **UI screenshot only** |
| Job: submit bid, award, close, cancel, instant match, spectate, replay, report, start chat | Bid **UI screenshot only** |
| Messages: camera, file, share contact, terms, block, report, inbox search | List + thread + composer **focus only** |
| Contract **detail** (pay, check-in GPS, dispute, evidence) | Contracts **list** only |
| Orders pay / dispute / pickup / review | Orders **list** only |
| Finish setup / Onboarding wizard | **Not** in test02 (called out in 2026-08-21) |
| Provider workspace **saves** (availability, licenses, portfolio) | Open/scroll only |
| Instant offer accept/decline | Open only |
| Camera / location system sheets | Denied/skipped by interruption monitor |
| Apple Pay PaymentSheet | Device-only; sim skip |
| Widgets, Live Activities, Control Center, App Intents, Visual Intelligence | **No XCUITest** (unit tests for deep-link parse / widget store exist under `NoMarkupTests`) |
| Admin **mutations** (ban, flag toggle persist, refund) | Open sections; not a mutation gate |
| Hard-off rails (BNPL, insurance purchase, advances, instant payout, legal services) | Rows expected hidden / static “not in this build” |

---

## 14. Seed accounts (same as Account audit)

| Email | Password | Extra |
|---|---|---|
| `customer@nomarkup.com` | `Password123!` | Full signed-in catalog; **no** Admin |
| `provider@nomarkup.com` | same | Workspace / instant offers / payouts populated |
| `admin@nomarkup.com` | same | + Admin console |
| `provider2@` / `customer2@` | same | Empty / sparse (`test03` / `test04`) |

Harness: `NOMARKUP_UI_TEST_*` env; walk uses **real login UI** (no app auto-login). Target card: [`00-target-card.md`](00-target-card.md).
