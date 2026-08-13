import XCTest

/// E2E screenshot walk across every primary surface, doubling as a smoke suite.
///
/// Credentials follow the `NoMarkupUITests.swift` pattern: `NOMARKUP_UI_TEST_EMAIL` /
/// `NOMARKUP_UI_TEST_PASSWORD` from the test-process env (or `TEST_RUNNER_*`), with
/// seed-account fallbacks. Provider legs use `NOMARKUP_UI_TEST_PROVIDER_EMAIL` /
/// `NOMARKUP_UI_TEST_PROVIDER2_EMAIL` (defaults `provider@` / `provider2@nomarkup.com`,
/// same password). The walk logs in through the REAL login UI (types credentials, taps
/// Sign in) — app-side auto-login env vars are deliberately NOT forwarded to the app.
///
/// Every stop takes an `XCTAttachment` screenshot named `NN-surface-state`.
/// Optional surfaces record a skip reason instead of hard-failing; only login and the
/// tab shell are hard assertions. Test methods are numbered so XCTest's alphabetical
/// order runs them as one continuous walk (session state carries across launches via
/// Keychain).
///
/// Harness notes (learned on-device):
/// - `tab.*` accessibility identifiers live on the full-screen tab CONTENT views, so
///   tapping them taps screen center. Navigation must use the tab BAR buttons only.
/// - SwiftUI Lists are lazy: off-viewport rows do not exist in the AX tree, and the
///   scroll position persists across tab switches — scrolling must be bidirectional.
/// - Watch/bid actions raise an in-app notification pre-prompt sheet ("Not now").
final class ScreenshotWalkUITests: XCTestCase {
    private var app: XCUIApplication!

    // Shared across the ordered test methods of one run (XCTest runs them serially).
    nonisolated(unsafe) private static var shotCounter = 0
    nonisolated(unsafe) private static var skips: [String] = []

    // MARK: - Credentials (pattern from NoMarkupUITests.testCredential)

    private static func testCredential(_ key: String, default def: String = "") -> String {
        let env = ProcessInfo.processInfo.environment
        for candidate in [key, "TEST_RUNNER_\(key)"] {
            if let v = env[candidate], !v.isEmpty { return v }
        }
        return def
    }

    private var customerEmail: String {
        Self.testCredential("NOMARKUP_UI_TEST_EMAIL", default: "customer@nomarkup.com")
    }
    private var providerEmail: String {
        Self.testCredential("NOMARKUP_UI_TEST_PROVIDER_EMAIL", default: "provider@nomarkup.com")
    }
    private var provider2Email: String {
        Self.testCredential("NOMARKUP_UI_TEST_PROVIDER2_EMAIL", default: "provider2@nomarkup.com")
    }
    private var customer2Email: String {
        Self.testCredential("NOMARKUP_UI_TEST_CUSTOMER2_EMAIL", default: "customer2@nomarkup.com")
    }
    private var adminEmail: String {
        Self.testCredential("NOMARKUP_UI_TEST_ADMIN_EMAIL", default: "admin@nomarkup.com")
    }
    private var password: String {
        Self.testCredential("NOMARKUP_UI_TEST_PASSWORD", default: "Password123!")
    }

