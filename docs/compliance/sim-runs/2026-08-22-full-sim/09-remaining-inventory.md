# Remaining inventory — 2026-08-22 full-sim (`09`)

Diff of [`00-inventory.md`](00-inventory.md) §13 “untested or screenshot-only” against:

1. **XCTest-green this run** — [`06b-uitest-nomarkup.md`](06b-uitest-nomarkup.md) (11/12 `NoMarkupUITests` + TabAudit **PASS**; catalog **FAIL** harness) and [`06c-coverage.md`](06c-coverage.md) (register / forgot / jobs map+filters / bid chrome **PASS**).
2. **In-tree, not XCTest-green this run** — `ios/NoMarkupUITests/NoMarkupUITests.swift` methods added after 06c: `testWrongPasswordShowsError`, `testJobsMineSegment`, `testMarketplaceSearchAndMap`, `testHomePostJobAndSellSheets`. No xcresult / shots under this folder for those four.
3. **LCD / ScreenshotWalk this folder** — visual Jobs Mine + Account lists ([`02-ui.md`](02-ui.md)); ScreenshotWalk `test03`/`test04`/`test05`/`test07`/`test08` shots exist; `test01` ended on SpringBoard (`test01-FAIL-after.png`) after composer shots; `test06`/`test09` **PASS** earlier (03-workflows / 00-target-card), not re-run here.

**No commit. No money submit. No seed mutation.**

Honesty rules used in the Residual column:

| Token | Meaning |
|-------|---------|
| **sim N/A** | Simulator cannot present the sheet / hardware (Apple Pay Wallet, APNs token, Face ID enroll, camera source). |
| **still missing** | User-reachable on this sim + live API; no XCUITest (or only a helper / screenshot) that opens it. |
| **founder** | Not a sim gate: seed policy, money-not-submitted-by-design, admin mutations, hard-off rails, DEBUG-only. |
| **device** | Needs a physical iPhone (PassKit, APNs, LAContext hardware, Visual Intelligence). |
| **in-tree unproven** | Method exists; this run did not execute it. |

---

## §13 close table

