# Engineering residuals close — 2026-08-22

Not founder, not physical-device Enable UI Automation. No commit. No capture of escrow funds.

| Method / probe | Result | Time |
|----------------|--------|------|
| `testPreviouslySkippedAccountRows` | **PASS** | 399.8 s |
| `testJobAndListingReportAndReplay` | **PASS** | 175.6 s |
| `testMessagesSearchAndActionsMenu` | **PASS** | 53.5 s |
| `testOnboardingFinishSetupOpenCancel` | **PASS** | 34.4 s |
| `testLoginLegalLinksDismissSafari` | **PASS** | 61.4 s |
| `testJobsMapMyLocationGranted` | **PASS** | 42.4 s |
| `testProfilePhotoLibraryPicker` | **PASS** | 90.2 s |
| `testOrdersPayChromeCancel` | **PASS** | 94.7 s |
| Job bid + withdraw | **PASS** | `11-bid-withdraw.md` |
| Widget/intent/deep-link units | **75/75 PASS** | `12-widget-intents.md` |

### Close-everything-else (same day)

| Method / probe | Result | Time |
|----------------|--------|------|
| `testDebugScaffoldBrowse` | **PASS** | 72.0 s |
| `testMarketplaceAutocompleteSuggestions` | **PASS** | 35.3 s |
| `testListingBuyNowChrome` | **PASS** | 106.3 s |
| `testJobAskQuestionChrome` | **PASS** | 91.2 s |
| `testContractDetailChrome` | **PASS** | 173.3 s |
| `testSecurityBiometricToggle` | **PASS** | 84.6 s |
| `testOrdersPickupConfirmCancel` | **PASS** | 99.4 s |
| `simctl push` | **PASS** | `14-simctl-push.md` |
| Simulator Face ID enroll | **PASS** (mock) | `15-sim-faceid.md` |

Left to humans only: DEPLOY / live Stripe / DNS / ASC; physical Apple Pay Wallet / real APNs token / physical Face ID; camera **source**; escrow **capture**.
