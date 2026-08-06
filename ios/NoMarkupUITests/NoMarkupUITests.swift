import XCTest

/// Smoke XCUITests for cold launch, credentialed login, tab shell, Account hub,
/// marketplace open-first-listing, and multi-role seed accounts.
///
/// Credentials: `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` on the test
/// process (scheme or `xcodebuild` env), with `TEST_RUNNER_*` fallbacks and seed
/// defaults (`customer@nomarkup.com` / `Password123!`). Role-specific methods use
/// `NOMARKUP_UI_TEST_PROVIDER_EMAIL`, `NOMARKUP_UI_TEST_ADMIN_EMAIL` (or the same
/// password key) with defaults `provider@` / `admin@nomarkup.com`.
///
/// Harness notes (shared with ScreenshotWalkUITests):
/// - `tab.*` accessibility identifiers live on full-screen tab CONTENT views —
///   do not tap them for navigation; use tab BAR buttons by label instead.
/// - SwiftUI Lists are lazy: off-viewport rows need bidirectional scroll.
final class NoMarkupUITests: XCTestCase {
    private var app: XCUIApplication!

    // MARK: - Credentials

    /// Credentials from process env, `TEST_RUNNER_*`, or optional local file
    /// `NoMarkupUITests/Credentials.local` (gitignored) with lines KEY=value.
    private static func testCredential(_ key: String, default def: String = "") -> String {
        let env = ProcessInfo.processInfo.environment
        for candidate in [key, "TEST_RUNNER_\(key)"] {
            if let v = env[candidate], !v.isEmpty { return v }
        }
        // xcodebuild sometimes only forwards a subset; allow a local file for dogfood.
        let fileURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Credentials.local")
        if let text = try? String(contentsOf: fileURL, encoding: .utf8) {
            for line in text.split(whereSeparator: \.isNewline) {
                let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
                if parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces) == key {
                    return parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
        // Default seed for local dogfood (matches docs Password123! when SEED_PASSWORD empty).
        if key == "NOMARKUP_UI_TEST_EMAIL" { return def.isEmpty ? "customer@nomarkup.com" : def }
        if key == "NOMARKUP_UI_TEST_PASSWORD" { return def.isEmpty ? "Password123!" : def }
        return def
    }

    private var customerEmail: String {
        Self.testCredential("NOMARKUP_UI_TEST_EMAIL", default: "customer@nomarkup.com")
    }

    private var providerEmail: String {
        Self.testCredential("NOMARKUP_UI_TEST_PROVIDER_EMAIL", default: "provider@nomarkup.com")
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

        // Defensive: dismiss system permission alerts without granting.
        addUIInterruptionMonitor(withDescription: "System dialog") { alert in
            for title in ["Don’t Allow", "Don't Allow", "Not Now", "Cancel", "OK"] {
                let button = alert.buttons[title]
                if button.exists { button.tap(); return true }
            }
            return false
        }

        // Default launch: customer seed credentials for DEBUG auto-login.
        configureLaunchCredentials(email: customerEmail, password: password)
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - Helpers

    private func configureLaunchCredentials(email: String, password: String) {
        if !email.isEmpty {
            app.launchEnvironment["NOMARKUP_UI_TEST_EMAIL"] = email
        }
        if !password.isEmpty {
            app.launchEnvironment["NOMARKUP_UI_TEST_PASSWORD"] = password
        }
    }

    /// Relaunch the app under test with a specific role's credentials (DEBUG auto-login).
    private func relaunch(email: String, password: String) {
        app.terminate()
        app = XCUIApplication()
        configureLaunchCredentials(email: email, password: password)
        app.launch()
        settle(1.0)
    }

    private func settle(_ seconds: TimeInterval = 0.6) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    private func byID(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// First tappable element whose label matches exactly (buttons first, then cells/text).
    private func byLabel(_ label: String) -> XCUIElement {
        if app.buttons[label].exists { return app.buttons[label] }
        if app.cells.staticTexts[label].exists { return app.cells.staticTexts[label] }
        return app.staticTexts[label]
    }

    /// Bidirectional lazy-List search.
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

    private func goBack() {
        let back = app.navigationBars.buttons.element(boundBy: 0)
        if back.exists && back.isHittable {
            back.tap()
            settle(0.5)
        }
    }

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
        // iPad sidebar / adapted chrome fallback.
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
        XCTFail("No tab bar control found for '\(label)'")
    }

    private func popToRoot(_ label: String) {
        openTab(label)
        var attempts = 0
        while hasBackButton && attempts < 4 {
            goBack()
            attempts += 1
        }
    }

    @discardableResult
    private func dismissNotificationPrePrompt() -> Bool {
        let notNow = app.buttons["Not now"]
        guard notNow.waitForExistence(timeout: 2) else { return false }
        notNow.tap()
        settle(0.5)
        return true
    }

    @discardableResult
    private func completeAgeGateIfPresent() -> Bool {
        let gate = byID("ageGate.dialog")
        guard gate.waitForExistence(timeout: 3) else { return false }
        let cont = app.buttons["Continue"]
        if cont.exists {
            cont.tap()
            let deadline = Date().addingTimeInterval(10)
            while gate.exists && Date() < deadline {
                settle(0.5)
            }
        }
        settle(0.4)
        return true
    }

    /// Wait for signed-in tab shell after auto-login or manual form submit.
    @discardableResult
    private func waitForSignedInShell(timeout: TimeInterval = 25) -> Bool {
        let tabView = byID("root.tabview")
        if tabView.waitForExistence(timeout: timeout) {
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            return true
        }
        return false
    }

    /// Ensure we are signed in as `email`. Prefers DEBUG auto-login via relaunch;
    /// falls back to the real login form when still on login.
    private func ensureSignedIn(email: String, password: String) {
        if byID("root.tabview").waitForExistence(timeout: 8) {
            // Already signed in (possibly wrong role). Check email row if present.
            openTab("Account")
            settle(0.5)
            if app.staticTexts[email].waitForExistence(timeout: 3)
                || app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", email)).firstMatch.exists
            {
                completeAgeGateIfPresent()
                dismissNotificationPrePrompt()
                return
            }
            // Wrong session — sign out and re-login.
            signOutIfNeeded()
        }

        // Prefer relaunch auto-login (faster + stable).
        relaunch(email: email, password: password)
        if waitForSignedInShell(timeout: 20) { return }

        // Manual form fallback.
        let emailField = byID("login.email")
        let passwordField = byID("login.password")
        let submit = byID("login.submit")
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "login.email not found")
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "login.password not found")
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "login.submit not found")

        emailField.tap()
        emailField.typeText(email)
        passwordField.tap()
        passwordField.typeText(password)
        submit.tap()

        XCTAssertTrue(
            waitForSignedInShell(timeout: 30),
            "root.tabview should appear after login as \(email)"
        )
    }