| Surface | Now covered by | Residual |
|---------|----------------|----------|
| Register (open form) | **06c PASS** `testRegisterScreenOpens` — Create account form; **did not tap submit** | **founder** — no new seed account |
| Forgot password (open form) | **06c PASS** `testForgotPasswordScreenOpens` — Reset email chrome; **did not tap Send** | **founder** — no reset mail |
| Wrong-password error | **in-tree** `testWrongPasswordShowsError` (WF-NEG.2-adjacent) | **in-tree unproven** this run |
| MFA challenge | IDs added this closer: `login.mfa` / `login.mfaSubmit`. Seed logins have `mfa_required` absent (03-workflows) | **founder** (enroll MFA on a seed) + **still missing** XCUITest |
| SIWA / Google / Facebook / passkey login | Hidden under `-ui-testing` (`LoginView.hideExternalAuth`). IDs: `login.passkey`, `login.facebook`; SIWA/Google label-only | **sim N/A** / **device** (Apple ID, OAuth, Keychain). **founder** not to drive live OAuth in UITest |
| Login legal Privacy / Terms | IDs added: `login.privacy` / `login.terms`. Account legal Safari already in test06 sweep | **still missing** dedicated login-footer tap (Safari can background the app — `test01-FAIL-after`) |
| DEBUG scaffold browse | Still unlabeled besides hint; `#if DEBUG` only | **founder** (DEBUG-only) + **still missing** |
| Age gate submit | Helper `completeAgeGateIfPresent` only; seed already 18+ | **founder** (seed verified) + **still missing** dedicated under-18 path |
| Biometric lock overlay | `lock.overlay` / `lock.unlock` exist; `testFaceIDHardwareRequiresPhysicalDevice` **sim skip** | **sim N/A** / **device** — Face ID enroll |
| Home Post a job / Sell sheets | **in-tree** `testHomePostJobAndSellSheets` (open, never publish). Account Post job already open-only (test02 / testAccountHubLinks). LCD Continue pin in 02-ui | **in-tree unproven** this run. Publish = **founder** |
| Home Instant match sheet | CTA `home.instantMatch` asserted in Home smoke; sheet **not** opened (Post job test does not set `preferInstantMatch`) | **still missing** |
| Jobs Mine segment | **in-tree** `testJobsMineSegment`. LCD **PASS** `32-jobs-mine.png` / `81-jobs-mine.png` (02-ui) | **in-tree unproven** XCTest this run; visual already green |
| Jobs filters bar | **06c PASS** `testJobsMapAndFilters` — Category / schedule / min bid / Apply | none (Apply not persisted as a catalog mutation) |
| Jobs map (`jobs.map`) | **06c PASS** — MapKit + pin; location pre-prompt dismissed | **sim N/A** — real GPS grant / “My location” |
| Marketplace search / autocomplete | **in-tree** `testMarketplaceSearchAndMap` types `Makita` then clears | **in-tree unproven**; autocomplete suggestions **still missing** as a dedicated assert |
| Marketplace map from tab | **in-tree** same method (`marketplace.map` toolbar). Account map row already in test06 sweep | **in-tree unproven**; location grant **sim N/A** |
| Listing bid **chrome** / watch / spectate | **06c PASS** `testListingDetailWatchAndBidChrome` + TabAudit + 06b first listing. Watch add→remove. Spectate opened | Bid **submit** = **founder** (money-not-submitted) |
| Listing: buy now / bid-bond / promote | PaymentSheet + Apple Pay. `testApplePayRequiresPhysicalDevice` **sim skip** | **sim N/A** / **device** |
| Listing: offers / report / replay / cancel | Spectate covered. Replay id `auctionReplay.listing` unused in UITest. Report / offers / cancel never opened | **still missing** (replay/report); cancel = **founder** (mutation) |
| Job bid **chrome** / spectate | **06c PASS** `testJobDetailPlaceBidChrome` (provider, “Review SaaS vendor contract”). Spectate LIVE | Bid **submit** = **founder** |
| Job: award / close / cancel / instant match / start chat | Confirm dialogs exist; not walked | **founder** (mutations) + **still missing** chat/report/replay chrome |
| Job: report / replay | IDs `jobDetail.report`, `jobDetail.replay` / `auctionReplay.job` — never tapped | **still missing** |
| Messages: list + thread + composer **focus** | test01 shots 10–12; 06c listing test peeks composer; TabAudit | Send = **founder**. Rest below |
| Messages: camera / file / share contact / terms / block / report / inbox search | Camera control grey on sim (02-ui). Composer never sent | Camera **sim N/A**. File / terms / block / report / search **still missing** |
| Contract **list** | test02 / test07 / 02-ui `64-contracts.png` | Detail below |
| Contract **detail** (pay, GPS check-in, dispute, evidence) | List only. No `ContractDetailView` a11y ids | Pay / evidence camera **sim N/A**. Check-in GPS **device**. Dispute **still missing** |
| Orders **list** | test02 / test07 / 02-ui (seller-pay copy FIXED) | Pay Apple Pay **sim N/A**. Dispute / pickup / review **still missing** |
| Finish setup / Onboarding wizard | Banner present (02-ui). `testAccountHubLinks` taps `account.finishSetup` if present and dismisses | **still missing** full wizard (OTP / role enable) |
| Provider workspace **saves** | test03 / test07 **open/scroll only** | **founder** (do not mutate licenses/portfolio) |
| Instant offer accept/decline | Open only (empty inbox on dual-role customer) | **founder** (would consume a live offer) |
| Camera / location **system** sheets | UIInterruptionMonitor dismisses; maps used default camera; “Not now” on location | **sim N/A** (grant) — denied by design in harness |
| Apple Pay PaymentSheet / escrow pay | DeviceCapability **sim skip**. Orders buyer CTA visible after SIM-UI.5 | **sim N/A** / **device** / **founder** (money) |
| APNs device token | `testAPNsDeviceTokenRequiresPhysicalDevice` **sim skip** | **sim N/A** / **device** |
| Face ID enroll | `testFaceIDHardwareRequiresPhysicalDevice` **sim skip**. Security toggle visible (02-ui Face ID off) | **sim N/A** / **device** |
| Widgets / Live Activities / Control Center / App Intents / Visual Intelligence | **No XCUITest**. Unit: `WidgetSharedStoreTests`, `NotificationDeepLinkTests`, `AppIntentsAuthGuardTests` | **sim N/A** for XCUITest of widgets/Siri; Visual Intelligence **device** |
| Admin **mutations** (ban, flag persist, refund) | test05 / test08 **open** console sections | **founder** — not a sim gate |
| Hard-off rails (BNPL, insurance purchase, advances, instant payout, legal services) | Catalog expected-hidden `legalServices` / `insuranceQuote` | **founder** — rows hidden / “not in this build” |
| 4-persona request-log catalog | 06b `testCatalogAllPersonasRequestLogAndRows` **FAIL** (lazy Account list / `requestLog` hittable) | **still missing** proof (harness, not a missing row) |

