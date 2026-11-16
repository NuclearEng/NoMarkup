# ASC age rating & content rights — ready-to-enter answers

**As of:** 2026-08-02  
**Product:** NoMarkup iOS (`com.nomarkup.app`) — local UGC marketplace (jobs + goods)  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §5 · App Store Connect → App Information / Age Rating

**Claim discipline:** Final badge is **computed by Apple** from questionnaire answers. Enter **honestly**. Do not sandbag UGC. Product enforces **18+** (`AgeGateView`); that does **not** mean “Ages 4+” in ASC.

---

## 1. Content rights

| ASC question (paraphrase) | Answer | Notes for founder |
|---------------------------|--------|-------------------|
| Do you have all necessary rights to the content in this app? | **Yes** | Own brand/assets; UGC is user-provided under Terms + Community Guidelines |
| Does the app contain third-party content? | **Yes** (user-generated) | Jobs, listings, photos, chat, reviews from users |
| Does the app contain, show, or access third-party content that may be considered objectionable? | **Possible via UGC** | Mitigation: report/block, content filter, admin queues, Community Guidelines |
| Copyright | **© 2026 NoMarkup** (or legal entity name) | Update entity if different |

---

## 2. Age rating questionnaire — draft answers

Complete the ASC Age Rating form with these values. Adjust only if live catalog taxonomy changes (e.g. weapons goods listed).

| Topic | Draft answer | Rationale |
|-------|--------------|-----------|
| **Unrestricted Web Access** | **No** | App does not embed a general browser. `SFSafariViewController` opens fixed legal/support (and occasional “view on web”) URLs only. |
| **User-Generated Content** | **Yes** | Jobs, listings, photos, profiles, reviews, chat |
| **Messaging and Chat** | **Yes** | In-app channels/messages; report/block available |
| **Advertising** | **None** | No ad SDK / no in-app ads surface |
| **Profanity or Crude Humor** | **Infrequent/Mild** | UGC chat/listings may include mild language; moderation exists |
| **Mature/Suggestive Themes** | **None** (or **Infrequent/Mild** if taxonomy allows adult-adjacent services) | Prefer honesty if category list could include such services |
| **Horror / Fear Themes** | **None** | Not product content |
| **Cartoon or Fantasy Violence** | **None** | — |
| **Realistic Violence** | **None** | — |
| **Guns or Other Weapons** | **None** as designed content | If live goods taxonomy lists weapons, answer from catalog truth |
| **Medical or Treatment Information** | **None** as core feature | Not a medical app |
| **Alcohol, Tobacco, or Drugs** | **None** unless verticals list them | Answer from live taxonomy |
| **Simulated Gambling** | **None** | Auctions are **commerce**, not casino gambling — **do not** label as gambling |
| **Contests** | **None** | No prize contests / sweepstakes as product feature |
| **Gambling (real money)** | **No** | Marketplace bids are purchase offers, not wagers |
| **Parental Controls** | N/A Kids | **Not** Kids Category; platform **18+** age gate |
| **Age Assurance / Kids** | **Not a Kids app** | No COPPA child-directed design |

### 2.1 Expected ASC outcome (not guaranteed)

Honest UGC + messaging answers typically yield a **teen / mature** computed rating (often **17+** class in modern questionnaires), **not** 4+. That is correct for this product. Do not fight the calculator by lying about UGC.

---

## 3. App Information extras (related)

| Field | Value |
|-------|--------|
| **Primary category** | Shopping |
| **Secondary category** | Lifestyle |
| **Age gate in product** | 18+ DOB verification |
| **Kids Category** | **Do not enroll** |

---

## 4. Founder checklist

- [ ] Open ASC → App → App Information / Age Rating  
- [ ] Enter §2 table answers  
- [ ] Save; note computed rating  
- [ ] Content rights §1 = Yes (own rights + UGC licensed by users)  
- [ ] Confirm review notes still say 18+ platform gate ([`app-review-notes.md`](./app-review-notes.md))

---

*Owner: App Store packaging. Revisit if goods taxonomy adds weapons/alcohol or if unrestricted browsing is added.*
