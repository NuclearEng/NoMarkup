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
        addUIInterruptionMonitor(withDescription: "System dialog") { alert in
            for title in ["Don’t Allow", "Don't Allow", "Not Now", "Cancel", "OK"] {
                let button = alert.buttons[title]
                if button.exists { button.tap(); return true }
            }
            return false
        }
        // Intentionally no NOMARKUP_UI_TEST_* in app.launchEnvironment:
        // the walk must exercise the real login form, not DEBUG auto-login.
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

    /// Bidirectional lazy-List search: swipe up first, then fall back to swiping down.
    @discardableResult
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 10) -> Bool {
        if element.exists && element.isHittable { return true }
        for _ in 0..<maxSwipes {
            app.swipeUp()
            settle(0.25)
            if element.exists && element.isHittable { return true }
        }
        for _ in 0..<(maxSwipes * 2) {
            app.swipeDown()
            settle(0.25)
            if element.exists && element.isHittable { return true }
        }
        return element.exists && element.isHittable
    }

    /// Tap the nav-bar back button when present.
    private func goBack() {
        let back = app.navigationBars.buttons.element(boundBy: 0)
        if back.exists && back.isHittable {
            back.tap()
            settle(0.5)
        }
    }

    /// Leading nav-bar button ≈ back affordance (pushed screen).
    private var hasBackButton: Bool {
        let bar = app.navigationBars.element(boundBy: 0)
        guard bar.exists else { return false }
        let first = bar.buttons.element(boundBy: 0)
        guard first.exists else { return false }
        return first.frame.minX < 80 && first.frame.width < 120
    }

    /// Switch tabs via the tab BAR only (never the full-screen `tab.*` content ids).
    private func openTab(_ label: String) {
        let barButton = app.tabBars.buttons[label]
        if barButton.waitForExistence(timeout: 4) {
            if barButton.isHittable {
                barButton.tap()
                settle(0.4)
                return
            }
            // Bar present but covered: clear known overlays, then retry/coordinate-tap.
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            if barButton.isHittable {
                barButton.tap()
            } else {
                barButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            settle(0.4)
            return
        }
        // iPad sidebar / adapted chrome fallback: a SMALL control with this label.
        let candidates = app.buttons.matching(NSPredicate(format: "label == %@", label))
        let count = candidates.count
        for i in 0..<min(count, 6) {
            let el = candidates.element(boundBy: i)
            if el.exists && el.isHittable && el.frame.height < 140 && el.frame.width < 300 {
                el.tap()
                settle(0.4)
                return
            }
        }
        recordSkip("tab-\(label)", "no tab bar control found")
    }

    /// Switch to a tab and unwind its navigation stack to the root list.
    private func popToRoot(_ label: String) {
        openTab(label)
        var attempts = 0
        while hasBackButton && attempts < 4 {
            goBack()
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
            if !cell.isHittable {
                app.swipeUp()
                settle(0.3)
            }
            guard cell.exists && cell.isHittable else { continue }
            cell.tap()
            settle(1.6)
            if hasBackButton { return true }
        }
        return false
    }

    /// Open an Account row by label, screenshot it, optionally scroll+shoot again, then unwind.
    private func visitAccountRow(
        _ label: String,
        shotName: String,
        extraScrollShot: String? = nil,
        settleTime: TimeInterval = 1.6
    ) {
        popToRoot("Account")
        settle(0.4)
        let row = byLabel(label)
        guard scrollTo(row, maxSwipes: 12) else {
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

    // MARK: - 01: customer core surfaces

    func test01CustomerCoreWalk() throws {
        signOutIfNeeded()
        login(email: customerEmail, screenshotPrefix: "auth")

        // Home
        popToRoot("Home")
        settle(1.5)
        snap("home-top")
        app.swipeUp()
        settle(0.5)
        app.swipeUp()
        settle(0.8)
        snap("home-mid")

        // Marketplace list (root list — popToRoot unwinds any pushed detail)
        popToRoot("Marketplace")
        settle(2.0)
        snap("marketplace-list")

        // Listing detail (first row = seeded live auction)
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

        // Jobs list
        popToRoot("Jobs")
        settle(2.0)
        snap("jobs-list")

        // Job detail with bids
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

        visitAccountRow("My bids", shotName: "account-my-bids")
        visitAccountRow("Orders", shotName: "account-my-orders")
        visitAccountRow("Watchlist", shotName: "account-watchlist")
        visitAccountRow("Saved searches", shotName: "account-saved-searches")
        visitAccountRow("Notification preferences", shotName: "account-notification-prefs")
        visitAccountRow("Properties", shotName: "account-properties")
        visitAccountRow("Referrals", shotName: "account-referrals")
        visitAccountRow("Trust tiers", shotName: "account-trust-tiers")
        visitAccountRow("Terms acceptance", shotName: "account-terms-acceptance")
        visitAccountRow("Plan limits", shotName: "account-plan-limits")
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
        visitAccountRow("Quote templates", shotName: "provider-quote-templates")
        visitAccountRow("Seller analytics", shotName: "provider-seller-analytics", settleTime: 2.0)
        visitAccountRow("Seller payouts", shotName: "provider-seller-payouts", settleTime: 2.0)

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

        // Empty/error states on provider2 (second provider data state).
        signOutIfNeeded()
        login(email: provider2Email)
        visitAccountRow("Instant offers", shotName: "provider2-instant-offers-empty", settleTime: 2.0)
        visitAccountRow("Quote templates", shotName: "provider2-quote-templates-empty")
        visitAccountRow("Watchlist", shotName: "provider2-watchlist-empty")

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

    // MARK: - 05: admin profile — document what an admin session renders on iOS
    // The app has no admin-role conditional UI (no isAdmin branches); this leg
    // captures the evidence for the ledger rather than skipping silently.

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

        signOutIfNeeded()
    }
}