---

## Ranked residuals

### Fixable-now (sim-reachable; cheap XCUITest or already in-tree)

1. **Run the four in-tree methods** until XCTest-green: `testWrongPasswordShowsError`, `testJobsMineSegment`, `testMarketplaceSearchAndMap`, `testHomePostJobAndSellSheets`. Surfaces are written; this folder has no xcresult yet.
2. **Retry catalog request-log** after the 06b harness recovery (`scrollTo` maxSwipes + `popToRoot` stop on `account.row.profile`) — product rows exist.
3. **Home Instant match** — tap `home.instantMatch`, assert `postJob.wizardChrome` / matching copy, Close. Do not submit.
4. **Job / listing replay** — tap `jobDetail.replay` / `listingDetail.replay`, assert `auctionReplay.job` / `.listing`. Read-only.
5. **Job / listing report sheets** — open `jobDetail.report` (and listing toolbar), dismiss without submit.
6. **Login legal links** — tap `login.privacy` / `login.terms`, immediately dismiss Safari (do **not** leave the app; `test01-FAIL-after` is SpringBoard).
7. **Messages extras that are not camera**: inbox search, share-contact **confirm not tapped**, block/report **open-only**, propose-terms **open-only**.
8. **Onboarding / Finish setup** — open wizard from `account.finishSetup`, walk fields, Cancel. No OTP submit.
9. **Auction replay + listing offers chrome** if a seed listing exposes them.

Do **not** call these a sim gap once the in-tree four are green.

### Device (physical iPhone; sim skip is correct)

1. **Apple Pay sheet** / Stripe PaymentSheet — bid-bond, buy now, promote, orders pay, contract escrow. `testApplePayRequiresPhysicalDevice`.
2. **APNs device token** — `testAPNsDeviceTokenRequiresPhysicalDevice`. Simulator never registers a real token.
3. **Face ID enroll** / biometric app lock hardware — `testFaceIDHardwareRequiresPhysicalDevice`. Toggle chrome is already visible on sim.
4. **Camera source** — `UIImagePickerController` camera disabled (`isSourceTypeAvailable` false). Photo library can be granted via `simctl privacy` (already used in 02-ui).
5. **Contract GPS check-in/out** — `CLLocation` job-site; sim location can be spoofed but is not a product gate this run.
6. **Sign in with Apple / passkeys / Google / Facebook** — hidden in UITest; need real IdP + Keychain.
7. **Widgets / Live Activities / Control Center / Siri App Intents / Visual Intelligence** — no XCUITest host; unit tests only. Visual Intelligence is iOS 26 device framework.

### Founder (not a sim gate; do not file as XCUITest holes)

1. **Bid SUBMIT / escrow pay / Apple Pay capture** — suite policy: chrome only. HTTP bid empty-body 400 is already **PASS** in 03-workflows (SIM-WF.13).
2. **Register submit / forgot-password send** — would pollute seed / inbox.
3. **MFA enroll on a seed** — required before `login.mfa` can appear. Current seeds return JWT without `mfa_required`.
4. **Admin mutations** — ban / flag persist / refund. Console **open** is the sim gate (test05/test08).
5. **Provider workspace saves, instant-offer accept/decline, listing cancel, award/close/cancel job** — live seed mutation.
6. **Hard-off rails** — BNPL / insurance purchase / advances / instant payout / legal services. Expected hidden.
7. **DEBUG scaffold** — not a release surface.
8. **Age-gate under-18** — needs a dedicated unverified seed, not customer@.
9. **Catalog FAIL** — lazy-List harness after a long Account walk, not a missing `account.row.*`.

---

## a11y ids added this closer

Tiny diffs in `ios/NoMarkup/Auth/LoginView.swift` (no other product edits):

| ID | Control |
|----|---------|
| `login.mfa` | MFA `Authenticator code` field |
| `login.mfaSubmit` | “Verify authenticator code and sign in” |
| `login.privacy` | Footer Privacy `Link` |
| `login.terms` | Footer Terms `Link` |

MFA is still **untestable on current seeds**. Legal links are now labelable; tapping them in XCUITest is fixable-now with a Safari-dismiss, not a product hole.

---

## Not claimed PASS

- The four new methods at the bottom of `NoMarkupUITests.swift` are **coverage in source**, not XCTest-green in this sim-run folder.
- Bid / pay / Apple Pay / APNs / Face ID / widgets / admin writes remain **out of scope** for simulator UITest by design.