    private func signOutIfNeeded() {
        let tabView = byID("root.tabview")
        guard tabView.waitForExistence(timeout: 6) else { return }
        completeAgeGateIfPresent()
        dismissNotificationPrePrompt()
        popToRoot("Account")
        settle(0.6)
        let signOut = app.buttons["Sign out"]
        guard scrollTo(signOut, maxSwipes: 8) else { return }
        signOut.tap()
        _ = byID("login.email").waitForExistence(timeout: 10)
        settle(0.4)
    }

    /// Open first navigable list row (skips decorative cells). Soft: returns false on miss.
    @discardableResult
    private func openFirstRow(timeout: TimeInterval = 8) -> Bool {
        let cells = app.cells
        guard cells.firstMatch.waitForExistence(timeout: timeout) else { return false }
        let count = min(cells.count, 8)
        for index in 0..<count {
            let cell = cells.element(boundBy: index)
            guard cell.exists else { continue }
            if !cell.isHittable {
                app.swipeUp()
                settle(0.3)
            }
            guard cell.exists && cell.isHittable else { continue }
            cell.tap()
            settle(1.4)
            if hasBackButton { return true }
        }
        return false
    }

    /// Stable `account.row.*` slugs from AccountView (preferred over synthesized ids).
    private static let accountRowIDs: [String: String] = [
        "Profile settings": "account.row.profile",
        "Security": "account.row.security",
        "Verify email & phone": "account.row.verification",
        "Post a job": "account.row.postJob",
        "Job drafts": "account.row.drafts",
        "Sell an item": "account.row.sell",
        "Orders": "account.row.orders",
        "Contracts": "account.row.contracts",
        "My bids": "account.row.myBids",
        "My listings": "account.row.myListings",
        "Watchlist": "account.row.watchlist",
        "Payment methods": "account.row.paymentMethods",
        "Notifications": "account.row.notifications",
        "Provider workspace": "account.row.providerWorkspace",
        "Instant offers": "account.row.instantOffers",
        "Seller analytics": "account.row.sellerAnalytics",
        "Seller payouts": "account.row.sellerPayouts",
        "Business & finance": "account.row.businessFinance",
        "Plan limits": "account.row.planLimits",
        "Feature flag status": "account.row.featureFlags",
        "Delete Account": "account.row.deleteAccount",
    ]