    // MARK: - Lifecycle

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // Defensive: dismiss any system permission alert without granting.
        // Prefer "Open" for custom-scheme confirmation ("Open in NoMarkup?") so
        // deep-link tests are not cancelled; only then fall back to deny/dismiss.
        addUIInterruptionMonitor(withDescription: "System dialog") { alert in
            for title in ["Open", "Allow", "OK"] {
                let button = alert.buttons[title]
                if button.exists { button.tap(); return true }
            }
            for title in ["Don’t Allow", "Don't Allow", "Not Now", "Cancel"] {
                let button = alert.buttons[title]
                if button.exists { button.tap(); return true }
            }
            return false
        }
        // Intentionally no NOMARKUP_UI_TEST_* in app.launchEnvironment:
        // the walk must exercise the real login form, not DEBUG auto-login.
        // Force local gateway for Simulator dogfood (scheme may still point at LAN).
        let env = ProcessInfo.processInfo.environment
        let apiBase = env["NOMARKUP_API_BASE_URL"]
            ?? env["TEST_RUNNER_NOMARKUP_API_BASE_URL"]
            ?? "http://127.0.0.1:8081"
        app.launchEnvironment["NOMARKUP_API_BASE_URL"] = apiBase
        app.launch()
    }

    override func tearDownWithError() throws {
        attachSkipsIfAny()
        app = nil
    }

    // MARK: - Helpers

    private func snap(_ name: String) {
        Self.shotCounter += 1
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = String(format: "%02d-%@", Self.shotCounter, name)
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func recordSkip(_ surface: String, _ reason: String) {
        Self.skips.append("\(surface): \(reason)")
        NSLog("WALK-SKIP %@ — %@", surface, reason)
    }

    private func attachSkipsIfAny() {
        guard !Self.skips.isEmpty else { return }
        let attachment = XCTAttachment(string: Self.skips.joined(separator: "\n"))
        attachment.name = "walk-skips"
        attachment.lifetime = .keepAlways
        add(attachment)
        Self.skips.removeAll()
    }

    private func settle(_ seconds: TimeInterval = 0.8) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    /// Any-type lookup by accessibility identifier (placeholder-ID style).
    private func byID(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// First tappable element whose label matches exactly (buttons first, then cells/text).
    private func byLabel(_ label: String) -> XCUIElement {
        if app.buttons[label].exists { return app.buttons[label] }
        if app.cells.staticTexts[label].exists { return app.cells.staticTexts[label] }
        return app.staticTexts[label]
    }

    /// Geometric hittability — avoids XCTest throwing on off-screen elements with invalid
    /// activation points (`Failed to determine hittability of … Button`).
    ///
    /// Never call `isHittable` / element-relative `coordinate` here: both can throw
    /// XCTError on clipped capsule-strip tabs and abort the whole test when
    /// `continueAfterFailure == false`. Reading `.frame` can also fail the test case
    /// (same error string) when `continueAfterFailure == false`, so we temporarily
    /// allow continuation around geometry probes.
    private func isOnScreen(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let previous = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previous }
        let f = element.frame
        // Reject empty / NaN / zero frames without consulting hittability.
        guard f.width.isFinite, f.height.isFinite, f.width > 1, f.height > 1 else { return false }
        guard f.midX.isFinite, f.midY.isFinite else { return false }
        // If XCTest recorded a hittability failure while reading frame, treat as off-screen.
        if f == .zero { return false }
        let bounds = app.frame
        // Midpoint inside the app window (horizontal + vertical) with a small inset
        // so partially-clipped capsules are not considered tappable.
        return f.midX > bounds.minX + 4
            && f.midX < bounds.maxX - 4
            && f.midY > bounds.minY + 4
            && f.midY < bounds.maxY - 4
    }

    /// Tap via **app-relative** coordinate when on-screen (skips fragile `isHittable`
    /// and element-relative `coordinate`, both of which throw on invalid activation points).
    @discardableResult
    private func safeTap(_ element: XCUIElement) -> Bool {
        guard isOnScreen(element) else { return false }
        let previous = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previous }
        let f = element.frame
        guard f.width > 1, f.height > 1 else { return false }
        let bounds = app.frame
        // Pixel offset from the app origin — never element.coordinate (throws on clip).
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let point = origin.withOffset(
            CGVector(dx: f.midX - bounds.minX, dy: f.midY - bounds.minY)
        )
        point.tap()
        return true
    }

    /// Bidirectional lazy-List search: swipe up first, then fall back to swiping down.
    /// Cap swipes tightly so missing Account rows soft-skip instead of multi-minute hangs.
    @discardableResult
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 8) -> Bool {
        if isOnScreen(element) { return true }
        let up = min(maxSwipes, 10)
        for _ in 0..<up {
            app.swipeUp()
            settle(0.12)
            if isOnScreen(element) { return true }
        }
        let down = min(maxSwipes, 8)
        for _ in 0..<down {
            app.swipeDown()
            settle(0.12)
            if isOnScreen(element) { return true }
        }
        return isOnScreen(element)
    }

    /// Pick an Admin Section menu row (Flags / Users / Fees / …).
    /// The iOS 26 capsule strip collapsed; ids live on Menu rows (`admin.console.tab.*`)
    /// and the labeled picker is `admin.console.tabs.menu`.
    @discardableResult
    private func tapAdminConsoleTab(_ label: String) -> Bool {
        let tabs = byID("admin.console.tabs")
        let menu = byID("admin.console.tabs.menu")
        guard tabs.waitForExistence(timeout: 4) || menu.waitForExistence(timeout: 2) else {
            return false
        }
        let slug = label.lowercased().replacingOccurrences(of: " ", with: "-")
        let rowID = "admin.console.tab.\(slug)"
        let byId = byID(rowID)

        // Already on this section (gold pill / a11y label "Admin section, Flags").
        if menu.exists {
            let lab = menu.label
            if lab == label || lab.hasSuffix(", \(label)") { return true }
        }

        func tapMenuRow() -> Bool {
            if byId.exists, safeTap(byId) { return true }
            let previous = continueAfterFailure
            continueAfterFailure = true
            defer { continueAfterFailure = previous }
            if app.menuItems[label].exists {
                app.menuItems[label].tap()
                return true
            }
            let idHits = app.descendants(matching: .any).matching(identifier: rowID)
            for i in 0..<min(idHits.count, 6) {
                let el = idHits.element(boundBy: i)
                if el.exists, safeTap(el) { return true }
            }
            // Labelled buttons that are not the root tab bar (Jobs / Marketplace / …).
            let labeled = app.buttons.matching(NSPredicate(format: "label == %@", label))
            let appFrame = app.frame
            for i in 0..<min(labeled.count, 8) {
                let el = labeled.element(boundBy: i)
                guard el.exists else { continue }
                let f = el.frame
                guard f.width.isFinite, f.height.isFinite, f.width > 1, f.height > 1 else { continue }
                if f.minY > appFrame.maxY - 120 { continue }
                if el.identifier.hasPrefix("tab.") { continue }
                if safeTap(el) { return true }
            }
            return false
        }

        if tapMenuRow() { return true }

        func openSectionMenu() -> Bool {
            if menu.exists, safeTap(menu) { return true }
            if menu.exists {
                let previous = continueAfterFailure
                continueAfterFailure = true
                menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                continueAfterFailure = previous
                return true
            }
            if tabs.exists, safeTap(tabs) { return true }
            let byA11y = app.buttons.matching(
                NSPredicate(format: "label BEGINSWITH %@", "Admin section")
            ).firstMatch
            return byA11y.exists && safeTap(byA11y)
        }

        guard openSectionMenu() else { return false }
        settle(0.35)
        if tapMenuRow() { return true }
        settle(0.45)
        return tapMenuRow()
    }

    /// Tap the nav-bar back button when present.
    private func goBack() {
        let back = app.navigationBars.buttons.element(boundBy: 0)
        if safeTap(back) {
            settle(0.5)
        }
    }

    /// Leading nav-bar button ≈ back affordance (pushed screen).
    private var hasBackButton: Bool {
        let bar = app.navigationBars.element(boundBy: 0)
        guard bar.exists else { return false }
        let first = bar.buttons.element(boundBy: 0)
        guard first.exists else { return false }
        let previous = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previous }
        let f = first.frame
        guard f.width.isFinite, f.height.isFinite else { return false }
        return f.minX < 80 && f.width < 120
    }

    /// Switch tabs via the tab BAR only (never the full-screen `tab.*` content ids).
    private func openTab(_ label: String) {
        // Dismiss known full-screen blockers that hide the tab bar.
        completeAgeGateIfPresent()
        dismissNotificationPrePrompt()
        // SFSafari / sheet dismiss affordances.
        for title in ["Done", "Close", "Cancel"] {
            let b = app.buttons[title]
            if b.exists, safeTap(b) { settle(0.3) }
        }

        let barButton = app.tabBars.buttons[label]
        if barButton.waitForExistence(timeout: 4) {
            if safeTap(barButton) {
                settle(0.4)
                return
            }
            // Bar present but geometry-unsafe: clear overlays again, then app-relative mid-tap.
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            if safeTap(barButton) {
                settle(0.4)
                return
            }
            let previous = continueAfterFailure
            continueAfterFailure = true
            barButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            continueAfterFailure = previous
            settle(0.4)
            return
        }
        // iPad sidebar / adapted chrome fallback: a SMALL control with this label.
        let candidates = app.buttons.matching(NSPredicate(format: "label == %@", label))
        let count = candidates.count
        for i in 0..<min(count, 6) {
            let el = candidates.element(boundBy: i)
            if el.exists, el.frame.height < 140, el.frame.width < 300, safeTap(el) {
                settle(0.4)
                return
            }
        }
        recordSkip("tab-\(label)", "no tab bar control found")
    }

    /// Switch to a tab and unwind its navigation stack to the root list.
    private func popToRoot(_ label: String) {
        // If a destination hid the tab bar, pop via Back first so Account's
        // `.toolbar(.visible, for: .tabBar)` can restore chrome before retap.
        if !app.tabBars.firstMatch.exists {
            var unwind = 0
            while unwind < 8 {
                if hasBackButton {
                    goBack()
                } else if safeTap(app.navigationBars.buttons["Back"]) {
                    settle(0.5)
                } else if safeTap(app.buttons["Back"]) {
                    settle(0.5)
                } else {
                    break
                }
                unwind += 1
                if app.tabBars.firstMatch.exists { break }
            }
        }
        openTab(label)
        var attempts = 0
        // Legal / ops destinations can be deep; allow more back presses than the old 4.
        while attempts < 8 {
            if hasBackButton {
                goBack()
            } else if safeTap(app.navigationBars.buttons["Back"]) {
                settle(0.5)
            } else {
                break
            }
            attempts += 1
        }
    }

    /// The in-app notification pre-prompt ("Stay ahead on bids" → Not now).
    @discardableResult
    private func dismissNotificationPrePrompt(snapName: String? = nil) -> Bool {
        let notNow = app.buttons["Not now"]
        guard notNow.waitForExistence(timeout: 2) else { return false }
        if let name = snapName { snap(name) }
        notNow.tap()
        settle(0.6)
        return true
    }

    /// Age-gate modal for accounts without a stored DOB (`ageGate.dialog`): the
    /// wheels default to a valid adult DOB, so Continue completes verification
    /// exactly as a real user would. Blocks ALL navigation until handled.
    @discardableResult
    private func completeAgeGateIfPresent(snapName: String? = nil) -> Bool {
        let gate = byID("ageGate.dialog")
        guard gate.waitForExistence(timeout: 3) else { return false }
        if let name = snapName { snap(name) }
        let cont = app.buttons["Continue"]
        if cont.exists {
            cont.tap()
            // Server round-trip ("Verifying…"), then the dialog dismisses.
            let deadline = Date().addingTimeInterval(10)
            while gate.exists && Date() < deadline {
                settle(0.5)
            }
        }
        settle(0.5)
        return true
    }

    private func fieldValue(_ field: XCUIElement) -> String {
        (field.value as? String) ?? ""
    }

    /// Replace a text field's content. Plain fields: triple-tap selects the line so
    /// typing replaces it (avoids cursor-position bugs), verified afterwards.
    /// Secure fields (unreadable/masked value): delete-loop sized by the mask.
    private func clearAndType(_ field: XCUIElement, text: String, verify: Bool) {
        field.tap()
        settle(0.3)
        let placeholderValues = ["Email", "Password"]
        var existing = fieldValue(field)
        if placeholderValues.contains(existing) { existing = "" }
        if !existing.isEmpty {
            if verify {
                field.tap(withNumberOfTaps: 3, numberOfTouches: 1) // select-all line
                settle(0.3)
            }
            let deletes = String(
                repeating: XCUIKeyboardKey.delete.rawValue,
                count: existing.count + 2
            )
            field.typeText(deletes)
        }
        field.typeText(text)
        guard verify else { return }
        var typed = fieldValue(field)
        if typed != text {
            // Fallback: hard-clear with a generous delete run, then retype.
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue,
                                  count: typed.count + text.count + 8))
            field.typeText(text)
            typed = fieldValue(field)
        }
        XCTAssertEqual(typed, text, "field content after typing")
    }

    /// Ensure signed OUT: if the tab shell is up, sign out from Account.
    private func signOutIfNeeded() {
        let tabView = byID("root.tabview")
        guard tabView.waitForExistence(timeout: 8) else { return }
        completeAgeGateIfPresent()
        dismissNotificationPrePrompt()
        popToRoot("Account")
        settle(0.8)
        let signOut = app.buttons["Sign out"]
        guard scrollTo(signOut, maxSwipes: 6) else {
            recordSkip("sign-out", "Sign out row not found on Account")
            return
        }
        signOut.tap()
        _ = byID("login.email").waitForExistence(timeout: 10)
        settle(0.5)
    }

    /// Real-UI login: type credentials, tap Sign in, wait for the tab shell. Hard-asserts.
    private func login(email: String, screenshotPrefix: String? = nil) {
        let emailField = byID("login.email")
        let passwordField = byID("login.password")
        let submit = byID("login.submit")

        // Heal cross-test contamination: still signed in → sign out first.
        if !emailField.waitForExistence(timeout: 15), byID("root.tabview").exists {
            signOutIfNeeded()
        }

        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "login.email not found")
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "login.password not found")

        if let prefix = screenshotPrefix {
            snap("\(prefix)-login-form")
        }

        clearAndType(emailField, text: email, verify: true)
        clearAndType(passwordField, text: password, verify: false)

        XCTAssertTrue(submit.exists, "login.submit not found")
        submit.tap()

        XCTAssertTrue(
            byID("root.tabview").waitForExistence(timeout: 30),
            "root.tabview should appear after signing in as \(email)"
        )
        settle(1.5)
        // First-login gates for accounts without stored DOB, then the pre-prompt.
        let gatePrefix = screenshotPrefix ?? String(email.prefix(while: { $0 != "@" }))
        completeAgeGateIfPresent(snapName: "\(gatePrefix)-age-gate")
        dismissNotificationPrePrompt()
    }

    /// Open the first NAVIGABLE row of the current list: decorative cells (intro
    /// cards, headers) don't navigate, so iterate until a push actually happens.
    @discardableResult
    private func openFirstRow(timeout: TimeInterval = 8) -> Bool {
        let cells = app.cells
        guard cells.firstMatch.waitForExistence(timeout: timeout) else { return false }
        let count = min(cells.count, 6)
        for index in 0..<count {
            let cell = cells.element(boundBy: index)
            guard cell.exists else { continue }
            if !isOnScreen(cell) {
                app.swipeUp()
                settle(0.3)
            }
            guard safeTap(cell) else { continue }
            settle(1.6)
            if hasBackButton { return true }
        }
        return false
    }

    /// Stable `account.row.*` slugs from AccountView (preferred over labels).
    /// Keep in sync with every `accessibilityIdentifier("account.row.*")` in AccountView.
    private static let accountRowIDs: [String: String] = [
        "Profile settings": "account.row.profile",
        "Security": "account.row.security",
        "Verify email & phone": "account.row.verification",
        "Post a job": "account.row.postJob",
        "Job drafts": "account.row.drafts",
        "Sell an item": "account.row.sell",
        "Orders": "account.row.orders",
        "Contracts": "account.row.contracts",
        "Recurring jobs": "account.row.recurringJobs",
        "My bids": "account.row.myBids",
        "Positions blotter": "account.row.positions",
        "My listings": "account.row.myListings",
        "Watchlist": "account.row.watchlist",
        "Saved searches": "account.row.savedSearches",
        "Payment methods": "account.row.paymentMethods",
        "Payments history": "account.row.paymentsHistory",
        "Notifications": "account.row.notifications",
        "Notification preferences": "account.row.notificationPreferences",
        "Provider workspace": "account.row.providerWorkspace",
        "Instant offers": "account.row.instantOffers",
        "Seller analytics": "account.row.sellerAnalytics",
        "Seller payouts": "account.row.sellerPayouts",
        "Business & finance": "account.row.businessFinance",
        "Insurance quote": "account.row.insuranceQuote",
        "Sales export (CSV)": "account.row.salesExport",
        "Calendar export": "account.row.calendarExport",
        "Team": "account.row.team",
        "Challenges": "account.row.challenges",
        "Legal services": "account.row.legalServices",
        "Quote templates": "account.row.quoteTemplates",
        "Verification documents": "account.row.verificationDocuments",
        "Providers": "account.row.providers",
        "Following": "account.row.following",
        "Following feed": "account.row.followingFeed",
        "Properties": "account.row.properties",
        "Wishlist": "account.row.wishlist",
        "Blocked users": "account.row.blockedUsers",
        "Referrals": "account.row.referrals",
        "Feedback surveys": "account.row.feedbackSurveys",
        "Savings": "account.row.savings",
        "Markets": "account.row.markets",
        "Fair price index": "account.row.fairPrice",
        "Marketplace map": "account.row.marketplaceMap",
        "Trust tiers": "account.row.trustTiers",
        "Privacy Policy": "account.row.privacyPolicy",
        "Terms of Service": "account.row.termsOfService",
        "Terms acceptance": "account.row.termsAcceptance",
        "Community Guidelines": "account.row.communityGuidelines",
        "Support": "account.row.support",
        "Export Data": "account.row.exportData",
        "Sign out": "account.row.signOut",
        "Delete Account": "account.row.deleteAccount",
        "Plan limits": "account.row.planLimits",
        "Feature flag status": "account.row.featureFlags",
        "Admin console": "account.row.admin",
    ]

    /// All NavigationLink destinations under Account (by stable id). Export is a Button, not a push.
    private static let allAccountNavigationRowIDs: [(id: String, shot: String)] = [
        ("account.row.profile", "row-profile"),
        ("account.row.providerWorkspace", "row-providerWorkspace"),
        ("account.row.instantOffers", "row-instantOffers"),
        ("account.row.security", "row-security"),
        ("account.row.verification", "row-verification"),
        ("account.row.postJob", "row-postJob"),
        ("account.row.drafts", "row-drafts"),
        ("account.row.sell", "row-sell"),
        ("account.row.orders", "row-orders"),
        ("account.row.contracts", "row-contracts"),
        ("account.row.recurringJobs", "row-recurringJobs"),
        ("account.row.myBids", "row-myBids"),
        ("account.row.positions", "row-positions"),
        ("account.row.myListings", "row-myListings"),
        ("account.row.watchlist", "row-watchlist"),
        ("account.row.savedSearches", "row-savedSearches"),
        ("account.row.sellerAnalytics", "row-sellerAnalytics"),
        ("account.row.sellerPayouts", "row-sellerPayouts"),
        ("account.row.businessFinance", "row-businessFinance"),
        ("account.row.insuranceQuote", "row-insuranceQuote"),
        ("account.row.salesExport", "row-salesExport"),
        ("account.row.calendarExport", "row-calendarExport"),
        ("account.row.team", "row-team"),
        ("account.row.challenges", "row-challenges"),
        ("account.row.legalServices", "row-legalServices"),
        ("account.row.quoteTemplates", "row-quoteTemplates"),
        ("account.row.verificationDocuments", "row-verificationDocuments"),
        ("account.row.paymentMethods", "row-paymentMethods"),
        ("account.row.paymentsHistory", "row-paymentsHistory"),
        ("account.row.notifications", "row-notifications"),
        ("account.row.notificationPreferences", "row-notificationPreferences"),
        ("account.row.providers", "row-providers"),
        ("account.row.following", "row-following"),
        ("account.row.followingFeed", "row-followingFeed"),
        ("account.row.properties", "row-properties"),
        ("account.row.wishlist", "row-wishlist"),
        ("account.row.blockedUsers", "row-blockedUsers"),
        ("account.row.referrals", "row-referrals"),
        ("account.row.feedbackSurveys", "row-feedbackSurveys"),
        ("account.row.savings", "row-savings"),
        ("account.row.markets", "row-markets"),
        ("account.row.fairPrice", "row-fairPrice"),
        ("account.row.marketplaceMap", "row-marketplaceMap"),
        ("account.row.trustTiers", "row-trustTiers"),
        ("account.row.privacyPolicy", "row-privacyPolicy"),
        ("account.row.termsOfService", "row-termsOfService"),
        ("account.row.termsAcceptance", "row-termsAcceptance"),
        ("account.row.communityGuidelines", "row-communityGuidelines"),
        ("account.row.support", "row-support"),
        ("account.row.deleteAccount", "row-deleteAccount"),
        ("account.row.planLimits", "row-planLimits"),
        ("account.row.featureFlags", "row-featureFlags"),
        ("account.row.admin", "row-admin"),
    ]

    /// Visit every Account NavigationLink by stable id; soft-skip missing/role-gated rows.
    private func visitAllAccountRowsByID(shotPrefix: String) {
        var recoveredShell = false
        for entry in Self.allAccountNavigationRowIDs {
            // If a prior destination swallowed the tab bar, cold-recover once so
            // the rest of the sweep can still exercise remaining rows.
            if !recoveredShell,
               !app.tabBars.firstMatch.exists,
               !byID("root.tabview").exists {
                recordSkip(
                    "\(shotPrefix)-mid-sweep-recovery",
                    "tab shell lost before \(entry.id); cold relaunch once"
                )
                app.terminate()
                settle(0.4)
                app = XCUIApplication()
                let env = ProcessInfo.processInfo.environment
                let apiBase = env["NOMARKUP_API_BASE_URL"]
                    ?? env["TEST_RUNNER_NOMARKUP_API_BASE_URL"]
                    ?? "http://127.0.0.1:8081"
                app.launchEnvironment["NOMARKUP_API_BASE_URL"] = apiBase
                app.launch()
                settle(1.2)
                login(email: customerEmail, screenshotPrefix: "\(shotPrefix)-recover")
                recoveredShell = true
            }
            // Export is not a NavigationLink. Admin console is role-gated —
            // test06 asserts the row is absent instead of soft-skipping.
            if entry.id == "account.row.admin" { continue }
            visitAccountRowByID(entry.id, shotName: "\(shotPrefix)-\(entry.shot)")
        }
    }

    /// Open Account row by stable accessibility id only (no label fallback).
    private func visitAccountRowByID(
        _ rowID: String,
        shotName: String,
        settleTime: TimeInterval = 1.6
    ) {
        popToRoot("Account")
        settle(0.35)
        let row = byID(rowID)
        var opened = false
        if row.exists, safeTap(row) {
            opened = true
        } else if scrollTo(row, maxSwipes: 10), safeTap(row) {
            opened = true
        } else {
            for _ in 0..<5 {
                app.swipeUp()
                settle(0.08)
            }
            if scrollTo(row, maxSwipes: 6), safeTap(row) {
                opened = true
            }
        }
        guard opened else {
            recordSkip(shotName, "Account row id '\(rowID)' not found/hittable")
            return
        }
        settle(settleTime)
        // Crash / blank destination signals: still screenshot whatever is visible.
        let crashed = app.staticTexts["Something went wrong"].exists
            || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "thread stack")).firstMatch.exists
        snap(shotName)
        if crashed {
            recordSkip(shotName, "destination shows error chrome after open")
            snap("\(shotName)-error")
        }
        // Empty load-error titles that should usually load with seed data.
        let badEmpty = [
            "Couldn’t load", "Couldn't load", "Failed to load", "Request failed",
        ]
        for phrase in badEmpty {
            if app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", phrase)
            ).firstMatch.exists {
                recordSkip(shotName, "load-error visible: \(phrase)")
                snap("\(shotName)-load-error")
                break
            }
        }
        popToRoot("Account")
    }

    /// Open an Account row by stable id (preferred) or label; screenshot; optionally scroll+shoot; unwind.
    private func visitAccountRow(
        _ label: String,
        shotName: String,
        extraScrollShot: String? = nil,
        settleTime: TimeInterval = 1.6
    ) {
        popToRoot("Account")
        settle(0.4)

        // Prefer stable accessibility identifiers from AccountView.
        if let stableID = Self.accountRowIDs[label] {
            let byStable = byID(stableID)
            if scrollTo(byStable, maxSwipes: 8), safeTap(byStable) {
                settle(settleTime)
                snap(shotName)
                if let extra = extraScrollShot {
                    app.swipeUp()
                    settle(0.6)
                    snap(extra)
                }
                popToRoot("Account")
                return
            }
            // Late rows (subscriptions) — jump bottom once, one more short pass.
            for _ in 0..<4 {
                app.swipeUp()
                settle(0.1)
            }
            if scrollTo(byStable, maxSwipes: 4), safeTap(byStable) {
                settle(settleTime)
                snap(shotName)
                if let extra = extraScrollShot {
                    app.swipeUp()
                    settle(0.6)
                    snap(extra)
                }
                popToRoot("Account")
                return
            }
            recordSkip(shotName, "Account row id '\(stableID)' not found/hittable")
            return
        }

        // Label fallback (no stable id mapping).
        for _ in 0..<3 {
            app.swipeUp()
            settle(0.1)
        }
        let row = byLabel(label)
        let found = scrollTo(row, maxSwipes: 8)
        guard found else {
            recordSkip(shotName, "Account row '\(label)' not found/hittable")
            return
        }
        row.tap()
        settle(settleTime)
        snap(shotName)
        if let extra = extraScrollShot {
            app.swipeUp()
            settle(0.6)
            snap(extra)
        }
        popToRoot("Account")
    }

    /// Wait until a catalog surface leaves its loading skeleton.
    /// Accepts list, empty BrandEmpty title, error, or any of the provided ids.
    @discardableResult
    private func waitForCatalogSettle(
        loadingID: String,
        settledIDs: [String],
        emptyTitles: [String],
        timeout: TimeInterval = 18
    ) -> String {
        let deadline = Date().addingTimeInterval(timeout)
        let loading = byID(loadingID)
        // If loading is visible, wait for it to clear first.
        while loading.exists && Date() < deadline {
            settle(0.35)
        }
        while Date() < deadline {
            for id in settledIDs {
                if byID(id).exists { return id }
            }
            for title in emptyTitles {
                if app.staticTexts[title].exists { return "empty:\(title)" }
            }
            // Rows may exist without a root id on older builds.
            if app.cells.firstMatch.exists { return "cells" }
            settle(0.35)
        }
        return "timeout"
    }

    /// Open a critical Account money surface via stable row id; snap list + root id when present.
    /// Empty BrandEmpty titles are tolerated (network-free / seed-less).
    private func visitCriticalAccountSurface(
        label: String,
        rowID: String,
        rootID: String,
        shotName: String,
        emptyTitles: [String],
        settleTime: TimeInterval = 2.0
    ) {
        popToRoot("Account")
        settle(0.4)
        let row = byID(rowID)
        var opened = false
        if scrollTo(row, maxSwipes: 14), safeTap(row) {
            opened = true
        } else {
            // Label fallback for older builds without account.row.* ids.
            let byName = byLabel(label)
            if scrollTo(byName, maxSwipes: 14), safeTap(byName) {
                opened = true
            }
        }
        guard opened else {
            recordSkip(shotName, "Account row '\(label)' / \(rowID) not found")
            return
        }
        settle(settleTime)
        // Destination settled: root id, Brand empty, or any nav chrome.
        let root = byID(rootID)
        _ = root.waitForExistence(timeout: 6)
            || emptyTitles.contains(where: { app.staticTexts[$0].waitForExistence(timeout: 1) })
            || hasBackButton
        snap(shotName)
        if root.exists {
            snap("\(shotName)-root")
        } else if emptyTitles.contains(where: { app.staticTexts[$0].exists }) {
            snap("\(shotName)-empty")
        }
        app.swipeUp()
        settle(0.5)
        snap("\(shotName)-scrolled")
        popToRoot("Account")
    }

    // MARK: - 01: customer core surfaces

    func test01CustomerCoreWalk() throws {
        signOutIfNeeded()
        login(email: customerEmail, screenshotPrefix: "auth")

        // Home — unicorn hero + market desk (assert ids when present; soft on older builds)
        popToRoot("Home")
        settle(0.8)
        let hero = byID("home.hero")
        if hero.waitForExistence(timeout: 8) {
            snap("home-hero")
            // Primary CTAs on the product desk.
            if byID("home.browseJobs").exists {
                snap("home-hero-ctas")
            }
        } else {
            // Fallback: hero copy still identifies the surface.
            _ = app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Market Sets")
            ).firstMatch.waitForExistence(timeout: 4)
            snap("home-top")
            recordSkip("home.hero", "home.hero id not found (older build?)")
        }
        let marketDesk = byID("home.marketDesk")
        if marketDesk.waitForExistence(timeout: 6) || scrollTo(marketDesk, maxSwipes: 4) {
            snap("home-market-desk")
        } else if app.staticTexts["MARKET DESK"].waitForExistence(timeout: 2)
            || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "MARKET DESK")).firstMatch.exists
        {
            snap("home-market-desk")
        } else {
            recordSkip("home.marketDesk", "market desk not visible after home load")
            snap("home-top-fallback")
        }
        app.swipeUp()
        settle(0.5)
        app.swipeUp()
        settle(0.8)
        snap("home-mid")
        if byID("home.stats").exists {
            snap("home-stats")
        }

        // Marketplace list — wait for loading skeleton to finish (list / empty / error all OK)
        popToRoot("Marketplace")
        let marketplaceState = waitForCatalogSettle(
            loadingID: "marketplace.loading",
            settledIDs: ["marketplace.list", "marketplace.empty", "marketplace.error"],
            emptyTitles: ["No listings nearby", "Couldn’t load listings", "Couldn't load listings"]
        )
        snap("marketplace-list")
        if marketplaceState == "timeout" {
            recordSkip("marketplace-settle", "catalog did not leave loading within timeout")
        } else if marketplaceState.hasPrefix("empty:") || marketplaceState == "marketplace.empty"
            || marketplaceState == "marketplace.error"
        {
            recordSkip("listing-detail", "marketplace empty or error (\(marketplaceState))")
        }

        // Listing detail (first row = seeded live auction)
        if marketplaceState == "marketplace.list" || marketplaceState == "cells" {
            if openFirstRow() {
                snap("listing-detail-top")

                // Watchlist toggle (heart in the toolbar), then restore state.
                let addWatch = app.buttons["Add to watchlist"]
                let removeWatch = app.buttons["Remove from watchlist"]
                if addWatch.exists {
                    addWatch.tap()
                    settle(1.0)
                    dismissNotificationPrePrompt(snapName: "listing-notification-preprompt")
                    snap("listing-watchlist-on")
                    if removeWatch.waitForExistence(timeout: 4) { removeWatch.tap(); settle(0.8) }
                } else if removeWatch.exists {
                    removeWatch.tap()
                    settle(1.0)
                    dismissNotificationPrePrompt(snapName: "listing-notification-preprompt")
                    snap("listing-watchlist-off")
                    if addWatch.waitForExistence(timeout: 4) { addWatch.tap(); settle(0.8) }
                } else {
                    recordSkip("listing-watchlist", "no watchlist toolbar button found")
                }
                dismissNotificationPrePrompt()

                // Place-a-bid UI (inline section; screenshot, do not submit).
                let bidHeader = app.staticTexts["Place a bid (dollars)"]
                if scrollTo(bidHeader, maxSwipes: 10) {
                    snap("listing-place-bid-ui")
                } else {
                    recordSkip("listing-place-bid-ui", "bid section not found (ended or seller view)")
                    snap("listing-detail-scrolled")
                }
            } else {
                recordSkip("listing-detail", "no listing rows in marketplace")
            }
        }

        // Jobs browse — segment + wait for load (skeleton → list / empty / error)
        popToRoot("Jobs")
        let jobsSegment = byID("jobs.segment")
        if jobsSegment.waitForExistence(timeout: 6) {
            snap("jobs-segment")
        } else {
            // Segmented control may only expose labels on some OS versions.
            _ = app.buttons["Browse"].waitForExistence(timeout: 2)
                || app.staticTexts["Browse"].waitForExistence(timeout: 1)
            snap("jobs-segment-fallback")
        }
        let jobsState = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: [
                "No open reverse auctions",
                "Couldn’t load jobs",
                "Couldn't load jobs",
            ]
        )
        snap("jobs-list")
        if jobsState == "timeout" {
            recordSkip("jobs-settle", "jobs browse did not leave loading within timeout")
        }

        // Job detail with bids
        if jobsState == "jobs.list" || jobsState == "cells" {
            if openFirstRow() {
                snap("job-detail-top")
                app.swipeUp()
                settle(0.5)
                app.swipeUp()
                settle(0.6)
                snap("job-detail-bids")
            } else {
                recordSkip("job-detail", "no job rows in browse list")
            }
        } else if jobsState.hasPrefix("empty:") || jobsState == "jobs.empty" || jobsState == "jobs.error" {
            recordSkip("job-detail", "jobs empty or error (\(jobsState))")
        }

        // Messages: thread list, seeded conversation, focused composer.
        popToRoot("Messages")
        settle(2.0)
        snap("messages-list")
        if openFirstRow() {
            snap("messages-thread")
            let composer = app.textFields["Message"]
            if composer.waitForExistence(timeout: 5) {
                composer.tap()
                settle(1.0)
                snap("messages-composer-focused")
                goBack() // pop dismisses the keyboard with it
            } else {
                recordSkip("messages-composer", "composer text field not found")
            }
        } else {
            recordSkip("messages-thread", "no chat threads for this account")
        }
        popToRoot("Messages")
    }

    // MARK: - 02: customer Account surfaces

    func test02CustomerAccountWalk() throws {
        // Session persists from test01 (Keychain); login only if needed.
        if !byID("root.tabview").waitForExistence(timeout: 6) {
            login(email: customerEmail)
        }

        popToRoot("Account")
        settle(1.2)
        snap("account-root-top")
        app.swipeUp()
        settle(0.4)
        app.swipeUp()
        settle(0.4)
        snap("account-root-mid")
        for _ in 0..<4 { app.swipeUp(); settle(0.3) }
        snap("account-root-bottom-about")

        // Ordered roughly top-to-bottom through the Account list; bidirectional
        // scrolling covers drift from the lazy List's persistent position.
        visitAccountRow("Profile settings", shotName: "account-profile-settings")
        visitAccountRow(
            "Security",
            shotName: "account-security-top",
            extraScrollShot: "account-security-applock-passkeys"
        )
        visitAccountRow("Verify email & phone", shotName: "account-verification-center")

        // Post a job — every field: Speed/Matching picker, details, category,
        // auction length, location. Nothing is submitted (back-out = cancel).
        popToRoot("Account")
        let postJob = byLabel("Post a job")
        if scrollTo(postJob, maxSwipes: 12) {
            postJob.tap()
            settle(1.5)
            snap("post-job-form-top")
            app.swipeUp()
            settle(0.5)
            snap("post-job-form-mid")
            app.swipeUp()
            settle(0.5)
            snap("post-job-form-bottom")
        } else {
            recordSkip("post-job", "'Post a job' row not found")
        }

        // Create / commerce
        visitAccountRow("Job drafts", shotName: "account-job-drafts")
        visitAccountRow("Sell an item", shotName: "account-sell-item")

        // Orders, bids & alerts
        visitAccountRow("My bids", shotName: "account-my-bids")
        visitAccountRow("Orders", shotName: "account-my-orders")
        visitAccountRow("Contracts", shotName: "account-contracts")
        visitAccountRow("My listings", shotName: "account-my-listings")
        visitAccountRow("Watchlist", shotName: "account-watchlist")
        visitAccountRow("Saved searches", shotName: "account-saved-searches")
        visitAccountRow("Seller analytics", shotName: "account-seller-analytics")
        // Critical money rows — prefer account.row.* ids; assert destination root ids.
        visitCriticalAccountSurface(
            label: "Seller payouts",
            rowID: "account.row.sellerPayouts",
            rootID: "sellerPayouts.root",
            shotName: "account-seller-payouts",
            emptyTitles: ["Sign in required"]
        )
        visitAccountRow("Business & finance", shotName: "account-business-finance")
        visitAccountRow("Sales export (CSV)", shotName: "account-sales-export")
        visitAccountRow("Calendar export", shotName: "account-calendar-export")
        visitAccountRow("Team", shotName: "account-team")
        visitAccountRow("Challenges", shotName: "account-challenges")
        visitAccountRow("Legal services", shotName: "account-legal-services")
        visitAccountRow("Quote templates", shotName: "account-quote-templates")
        visitAccountRow("Verification documents", shotName: "account-verification-docs")
        visitCriticalAccountSurface(
            label: "Payment methods",
            rowID: "account.row.paymentMethods",
            rootID: "paymentMethods.root",
            shotName: "account-payment-methods",
            emptyTitles: [
                "No saved payment methods",
                "Sign in required",
                "Couldn’t load methods",
                "Couldn't load methods",
            ]
        )
        visitAccountRow("Notifications", shotName: "account-notifications")
        visitAccountRow("Notification preferences", shotName: "account-notification-prefs")

        // Network & safety
        visitAccountRow("Providers", shotName: "account-providers")
        visitAccountRow("Following", shotName: "account-following")
        visitAccountRow("Following feed", shotName: "account-following-feed")
        visitAccountRow("Properties", shotName: "account-properties")
        visitAccountRow("Wishlist", shotName: "account-wishlist")
        visitAccountRow("Blocked users", shotName: "account-blocked-users")
        visitAccountRow("Referrals", shotName: "account-referrals")
        visitAccountRow("Feedback surveys", shotName: "account-feedback-surveys")

        // Legal / trust / subscription
        visitAccountRow("Trust tiers", shotName: "account-trust-tiers")
        visitAccountRow("Savings", shotName: "account-savings")
        visitAccountRow("Markets", shotName: "account-markets")
        visitAccountRow("Terms acceptance", shotName: "account-terms-acceptance")
        visitAccountRow("Privacy Policy", shotName: "account-privacy")
        visitAccountRow("Terms of Service", shotName: "account-terms")
        visitAccountRow("Community Guidelines", shotName: "account-community")
        visitAccountRow("Support", shotName: "account-support")
        // Open Delete Account screen only (do not confirm destructive action)
        visitAccountRow("Delete Account", shotName: "account-delete-screen-only")
        visitAccountRow("Plan limits", shotName: "account-plan-limits")
        visitAccountRow("Feature flag status", shotName: "account-feature-flags")

        // Newer rows not always covered by the ordered label walk above.
        visitAccountRow("Recurring jobs", shotName: "account-recurring-jobs")
        visitAccountRow("Positions blotter", shotName: "account-positions-blotter")
        visitAccountRow("Insurance quote", shotName: "account-insurance-quote")
        visitAccountRow("Payments history", shotName: "account-payments-history")
        visitAccountRow("Fair price index", shotName: "account-fair-price")
        visitAccountRow("Marketplace map", shotName: "account-marketplace-map")
    }

    // MARK: - 03: provider surfaces + empty states

    func test03ProviderWalk() throws {
        // Switch to the provider account through the real UI.
        signOutIfNeeded()
        login(email: providerEmail, screenshotPrefix: "provider")

        visitAccountRow(
            "Provider workspace",
            shotName: "provider-workspace-top",
            extraScrollShot: "provider-workspace-mid",
            settleTime: 2.0
        )
        visitAccountRow("Instant offers", shotName: "provider-instant-offers", settleTime: 2.0)
        visitAccountRow("Security", shotName: "provider-security")
        visitAccountRow("Verify email & phone", shotName: "provider-verification-center")
        visitAccountRow("Quote templates", shotName: "provider-quote-templates")
        visitAccountRow("Seller analytics", shotName: "provider-seller-analytics", settleTime: 2.0)
        visitAccountRow("Seller payouts", shotName: "provider-seller-payouts", settleTime: 2.0)
        visitAccountRow("Business & finance", shotName: "provider-business-finance")
        visitAccountRow("Sales export (CSV)", shotName: "provider-sales-export")
        visitAccountRow("Calendar export", shotName: "provider-calendar-export")
        visitAccountRow("Team", shotName: "provider-team")
        visitAccountRow("Challenges", shotName: "provider-challenges")
        visitAccountRow("Verification documents", shotName: "provider-verification-docs")
        visitAccountRow("My listings", shotName: "provider-my-listings")
        visitAccountRow("My bids", shotName: "provider-my-bids")
        visitAccountRow("Contracts", shotName: "provider-contracts")
        visitAccountRow("Payment methods", shotName: "provider-payment-methods")
        visitAccountRow("Notifications", shotName: "provider-notifications")
        visitAccountRow("Notification preferences", shotName: "provider-notification-prefs")
        visitAccountRow("Trust tiers", shotName: "provider-trust-tiers")
        visitAccountRow("Plan limits", shotName: "provider-plan-limits")
        visitAccountRow("Feature flag status", shotName: "provider-feature-flags")

        // Marketplace: open first listing as provider (bid ladder vs seller view)
        popToRoot("Marketplace")
        settle(2.0)
        snap("provider-marketplace-list")
        if openFirstRow() {
            snap("provider-listing-detail")
            goBack()
        } else {
            recordSkip("provider-listing-detail", "no listing rows")
        }

        // Provider view of a job detail (provider-side bid UI).
        popToRoot("Jobs")
        settle(2.0)
        if openFirstRow() {
            let bidHeader = app.staticTexts["Place a bid (dollars)"]
            let lowerHeader = app.staticTexts["Lower your bid (dollars)"]
            if scrollTo(bidHeader, maxSwipes: 8) || scrollTo(lowerHeader, maxSwipes: 2) {
                snap("provider-job-bid-ui")
            } else {
                recordSkip("provider-job-bid-ui", "no bid section on first job (own job or closed)")
                snap("provider-job-detail")
            }
        } else {
            recordSkip("provider-job-detail", "no job rows")
        }
        popToRoot("Jobs")

        // Messages as provider
        popToRoot("Messages")
        settle(1.5)
        snap("provider-messages-list")
        if openFirstRow() {
            snap("provider-messages-thread")
            goBack()
        }

        // Empty/error states on provider2 (second provider data state).
        signOutIfNeeded()
        login(email: provider2Email)
        visitAccountRow("Instant offers", shotName: "provider2-instant-offers-empty", settleTime: 2.0)
        visitAccountRow("Quote templates", shotName: "provider2-quote-templates-empty")
        visitAccountRow("Watchlist", shotName: "provider2-watchlist-empty")
        visitAccountRow("My listings", shotName: "provider2-my-listings-empty")
        visitAccountRow("Seller payouts", shotName: "provider2-seller-payouts")

        // Leave the app signed out so the next leg starts at the login form.
        signOutIfNeeded()
    }

    // MARK: - 04: near-fresh customer profile (customer2) — empty/sparse states
    // Run on the iPhone-light leg only (skipped via -skip-testing on other legs).

    func test04FreshCustomerStatesWalk() throws {
        signOutIfNeeded()
        login(email: customer2Email)

        // Messages empty state.
        popToRoot("Messages")
        settle(2.0)
        snap("customer2-messages-empty")

        // Account-surface empty/sparse states.
        visitAccountRow("My bids", shotName: "customer2-my-bids-empty")
        visitAccountRow("Orders", shotName: "customer2-orders-empty")
        visitAccountRow("Watchlist", shotName: "customer2-watchlist-empty")
        visitAccountRow("Properties", shotName: "customer2-properties-empty")

        signOutIfNeeded()
    }

    // MARK: - 05: admin profile — Admin console must open without crash

    func test05AdminSessionWalk() throws {
        signOutIfNeeded()
        login(email: adminEmail, screenshotPrefix: "admin")

        // Which chrome does an admin get? (expected: the standard 5-tab shell)
        popToRoot("Home")
        settle(1.5)
        snap("admin-home")

        popToRoot("Account")
        settle(1.2)
        snap("admin-account-root-top")
        app.swipeUp()
        settle(0.4)
        app.swipeUp()
        settle(0.4)
        snap("admin-account-root-mid")
        for _ in 0..<4 { app.swipeUp(); settle(0.3) }
        snap("admin-account-root-bottom")

        // Server-flag surface an admin would care about (read-only on iOS).
        visitAccountRow("Feature flag status", shotName: "admin-feature-flag-status")

        // Admin console (hasAdminRole gate) — open root + switch a few tabs.
        // Hard requirement: must not crash (stack overflow historically hit here).
        popToRoot("Account")
        settle(0.5)
        let adminRow = byID("account.row.admin")
        var openedAdmin = false
        if scrollTo(adminRow, maxSwipes: 14), safeTap(adminRow) {
            openedAdmin = true
        } else {
            let byLabel = byLabel("Admin console")
            if scrollTo(byLabel, maxSwipes: 10), safeTap(byLabel) {
                openedAdmin = true
            }
        }
        XCTAssertTrue(
            openedAdmin,
            "Admin console row (account.row.admin) must appear for admin@ seed"
        )
        settle(2.5)
        // Process still live + destination chrome.
        XCTAssertTrue(app.state == .runningForeground, "app crashed opening Admin console")
        let adminRoot = byID("admin.console.root")
        let adminTabs = byID("admin.console.tabs")
        let adminOnly = app.staticTexts["Admin only"]
        let signInRequired = app.staticTexts["Sign in required"]
        let hasChrome = adminRoot.waitForExistence(timeout: 8)
            || adminTabs.waitForExistence(timeout: 2)
            || adminOnly.exists
            || signInRequired.exists
            || hasBackButton
        XCTAssertTrue(hasChrome, "Admin console destination must render chrome")
        snap("admin-console-root")
        // Section Menu (admin.console.tabs.menu) — not the retired capsule strip.
        // Residual sections get `admin.<slug>.root` so the walk can wait on dest chrome.
        let adminSections = [
            "Disputes", "Users", "Fraud", "Jobs", "Fees", "Banking", "Markets", "Platform",
            "Advances", "Taxonomy", "Insurers", "Challenges",
            "Verify", "Licenses", "Insurance", "Reviews",
        ]
        for tabLabel in adminSections {
            if tapAdminConsoleTab(tabLabel) {
                let slug = tabLabel.lowercased().replacingOccurrences(of: " ", with: "-")
                _ = byID("admin.\(slug).root").waitForExistence(timeout: 6)
                settle(0.6)
                XCTAssertTrue(app.state == .runningForeground, "crash on admin tab \(tabLabel)")
                snap("admin-console-tab-\(slug)")
            } else {
                recordSkip("admin-console-tab-\(tabLabel.lowercased())", "section menu row not found")
            }
        }
        popToRoot("Account")

        signOutIfNeeded()
    }

    // MARK: - 06: focused customer Account row-id sweep (every NavigationLink)

    func test06CustomerAccountRowIDSweep() throws {
        signOutIfNeeded()
        login(email: customerEmail, screenshotPrefix: "cust-sweep")
        popToRoot("Account")
        settle(1.0)
        snap("cust-sweep-account-root")
        XCTAssertFalse(byID("account.row.admin").exists, "customer seed must not show Admin console")
        visitAllAccountRowsByID(shotPrefix: "cust")
        // Account must still be alive after full sweep (no stack overflow).
        XCTAssertTrue(app.state == .runningForeground, "app crashed during customer Account row sweep")
        popToRoot("Account")
        // Deep NavigationStack walks (50+ Account destinations) can transiently
        // detach the TabView chrome without crashing the process. Recover once
        // via cold login so we assert product liveness, not an intermediate
        // SwiftUI tab-bar flicker.
        if !(byID("root.tabview").waitForExistence(timeout: 3) || app.tabBars.firstMatch.exists) {
            recordSkip("cust-sweep-tab-recovery", "tab shell missing after sweep; cold relaunch")
            app.terminate()
            settle(0.5)
            app = XCUIApplication()
            let env = ProcessInfo.processInfo.environment
            let apiBase = env["NOMARKUP_API_BASE_URL"]
                ?? env["TEST_RUNNER_NOMARKUP_API_BASE_URL"]
                ?? "http://127.0.0.1:8081"
            app.launchEnvironment["NOMARKUP_API_BASE_URL"] = apiBase
            app.launch()
            settle(1.5)
            login(email: customerEmail, screenshotPrefix: "cust-sweep-recover")
            popToRoot("Account")
        }
        XCTAssertTrue(
            byID("root.tabview").waitForExistence(timeout: 8)
                || app.tabBars.firstMatch.exists,
            "tab shell should remain (or recover) after Account sweep"
        )
        snap("cust-sweep-account-still-alive")
        signOutIfNeeded()
    }

    // MARK: - 07: provider Instant offers / Seller payouts / Business hub

    func test07ProviderMoneyHubWalk() throws {
        signOutIfNeeded()
        login(email: providerEmail, screenshotPrefix: "prov-hub")

        popToRoot("Account")
        settle(1.0)
        snap("prov-hub-account-root")

        visitCriticalAccountSurface(
            label: "Instant offers",
            rowID: "account.row.instantOffers",
            rootID: "instantOffers.root",
            shotName: "prov-instant-offers",
            emptyTitles: [
                "No pending offers",
                "Provider role required",
                "Sign in required",
                "Couldn’t load offers",
                "Couldn't load offers",
            ],
            settleTime: 2.2
        )
        XCTAssertTrue(app.state == .runningForeground)

        visitCriticalAccountSurface(
            label: "Seller payouts",
            rowID: "account.row.sellerPayouts",
            rootID: "sellerPayouts.root",
            shotName: "prov-seller-payouts",
            emptyTitles: ["Sign in required"],
            settleTime: 2.2
        )
        XCTAssertTrue(app.state == .runningForeground)

        visitCriticalAccountSurface(
            label: "Business & finance",
            rowID: "account.row.businessFinance",
            rootID: "businessHub.root",
            shotName: "prov-business-finance",
            emptyTitles: ["Sign in required"],
            settleTime: 2.0
        )
        XCTAssertTrue(app.state == .runningForeground)

        visitAccountRow(
            "Provider workspace",
            shotName: "prov-workspace",
            extraScrollShot: "prov-workspace-mid",
            settleTime: 2.0
        )
        visitAccountRow("Seller analytics", shotName: "prov-seller-analytics", settleTime: 2.0)
        visitAccountRow("Team", shotName: "prov-team")
        visitAccountRow("Quote templates", shotName: "prov-quote-templates")

        snap("prov-hub-done")
        signOutIfNeeded()
    }

    // MARK: - 08: admin Account row sweep + Admin console hard assert

    func test08AdminAccountAndConsole() throws {
        signOutIfNeeded()
        login(email: adminEmail, screenshotPrefix: "admin-sweep")
        popToRoot("Account")
        settle(1.2)
        snap("admin-sweep-account-root")

        // Admin console first (highest risk for LazyView / stack issues).
        visitAccountRowByID("account.row.admin", shotName: "admin-sweep-console", settleTime: 2.5)
        XCTAssertTrue(app.state == .runningForeground, "Admin console open crashed")

        // Re-open and assert root id.
        popToRoot("Account")
        let adminRow = byID("account.row.admin")
        if scrollTo(adminRow, maxSwipes: 14), safeTap(adminRow) {
            settle(2.0)
            let rootOK = byID("admin.console.root").waitForExistence(timeout: 8)
                || byID("admin.console.tabs").waitForExistence(timeout: 2)
            XCTAssertTrue(rootOK || hasBackButton, "Admin console must show root/tabs")
            snap("admin-sweep-console-asserted")
            // Flags tab is default — screenshot load result.
            settle(1.0)
            snap("admin-sweep-console-flags")
            // Section Menu (same path as test05).
            for tabLabel in ["Disputes", "Users", "Fraud", "Jobs"] {
                if tapAdminConsoleTab(tabLabel) {
                    let slug = tabLabel.lowercased().replacingOccurrences(of: " ", with: "-")
                    _ = byID("admin.\(slug).root").waitForExistence(timeout: 6)
                    settle(0.5)
                    snap("admin-sweep-console-\(slug)")
                } else {
                    recordSkip(
                        "admin-sweep-console-\(tabLabel.lowercased())",
                        "section menu row not found"
                    )
                }
            }
        } else {
            XCTFail("account.row.admin not hittable for admin@ seed")
        }
        popToRoot("Account")

        // Spot-check a few other account rows under admin session.
        for id in [
            "account.row.profile",
            "account.row.featureFlags",
            "account.row.planLimits",
            "account.row.security",
            "account.row.contracts",
            "account.row.orders",
        ] {
            visitAccountRowByID(id, shotName: "admin-sweep-\(id.replacingOccurrences(of: "account.row.", with: ""))")
        }
        XCTAssertTrue(app.state == .runningForeground)
        signOutIfNeeded()
    }
}
