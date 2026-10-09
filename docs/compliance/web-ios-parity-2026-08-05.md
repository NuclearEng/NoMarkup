# Web ↔ iOS feature parity — 2026-08-05 (final)

**Web:** live `http://127.0.0.1:3000`  
**iOS:** native SwiftUI admin + product surfaces  
**Gateway:** `http://127.0.0.1:8081`  

---

## Verification (orchestrator)

| Gate | Result |
|------|--------|
| iOS `xcodebuild` Debug sim | **BUILD SUCCEEDED** |
| Unit tests `NoMarkupTests` | **93/0 TEST SUCCEEDED** |
| Admin console tabs | **22 tabs** (full ops desk) |
| `APIClient+Admin` methods | **79** |
| Admin GET smoke (admin seed) | **16/17 × 200**; guarantee-claims **503** when `nomarkup_guarantee` off (fail-closed, expected) |
| Backend | **GET `/admin/category-questions`** added for list parity |

---

## Admin console — complete native coverage

Entry: **Account → Admin console** (`account.row.admin`, admin role only).

| Tab | Reads | Writes |
|-----|-------|--------|
| Flags | list | toggle enable, rollout % |
| Jobs | list | suspend, remove |
| Listings | list | suspend, reactivate, cancel |
| Disputes | list | resolve (service) |
| Goods disputes | list | resolve refund/release |
| Guarantee | list | approve/deny + payout cents |
| Verify | queue | approve/reject docs |
| Licenses | list | verify/reject |
| Insurance | claims | approve/deny |
| Reviews | flagged | uphold/dismiss, remove |
| Users | search | suspend, ban, reactivate, finalize-deletion |
| Goods / User reports | list | dismiss / actioned |
| Fraud | alerts | review (+ optional restrict/ban API) |
| Advances | list | approve/reject, **disburse** |
| Fees | fee-config + revenue + payments | update fee config |
| Banking | platform account | set (idempotent), delete |
| Platform | metrics, growth, subscriptions | read |
| Markets | catalog | activate/deactivate |
| Taxonomy | category questions | create/delete |
| Insurers | list | approve/suspend/create |
| Challenges | list | create |

### Backend change this wave

| Endpoint | Status |
|----------|--------|
| `GET /api/v1/admin/category-questions` | **Added** (optional `category_id`) |

All other admin routes already existed and smoke **200** (or intentional **503** behind money flags).

---

## Product surfaces (customer / provider) — prior waves retained

| Area | iOS |
|------|-----|
| Dual-rail jobs + marketplace | Full |
| Post job / sell wizards | 4-step each |
| Spectate + replay | Job + listing |
| Payments history / positions / fair price | Account |
| Marketplace map | Toolbar + Account |
| Recurring jobs desk | Account |
| Provider invoices | Business hub |
| Categories write + license submit | Workspace |
| BNPL / insurance quote / advances request | Business hub |

---

## Intentional platform differences (not product gaps)

| Web | iOS substitute |
|-----|----------------|
| ⌘K command palette | Spotlight + App Intents |
| PWA install / web push | App Store + APNs |
| Invoice WYSIWYG print studio | Share invoice HTML/document |
| 8-step provider onboarding single page | Wizard + workspace + Connect links |
| Goods event-stream replay | Ladder snapshot + job event replay |

---

## Score

| Slice | Status |
|-------|--------|
| Customer dual-rail product | **GREEN** |
| Provider tools + money rails | **GREEN** |
| Admin ops (all 34 write families + lists) | **GREEN** native desk |
| Marketing / PWA chrome | **N/A** (native platform) |

**Overall product+ops parity: GREEN** for anything a solo operator would use on phone or laptop.

### Dogfood (admin)

```
admin@nomarkup.com / Password123!
Account → Admin console → Fees / Banking / Jobs / Markets / Advances → Disburse
```

Enable `nomarkup_guarantee` flag to exercise Guarantee tab (else 503 empty-state by design).