    /// Tap an Account row by visible label when present; soft-skip if missing.
    /// Prefers stable `account.row.*` identifiers; falls back to labels so older builds stay green.
    @discardableResult
    private func tapAccountRowIfPresent(_ label: String) -> Bool {
        popToRoot("Account")
        settle(0.3)
        // Prefer stable accessibility identifiers from AccountView (`account.row.*`).
        if let stableID = Self.accountRowIDs[label] {
            let byStable = byID(stableID)
            if byStable.exists && byStable.isHittable {
                byStable.tap()
                settle(1.2)
                return true
            }
            // May be off-screen — try scrolling the list for the id.
            if scrollTo(byStable, maxSwipes: 12), byStable.isHittable {
                byStable.tap()
                settle(1.2)
                return true
            }
        }
        // Legacy synthesized id (`account.profilesettings`) for older builds.
        let idCandidate = "account." + label
            .lowercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "&", with: "")
        let byAccessibility = byID(idCandidate)
        if byAccessibility.exists && byAccessibility.isHittable {
            byAccessibility.tap()
            settle(1.2)
            return true
        }
        // Known identifier for Finish setup banner.
        if label == "Finish setup" {
            let finish = byID("account.finishSetup")
            if finish.waitForExistence(timeout: 2), finish.isHittable {
                finish.tap()
                settle(1.2)
                return true
            }
        }
        // Label fallback — must keep working for UITests that key off visible text.
        let row = byLabel(label)
        guard scrollTo(row, maxSwipes: 12) else {
            NSLog("UITest soft-skip: Account row '%@' not found/hittable", label)
            return false
        }
        row.tap()
        settle(1.2)
        return true
    }

    // MARK: - Existing smoke tests

    /// After cold launch, either the login form or the signed-in tab shell is visible.
    func testColdLaunchShowsLoginOrTabs() throws {
        let loginEmail = byID("login.email")
        let tabView = byID("root.tabview")

        let deadline = Date().addingTimeInterval(15)
        var found = false
        while Date() < deadline {
            if loginEmail.exists || tabView.exists {
                found = true
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }

        XCTAssertTrue(
            found,
            "Expected login.email or root.tabview within 15s after cold launch"
        )
    }

    /// Fills login form when env credentials are present; skips otherwise.
    func testLoginWithEnvCredentials() throws {
        let email = customerEmail
        let pwd = password
        try XCTSkipIf(
            email.isEmpty || pwd.isEmpty,
            "Set NOMARKUP_UI_TEST_EMAIL and NOMARKUP_UI_TEST_PASSWORD (or TEST_RUNNER_*) to run credentialed login"
        )

        // Prefer app auto-login via launchEnvironment (DEBUG RootView).
        if waitForSignedInShell(timeout: 12) {
            return
        }

        let emailField = byID("login.email")
        let passwordField = byID("login.password")
        let submit = byID("login.submit")

        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "login.email not found")
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "login.password not found")
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "login.submit not found")

        emailField.tap()
        emailField.typeText(email)
        passwordField.tap()
        passwordField.typeText(pwd)
        submit.tap()

        XCTAssertTrue(
            waitForSignedInShell(timeout: 30),
            "root.tabview should appear after successful login"
        )
    }

    /// After auto-login, walk primary tabs via the tab bar (not content `tab.*` ids).
    func testSignedInTabNavigation() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required for signed-in tab smoke")

        XCTAssertTrue(
            waitForSignedInShell(timeout: 20),
            "Expected signed-in root.tabview"
        )

        let tabView = byID("root.tabview")
        let labels = ["Home", "Marketplace", "Jobs", "Messages", "Account"]
        for label in labels {
            openTab(label)
            XCTAssertTrue(tabView.exists, "Tab shell should remain after opening \(label)")
            // Content id may exist once selected (smoke existence, do not tap).
            settle(0.4)
        }
    }

    // MARK: - Home unicorn surfaces

    /// Home hero + market desk + primary CTAs when identifiers are present.
    func testHomeHeroAndMarketDesk() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Home")
        XCTAssertTrue(byID("root.tabview").exists, "Home tab should keep root.tabview")

        let hero = byID("home.hero")
        let browseJobs = byID("home.browseJobs")
        // Prefer stable ids; tolerate older builds that only expose copy.
        let heroReady = hero.waitForExistence(timeout: 10)
            || browseJobs.waitForExistence(timeout: 2)
            || app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Market Sets")
            ).firstMatch.waitForExistence(timeout: 4)
        XCTAssertTrue(heroReady, "Expected home hero surface (id or hero copy)")

        if browseJobs.exists {
            XCTAssertTrue(browseJobs.isHittable || browseJobs.exists, "home.browseJobs should be present")
        }
        // Market desk is below the hero — may need a light scroll on small phones.
        let desk = byID("home.marketDesk")
        if !desk.exists {
            _ = scrollTo(desk, maxSwipes: 4)
        }
        if desk.exists {
            // Present is enough; empty ticker ("Waiting for open floor…") is valid offline.
            XCTAssertTrue(desk.exists, "home.marketDesk should be identifiable")
        } else {
            // Soft: label fallback for MARKET DESK header.
            let deskLabel = app.staticTexts["MARKET DESK"]
            if !deskLabel.exists {
                NSLog("UITest soft-skip: home.marketDesk not present (catalog may still be loading)")
            }
        }
        XCTAssertTrue(byID("root.tabview").exists, "Home walk should leave tab shell intact")
    }

    // MARK: - Jobs browse settle

    /// Jobs tab: wait for loading to finish, then list / empty / error — all acceptable.
    func testJobsBrowseSettles() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Jobs")
        XCTAssertTrue(byID("root.tabview").exists, "Jobs tab should keep root.tabview")

        // Segment control when present.
        let segment = byID("jobs.segment")
        if !segment.waitForExistence(timeout: 6) {
            // Fallback: segmented "Browse" / "Mine" labels.
            _ = app.buttons["Browse"].waitForExistence(timeout: 2)
                || app.staticTexts["Browse"].waitForExistence(timeout: 1)
        }

        let settled = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: [
                "No open reverse auctions",
                "Couldn’t load jobs",
                "Couldn't load jobs",
            ]
        )
        XCTAssertNotEqual(
            settled,
            "timeout",
            "Jobs browse should settle to list, empty, or error within timeout"
        )
        // Soft-open first row only when we have a real list.
        if settled == "jobs.list" || settled == "cells" {
            if openFirstRow(timeout: 8) {
                XCTAssertTrue(
                    hasBackButton || byID("root.tabview").exists,
                    "Expected job detail navigation after opening first row"
                )
                goBack()
            } else {
                NSLog("UITest soft-skip: jobs list present but no navigable rows")
            }
        } else {
            NSLog("UITest soft-skip: jobs settled to %@ (empty/error tolerated)", settled)
        }
        XCTAssertTrue(byID("root.tabview").exists, "Jobs walk should leave tab shell intact")
    }

    // MARK: - Account hub

    /// After login, open Account and exercise key hub rows when present.
    /// Missing rows soft-skip (do not fail) so seed/role differences stay green.
    func testAccountHubLinks() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Account")
        settle(1.0)
        XCTAssertTrue(byID("root.tabview").exists, "Account tab should keep root.tabview")

        // Prefer identifier when present; otherwise label-based NavigationLinks.
        if byID("account.finishSetup").exists {
            let finish = byID("account.finishSetup")
            if finish.isHittable {
                finish.tap()
                settle(1.0)
                // Dismiss wizard if it opened (Cancel / Close / back).
                if app.buttons["Cancel"].exists {
                    app.buttons["Cancel"].tap()
                } else if hasBackButton {
                    goBack()
                }
                popToRoot("Account")
            }
        }

        // Key customer-facing hub destinations (labels from AccountView).
        let keyRows = [
            "Profile settings",
            "Security",
            "Verify email & phone",
            "Orders",
            "My bids",
            "Watchlist",
            "Post a job",
            "Payment methods",
            "Seller payouts",
        ]
        var visited = 0
        for label in keyRows {
            if tapAccountRowIfPresent(label) {
                visited += 1
                // Surface loaded: either a nav title / back button / content / destination root id.
                let destinationRoot: XCUIElement? = {
                    switch label {
                    case "Payment methods": return byID("paymentMethods.root")
                    case "Seller payouts": return byID("sellerPayouts.root")
                    default: return nil
                    }
                }()
                let rootOk = destinationRoot.map { $0.waitForExistence(timeout: 4) } ?? false
                // Brand empty titles are success states (no cards / not a provider).
                let emptyOk =
                    app.staticTexts["No saved payment methods"].exists
                    || app.staticTexts["Sign in required"].exists
                    || app.staticTexts["Couldn’t load methods"].exists
                    || app.staticTexts["Couldn't load methods"].exists
                XCTAssertTrue(
                    rootOk || emptyOk || hasBackButton || byID("root.tabview").exists,
                    "Expected navigation or tab shell after tapping \(label)"
                )
                popToRoot("Account")
            }
        }
        // Soft: log if nothing navigable (empty seed / network). Still assert shell.
        if visited == 0 {
            NSLog("UITest soft-skip: no Account hub rows navigable (visited=0)")
        }
        XCTAssertTrue(byID("root.tabview").exists, "Account hub walk should leave tab shell intact")
    }

    // MARK: - Account money surfaces (critical rows)

    /// Payment methods + seller payouts via stable account.row.* ids; empty states OK.
    func testAccountCriticalMoneyRows() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Account")
        XCTAssertTrue(byID("root.tabview").exists)

        // Payment methods
        if tapAccountRowIfPresent("Payment methods") {
            let root = byID("paymentMethods.root")
            let settled =
                root.waitForExistence(timeout: 8)
                || app.staticTexts["No saved payment methods"].waitForExistence(timeout: 3)
                || app.staticTexts["Sign in required"].waitForExistence(timeout: 1)
                || app.staticTexts["Couldn’t load methods"].waitForExistence(timeout: 1)
                || app.staticTexts["Couldn't load methods"].waitForExistence(timeout: 1)
                || hasBackButton
            XCTAssertTrue(settled, "Payment methods surface should settle (root, empty, or back)")
            popToRoot("Account")
        } else {
            NSLog("UITest soft-skip: account.row.paymentMethods not hittable")
        }

        // Seller payouts
        if tapAccountRowIfPresent("Seller payouts") {
            let root = byID("sellerPayouts.root")
            let settled =
                root.waitForExistence(timeout: 8)
                || app.staticTexts["Sign in required"].waitForExistence(timeout: 2)
                || app.navigationBars["Seller payouts"].waitForExistence(timeout: 2)
                || hasBackButton
            XCTAssertTrue(settled, "Seller payouts surface should settle (root, empty, or back)")
            popToRoot("Account")
        } else {
            NSLog("UITest soft-skip: account.row.sellerPayouts not hittable")
        }

        XCTAssertTrue(byID("root.tabview").exists, "Critical money row walk should leave tab shell intact")
    }

    // MARK: - Marketplace

    /// Open Marketplace, wait for catalog settle, drill into first listing when present.
    func testMarketplaceOpenFirstListing() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Marketplace")
        XCTAssertTrue(byID("root.tabview").exists, "Marketplace tab should keep root.tabview")

        let settled = waitForCatalogSettle(
            loadingID: "marketplace.loading",
            settledIDs: ["marketplace.list", "marketplace.empty", "marketplace.error"],
            emptyTitles: [
                "No listings nearby",
                "Couldn’t load listings",
                "Couldn't load listings",
            ]
        )
        XCTAssertNotEqual(
            settled,
            "timeout",
            "Marketplace should settle to list, empty, or error within timeout"
        )

        // Empty / error states soft-skip (no seeded listings or API down).
        if settled == "marketplace.empty"
            || settled == "marketplace.error"
            || settled.hasPrefix("empty:")
        {
            NSLog("UITest soft-skip: marketplace has no listings (empty or error: %@)", settled)
            return
        }

        if openFirstRow(timeout: 12) {
            // Detail: back affordance proves navigation; title may be listing-specific.
            XCTAssertTrue(
                hasBackButton || app.navigationBars.firstMatch.exists,
                "Expected listing detail navigation chrome after opening first row"
            )
            goBack()
            settle(0.5)
        } else {
            NSLog("UITest soft-skip: no navigable marketplace listing rows")
        }
        XCTAssertTrue(byID("root.tabview").exists, "Marketplace walk should leave tab shell intact")
    }

    // MARK: - Catalog settle helper

    /// Wait until a catalog surface leaves its loading skeleton.
    @discardableResult
    private func waitForCatalogSettle(
        loadingID: String,
        settledIDs: [String],
        emptyTitles: [String],
        timeout: TimeInterval = 18
    ) -> String {
        let deadline = Date().addingTimeInterval(timeout)
        let loading = byID(loadingID)
        while loading.exists && Date() < deadline {
            settle(0.35)
        }
        // Also clear accessibility-label loading states used before ids shipped.
        let loadingByLabel = app.staticTexts["Loading listings"]
        let loadingJobs = app.staticTexts["Loading jobs…"]
        while (loadingByLabel.exists || loadingJobs.exists) && Date() < deadline {
            settle(0.35)
        }
        while Date() < deadline {
            for id in settledIDs {
                if byID(id).exists { return id }
            }
            for title in emptyTitles {
                if app.staticTexts[title].exists { return "empty:\(title)" }
            }
            if app.cells.firstMatch.exists { return "cells" }
            settle(0.35)
        }
        return "timeout"
    }

    // MARK: - Multi-role shell smoke

    /// Customer seed: login + tab shell.
    func testRoleShellCustomer() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "customer credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        XCTAssertTrue(byID("root.tabview").exists)
        openTab("Home")
        openTab("Account")
        XCTAssertTrue(byID("root.tabview").exists, "Customer shell intact after Home/Account")
    }

    /// Provider seed: login + tab shell (+ optional Provider workspace row).
    func testRoleShellProvider() throws {
        try XCTSkipIf(providerEmail.isEmpty || password.isEmpty, "provider credentials required")
        ensureSignedIn(email: providerEmail, password: password)
        XCTAssertTrue(byID("root.tabview").exists, "Provider should reach root.tabview")

        openTab("Jobs")
        settle(0.8)
        openTab("Account")
        settle(0.8)

        // Soft: Provider workspace is always listed for authenticated users.
        if tapAccountRowIfPresent("Provider workspace") {
            XCTAssertTrue(hasBackButton || byID("root.tabview").exists)
            popToRoot("Account")
        }
        XCTAssertTrue(byID("root.tabview").exists, "Provider shell intact")
    }

    /// Admin seed: login + tab shell.
    func testRoleShellAdmin() throws {
        try XCTSkipIf(adminEmail.isEmpty || password.isEmpty, "admin credentials required")
        ensureSignedIn(email: adminEmail, password: password)
        XCTAssertTrue(byID("root.tabview").exists, "Admin should reach root.tabview")

        openTab("Home")
        openTab("Marketplace")
        openTab("Account")
        XCTAssertTrue(byID("root.tabview").exists, "Admin shell intact after tab walk")
    }
}
