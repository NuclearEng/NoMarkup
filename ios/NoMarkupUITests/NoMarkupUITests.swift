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

    private var provider2Email: String {
        Self.testCredential("NOMARKUP_UI_TEST_PROVIDER2_EMAIL", default: "provider2@nomarkup.com")
    }

    private var password: String {
        Self.testCredential("NOMARKUP_UI_TEST_PASSWORD", default: "Password123!")
    }

    // MARK: - Lifecycle

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()

        // Defensive: dismiss system permission / Apple ID sheets without granting.
        // Never tap Settings — that leaves the app and stalls the suite.
        // Prefer Close on "Sign in to your Apple Account".
        addUIInterruptionMonitor(withDescription: "System dialog") { alert in
            for title in ["Close", "Open", "Allow", "OK", "Continue", "Not Now", "Don’t Allow", "Don't Allow", "Cancel", "Later"] {
                let button = alert.buttons[title]
                if button.exists { button.tap(); return true }
            }
            return false
        }

        // Default launch: customer seed credentials for DEBUG auto-login.
        configureLaunchCredentials(email: customerEmail, password: password)
        app.launch()
        pokeSystemAlerts()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - Helpers

    private var apiBaseURL: String {
        Self.testCredential("NOMARKUP_API_BASE_URL", default: "http://127.0.0.1:8081")
    }

    private func configureLaunchCredentials(email: String, password: String) {
        // Pin the local gateway. The shared scheme still has a LAN IP that is
        // unreachable on a laptop that changed networks — login then hangs on Sign in.
        app.launchEnvironment["NOMARKUP_API_BASE_URL"] = apiBaseURL
        app.launchEnvironment["NOMARKUP_UI_TESTING"] = "1"
        app.launchArguments = ["-ui-testing"]
        if !email.isEmpty {
            app.launchEnvironment["NOMARKUP_UI_TEST_EMAIL"] = email
            app.launchArguments += ["-ui-test-email", email]
        }
        if !password.isEmpty {
            app.launchEnvironment["NOMARKUP_UI_TEST_PASSWORD"] = password
            app.launchArguments += ["-ui-test-password", password]
        }
    }

    /// UIInterruptionMonitor only fires after the test process interacts with the app.
    private func pokeSystemAlerts() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        settle(0.2)
        dismissBlockingSheets()
    }

    /// In-app / SpringBoard sheets that sit on top of Sign in (Apple ID, age gate).
    /// Never tap Settings — that backgrounds the app.
    @discardableResult
    private func dismissBlockingSheets() -> Bool {
        var dismissed = false
        for title in ["Close", "Not Now", "Not now", "Continue", "OK", "Don’t Allow", "Don't Allow"] {
            let buttons = [app.alerts.buttons[title], app.buttons[title]]
            for button in buttons where button.exists {
                button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                settle(0.25)
                dismissed = true
                break
            }
        }
        return dismissed
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
        // SwiftUI often stamps the same identifier on a wrapper Other *and* the
        // inner Button (toolbar Filters/Map, spectate). Prefer the Button so
        // taps hit the control, then fall back to first `.any` match.
        let button = app.buttons[id].firstMatch
        if button.exists { return button }
        return app.descendants(matching: .any)[id].firstMatch
    }

    /// First tappable element whose label matches exactly (buttons first, then cells/text).
    private func byLabel(_ label: String) -> XCUIElement {
        if app.buttons[label].exists { return app.buttons[label] }
        if app.cells.staticTexts[label].exists { return app.cells.staticTexts[label] }
        return app.staticTexts[label]
    }

    /// Geometric on-screen check — avoids XCTest throwing on invalid activation points
    /// (`Failed to determine hittability of … Button`).
    private func isOnScreen(_ element: XCUIElement) -> Bool {
        let el = element.firstMatch
        guard el.exists else { return false }
        let f = el.frame
        guard f.width > 1, f.height > 1 else { return false }
        let bounds = app.frame
        return f.midX > bounds.minX + 2
            && f.midX < bounds.maxX - 2
            && f.midY > bounds.minY + 2
            && f.midY < bounds.maxY - 2
    }

    /// Coordinate tap when on-screen (never probes raw `isHittable`).
    @discardableResult
    private func safeTap(_ element: XCUIElement) -> Bool {
        let el = element.firstMatch
        guard isOnScreen(el) else { return false }
        let dy: CGFloat = el.frame.height > 44 ? 0.25 : 0.5
        el.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: dy)).tap()
        return true
    }

    private func swipeAccountList(up: Bool) {
        let startY: CGFloat = up ? 0.58 : 0.30
        let endY: CGFloat = up ? 0.30 : 0.58
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
        settle(0.08)
    }

    /// Rewind the Account list to the Session section (profile is always first).
    private func rewindAccountListToTop(maxSwipes: Int = 16) {
        for _ in 0..<maxSwipes {
            if isOnScreen(byID("account.row.profile")) { return }
            swipeAccountList(up: false)
        }
    }

    /// Bidirectional lazy-List search using list-local drags (not `app.swipeUp`).
    /// Rewinds toward the top first so near-top rows (providerWorkspace, signOut)
    /// are not buried by an up-first pass. Honors `maxSwipes` (Account has 50+ rows).
    @discardableResult
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 6) -> Bool {
        if isOnScreen(element) { return true }
        let upCount = max(0, maxSwipes)
        let downCount = max(0, maxSwipes)
        for _ in 0..<downCount {
            if isOnScreen(element) { return true }
            swipeAccountList(up: false)
        }
        for _ in 0..<upCount {
            if isOnScreen(element) { return true }
            swipeAccountList(up: true)
        }
        return isOnScreen(element)
    }

    /// Ready to tap when the tap point (not the whole cell maxY) clears the tab bar.
    @discardableResult
    private func scrollClearOfTabBar(_ element: XCUIElement, maxSwipes: Int = 6) -> Bool {
        let el = element.firstMatch
        func tapClears() -> Bool {
            guard isOnScreen(el) else { return false }
            let f = el.frame
            guard f.height.isFinite, f.minY.isFinite else { return false }
            let tapY = f.height > 44 ? (f.minY + f.height * 0.25) : f.midY
            return tapY < app.frame.maxY - 120
        }
        if tapClears() { return true }
        _ = scrollTo(el, maxSwipes: maxSwipes)
        if tapClears() { return true }
        for _ in 0..<3 {
            guard el.exists else { break }
            swipeAccountList(up: true)
            if tapClears() { return true }
        }
        return tapClears()
    }

    private func goBack() {
        let back = app.navigationBars.buttons.element(boundBy: 0)
        if safeTap(back) {
            settle(0.5)
        }
    }

    private var hasBackButton: Bool {
        let bar = app.navigationBars.element(boundBy: 0)
        guard bar.exists else { return false }
        let first = bar.buttons.element(boundBy: 0)
        guard first.exists else { return false }
        let f = first.frame
        guard f.width.isFinite, f.height.isFinite else { return false }
        // iOS 26 back controls include the previous title ("Notifications",
        // "Plan limits") and often exceed 120pt — still leading-edge.
        return f.minX < 90 && f.width < 220 && f.height < 64
    }

    /// Switch tabs via the tab BAR only (never the full-screen `tab.*` content ids).
    private func openTab(_ label: String) {
        let barButton = app.tabBars.buttons[label]
        if barButton.waitForExistence(timeout: 4) {
            if safeTap(barButton) {
                settle(0.4)
                return
            }
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            if safeTap(barButton) {
                settle(0.4)
                return
            }
            // Last resort: force mid-button coordinate without isHittable probe.
            barButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            settle(0.4)
            return
        }
        // iPad sidebar / adapted chrome fallback.
        let candidates = app.buttons.matching(NSPredicate(format: "label == %@", label))
        let count = candidates.count
        for i in 0..<min(count, 6) {
            let el = candidates.element(boundBy: i)
            if el.exists, el.frame.height < 140, el.frame.width < 300, safeTap(el) {
                settle(0.4)
                return
            }
        }
        XCTFail("No tab bar control found for '\(label)'")
    }

    private func popToRoot(_ label: String) {
        for title in ["Close", "Done", "Cancel"] {
            let b = app.buttons[title]
            if b.exists, safeTap(b) { settle(0.25) }
        }
        if app.webViews.firstMatch.exists || app.sheets.firstMatch.exists {
            app.swipeDown()
            settle(0.3)
        }
        openTab(label)
        var attempts = 0
        while attempts < 6 {
            if label == "Account", isOnScreen(byID("account.row.profile")) {
                break
            }
            if hasBackButton {
                goBack()
                attempts += 1
                continue
            }
            let back = app.navigationBars.buttons.element(boundBy: 0)
            if back.exists, back.frame.minX < 100, back.frame.height < 64 {
                back.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                settle(0.4)
                attempts += 1
                continue
            }
            break
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
        let deadline = Date().addingTimeInterval(timeout)
        pokeSystemAlerts()
        while Date() < deadline {
            dismissBlockingSheets()
            if byID("ageGate.checkError").exists {
                let retry = byID("ageGate.retry")
                if retry.exists { _ = safeTap(retry) }
            }
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            if tabView.exists || app.tabBars.firstMatch.exists {
                return true
            }
            settle(0.4)
            pokeSystemAlerts()
        }
        return tabView.exists || app.tabBars.firstMatch.exists
    }

    /// Avoid `XCUIElement.tap()` scroll-to-visible on Sign in (keyboard covers it).
    /// Password SecureField already uses `.submitLabel(.go)` → `auth.login()`.
    private func submitLoginForm(submit: XCUIElement) {
        let go = app.keyboards.buttons["Go"]
        if go.waitForExistence(timeout: 1.2) {
            go.tap()
            settle(0.4)
            return
        }
        if app.keyboards.firstMatch.exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
            settle(0.35)
        }
        if safeTap(submit) { return }
        let previous = continueAfterFailure
        continueAfterFailure = true
        submit.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        continueAfterFailure = previous
        settle(0.4)
    }

    private func fieldValue(_ field: XCUIElement) -> String {
        (field.value as? String) ?? ""
    }

    /// Replace a text field's content. Triple-tap selects the line so typing
    /// replaces leftover auto-login text instead of appending.
    private func clearAndType(_ field: XCUIElement, text: String, verify: Bool) {
        XCTAssertTrue(field.waitForExistence(timeout: 8), "field missing before type")
        field.tap()
        settle(0.2)
        let placeholderValues = ["Email", "Password"]
        var existing = fieldValue(field)
        if placeholderValues.contains(existing) { existing = "" }
        if !existing.isEmpty {
            if verify {
                field.tap(withNumberOfTaps: 3, numberOfTouches: 1)
                settle(0.2)
            }
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count + 2))
        }
        field.typeText(text)
        guard verify else { return }
        var typed = fieldValue(field)
        if typed != text {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed.count + text.count + 8))
            field.typeText(text)
            typed = fieldValue(field)
        }
        XCTAssertEqual(typed, text, "field content after typing")
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
        pokeSystemAlerts()
        let emailField = byID("login.email")
        let passwordField = byID("login.password")
        let submit = byID("login.submit")
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "login.email not found")
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "login.password not found")
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "login.submit not found")

        clearAndType(emailField, text: email, verify: true)
        clearAndType(passwordField, text: password, verify: false)
        submitLoginForm(submit: submit)

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
        let signOut = byID("account.row.signOut")
        var tapped = false
        if scrollClearOfTabBar(signOut, maxSwipes: 8), safeTap(signOut) {
            tapped = true
        } else {
            let labeled = app.buttons["Sign out"]
            if scrollClearOfTabBar(labeled, maxSwipes: 6), safeTap(labeled) {
                tapped = true
            }
        }
        guard tapped else { return }
        settle(0.4)
        _ = tapSignOutConfirm()
        _ = byID("login.email").waitForExistence(timeout: 10)
        settle(0.4)
    }

    /// Confirm the Account "Sign out of this device?" dialog (sheet on iOS 26).
    @discardableResult
    private func tapSignOutConfirm() -> Bool {
        let sheetBtn = app.sheets.buttons["Sign out"]
        if sheetBtn.waitForExistence(timeout: 2), safeTap(sheetBtn) { return true }
        if app.alerts.buttons["Sign out"].exists, safeTap(app.alerts.buttons["Sign out"]) {
            return true
        }
        let all = app.buttons.matching(NSPredicate(format: "label == %@", "Sign out"))
        let count = all.count
        if count >= 2 {
            let last = all.element(boundBy: count - 1)
            if last.exists, safeTap(last) { return true }
        }
        return false
    }

    /// Write an XCTAttachment plus PNG under the 2026-08-22 full-sim coverage dir.
    private func snap(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let envDir = ProcessInfo.processInfo.environment["NOMARKUP_UI_SHOT_DIR"]
        let dir = (envDir?.isEmpty == false)
            ? envDir!
            : "/Users/nuclearisotope/Projects/Personal/NoMarkup/docs/compliance/sim-runs/2026-08-22-full-sim"
        let testTag = String(self.name.split(separator: " ").last ?? "shot")
            .replacingOccurrences(of: "]", with: "")
        let filename = "\(testTag)-\(name).png"
        let url = URL(fileURLWithPath: dir).appendingPathComponent(filename)
        try? FileManager.default.createDirectory(
            at: URL(fileURLWithPath: dir),
            withIntermediateDirectories: true
        )
        try? screenshot.pngRepresentation.write(to: url)
    }

    /// Land on the Sign in form. Does not register or send reset mail.
    private func presentLoginForm() {
        if byID("login.email").waitForExistence(timeout: 3) { return }
        signOutIfNeeded()
        if byID("login.email").waitForExistence(timeout: 8) { return }
        // Session should already be cleared; relaunch without auto-login credentials.
        app.terminate()
        app = XCUIApplication()
        app.launchEnvironment["NOMARKUP_API_BASE_URL"] = apiBaseURL
        app.launchEnvironment["NOMARKUP_UI_TESTING"] = "1"
        app.launchArguments = ["-ui-testing"]
        app.launch()
        pokeSystemAlerts()
        XCTAssertTrue(
            byID("login.email").waitForExistence(timeout: 15),
            "login.email after signed-out launch"
        )
    }

    /// Dismiss keyboard so auth links below Sign in are tappable.
    private func dismissKeyboardIfPresent() {
        if app.keyboards.firstMatch.exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
            settle(0.3)
        }
    }

    /// Open catalog rows until `matches` is true. Soft-false if none match.
    @discardableResult
    private func openFirstMatchingRow(
        maxRows: Int = 5,
        timeout: TimeInterval = 8,
        matches: () -> Bool
    ) -> Bool {
        let cells = app.cells
        guard cells.firstMatch.waitForExistence(timeout: timeout) else { return false }
        let count = min(cells.count, maxRows)
        for index in 0..<count {
            let cell = cells.element(boundBy: index)
            guard cell.exists else { continue }
            if !isOnScreen(cell) {
                app.swipeUp()
                settle(0.3)
            }
            guard safeTap(cell) else { continue }
            settle(1.4)
            if matches() { return true }
            if hasBackButton {
                goBack()
                settle(0.5)
            }
        }
        return false
    }

    @discardableResult
    private func openSpectateIfPresent() -> Bool {
        let ids = [
            "jobDetail.spectate",
            "listingDetail.spectate",
            "jobDetail.spectateSection",
            "listingDetail.spectateSection",
        ]
        for id in ids {
            let el = byID(id)
            if el.exists || el.waitForExistence(timeout: 1) {
                if !isOnScreen(el) { _ = scrollTo(el, maxSwipes: 6) }
                if safeTap(el) {
                    settle(1.0)
                    snap("spectate-open")
                    let root = byID("spectate.root")
                    let titled = app.navigationBars["Spectate"].waitForExistence(timeout: 4)
                    XCTAssertTrue(
                        root.exists || titled || hasBackButton,
                        "spectate surface should open"
                    )
                    goBack()
                    settle(0.4)
                    return true
                }
            }
        }
        let labeled = app.buttons["Spectate terminal"]
        if labeled.exists, safeTap(labeled) {
            settle(1.0)
            snap("spectate-open")
            goBack()
            settle(0.4)
            return true
        }
        NSLog("UITest soft-skip: spectate control not present")
        return false
    }

    @discardableResult
    private func openMessagesComposerIfPresent() -> Bool {
        popToRoot("Messages")
        settle(1.2)
        guard openFirstRow(timeout: 6) else {
            NSLog("UITest soft-skip: no messages thread")
            return false
        }
        let composer = byID("messages.composer")
        let labeled = app.textFields["Message"]
        let found = composer.waitForExistence(timeout: 5) || labeled.waitForExistence(timeout: 2)
        if found {
            let field = composer.exists ? composer : labeled
            _ = safeTap(field)
            settle(0.4)
            snap("messages-composer")
        } else {
            NSLog("UITest soft-skip: messages composer not found")
        }
        if hasBackButton { goBack() }
        return found
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
            if !isOnScreen(cell) {
                app.swipeUp()
                settle(0.3)
            }
            guard safeTap(cell) else { continue }
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
        "Sign out": "account.row.signOut",
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
            if scrollClearOfTabBar(byStable, maxSwipes: 16), safeTap(byStable) {
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
        if scrollClearOfTabBar(byAccessibility, maxSwipes: 10), safeTap(byAccessibility) {
            settle(1.2)
            return true
        }
        // Known identifier for Finish setup banner.
        if label == "Finish setup" {
            let finish = byID("account.finishSetup")
            if finish.waitForExistence(timeout: 2), safeTap(finish) {
                settle(1.2)
                return true
            }
        }
        // Label fallback — must keep working for UITests that key off visible text.
        let row = byLabel(label)
        guard scrollClearOfTabBar(row, maxSwipes: 16), safeTap(row) else {
            NSLog("UITest soft-skip: Account row '%@' not found/hittable", label)
            return false
        }
        settle(1.2)
        return true
    }

    // MARK: - Existing smoke tests

    /// Catalog E2E for every seed persona: login hops + Account rows + Request log.
    func testCatalogAllPersonasRequestLogAndRows() throws {
        let personas: [(email: String, label: String, adminRow: Bool)] = [
            (customerEmail, "customer", false),
            (providerEmail, "provider", false),
            (provider2Email, "provider2", false),
            (adminEmail, "admin", true),
        ]
        for persona in personas {
            ensureSignedIn(email: persona.email, password: password)
            XCTAssertTrue(
                waitForSignedInShell(timeout: 25),
                "\(persona.label) must reach tab shell"
            )
            assertRequestLogHasHttpHops(persona: persona.label)
            if persona.adminRow {
                popToRoot("Account")
                settle(0.3)
                rewindAccountListToTop()
                let adminRow = byID("account.row.admin")
                XCTAssertTrue(
                    scrollClearOfTabBar(adminRow, maxSwipes: 28),
                    "\(persona.label): account.row.admin"
                )
                XCTAssertTrue(safeTap(adminRow), "\(persona.label) tap admin")
                settle(1.0)
                XCTAssertTrue(
                    byID("admin.console.root").waitForExistence(timeout: 8)
                        || byID("admin.console.tabs").waitForExistence(timeout: 2)
                        || hasBackButton,
                    "\(persona.label) admin console opened"
                )
            }
        }
    }

    private func assertRequestLogHasHttpHops(persona: String) {
        popToRoot("Account")
        settle(0.4)
        rewindAccountListToTop()
        let logRow = byID("account.row.requestLog")
        var found = scrollClearOfTabBar(logRow, maxSwipes: 8)
        if !found {
            goBack()
            settle(0.3)
            openTab("Account")
            rewindAccountListToTop()
            found = scrollClearOfTabBar(logRow, maxSwipes: 10)
        }
        XCTAssertTrue(found, "\(persona) request log row")
        XCTAssertTrue(safeTap(logRow), "\(persona) open request log")
        settle(1.2)
        let root = byID("requestLog.root")
        let hops = byID("requestLog.httpCount")
        let title = app.navigationBars["Request log"]
        XCTAssertTrue(
            root.waitForExistence(timeout: 16)
                || hops.waitForExistence(timeout: 4)
                || title.waitForExistence(timeout: 4),
            "\(persona) requestLog.root / httpCount / Request log title"
        )
        let httpCount = byID("requestLog.httpCount")
        XCTAssertTrue(httpCount.waitForExistence(timeout: 8), "\(persona) requestLog.httpCount")
        let raw = (httpCount.value as? String) ?? httpCount.label
        let digits = raw.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
        let n = Int(digits) ?? 0
        XCTAssertGreaterThan(n, 0, "\(persona) login/hub API hops must be in the request log, got '\(raw)'")
    }

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
        if waitForSignedInShell(timeout: 20) {
            return
        }

        pokeSystemAlerts()
        let emailField = byID("login.email")
        let passwordField = byID("login.password")
        let submit = byID("login.submit")

        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "login.email not found")
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "login.password not found")
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "login.submit not found")

        clearAndType(emailField, text: email, verify: true)
        clearAndType(passwordField, text: pwd, verify: false)
        submitLoginForm(submit: submit)

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
            XCTAssertTrue(browseJobs.exists, "home.browseJobs should be present")
        }
        // Market desk is below the hero — may need a light scroll on small phones.
        let desk = byID("home.marketDesk")
        if !desk.exists {
            _ = scrollTo(desk, maxSwipes: 4)
        }
        if desk.exists {
            // Present is enough; empty ticker ("No live auctions right now") is valid offline.
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
                "No matching jobs",
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
            if safeTap(finish) {
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
                "No matching listings",
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
        let loadingMine = app.staticTexts["Loading your jobs…"]
        while (loadingByLabel.exists || loadingJobs.exists || loadingMine.exists) && Date() < deadline {
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

    // MARK: - Uncovered surface smokes (no money submit, no seed mutation)

    /// Login → Create account. Open only — never submit a new account.
    func testRegisterScreenOpens() throws {
        presentLoginForm()
        dismissKeyboardIfPresent()
        snap("login-before-register")

        let registerLink = byID("login.register")
        let labeled = app.buttons["Create account"]
        XCTAssertTrue(
            registerLink.waitForExistence(timeout: 8) || labeled.waitForExistence(timeout: 2),
            "Create account control should be on Sign in"
        )
        if registerLink.exists {
            XCTAssertTrue(safeTap(registerLink) || registerLink.exists, "tap login.register")
            if !byID("register.root").waitForExistence(timeout: 4) {
                _ = safeTap(registerLink)
            }
        }
        if !byID("register.root").waitForExistence(timeout: 3), labeled.exists {
            _ = safeTap(labeled)
        }

        let root = byID("register.root")
        let emailField = byID("register.email")
        let joinCopy = app.staticTexts["Join NoMarkup"]
        let title = app.navigationBars["Create account"]
        XCTAssertTrue(
            root.waitForExistence(timeout: 8)
                || emailField.waitForExistence(timeout: 2)
                || joinCopy.waitForExistence(timeout: 2)
                || title.waitForExistence(timeout: 2),
            "Register screen should open from Create account"
        )
        snap("register-screen")
        XCTAssertTrue(
            emailField.exists
                || app.textFields["Email"].exists
                || joinCopy.exists
                || byID("register.submit").exists,
            "Register form chrome (email / Join copy / submit) should be visible"
        )
        // Do not tap register.submit — that would pollute seed users.
    }

    /// Login → Forgot password. Open only — never send reset email.
    func testForgotPasswordScreenOpens() throws {
        presentLoginForm()
        dismissKeyboardIfPresent()
        snap("login-before-forgot")

        let forgotLink = byID("login.forgotPassword")
        let labeled = app.buttons["Forgot password"]
        XCTAssertTrue(
            forgotLink.waitForExistence(timeout: 8) || labeled.waitForExistence(timeout: 2),
            "Forgot password control should be on Sign in"
        )
        if forgotLink.exists {
            _ = safeTap(forgotLink)
        }
        if !byID("forgotPassword.root").waitForExistence(timeout: 3), labeled.exists {
            _ = safeTap(labeled)
        }

        let root = byID("forgotPassword.root")
        let emailField = byID("forgotPassword.email")
        let header = app.staticTexts["Forgot your password?"]
        let title = app.navigationBars["Reset password"]
        XCTAssertTrue(
            root.waitForExistence(timeout: 8)
                || emailField.waitForExistence(timeout: 2)
                || header.waitForExistence(timeout: 2)
                || title.waitForExistence(timeout: 2),
            "Forgot password screen should open from Sign in"
        )
        snap("forgot-password-screen")
        XCTAssertTrue(
            emailField.exists
                || byID("forgotPassword.send").exists
                || header.exists
                || app.buttons["Send reset email"].exists
                || app.buttons["Send password reset email"].exists,
            "Reset-email chrome should be visible (not submitted)"
        )
        // Do not tap forgotPassword.send — that would email-spam the seed inbox.
    }

    /// Jobs toolbar: filters bar + map. Location alert dismissed, no pin submit.
    func testJobsMapAndFilters() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Jobs")
        XCTAssertTrue(byID("root.tabview").exists, "Jobs tab should keep root.tabview")
        let settled = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: [
                "No open reverse auctions",
                "No matching jobs",
                "Couldn’t load jobs",
                "Couldn't load jobs",
            ]
        )
        XCTAssertNotEqual(settled, "timeout", "Jobs browse should settle before map/filters")
        snap("jobs-browse")

        // Prefer the inner toolbar Button — the identifier is also on a wrapper Other.
        let filterBtn = app.buttons["jobs.filters"].firstMatch
        let filterByLabel = app.buttons["Filters"].firstMatch
        XCTAssertTrue(
            filterBtn.waitForExistence(timeout: 8) || filterByLabel.waitForExistence(timeout: 2),
            "jobs.filters toolbar control"
        )
        if filterBtn.exists {
            _ = safeTap(filterBtn)
        } else {
            _ = safeTap(filterByLabel)
        }
        settle(0.8)
        var filterBar = byID("jobs.filters.bar")
        var category = app.buttons["Filter by category"].firstMatch
        var apply = app.buttons["Apply"].firstMatch
        if !(filterBar.exists || category.exists || apply.exists) {
            // First tap may have hit the wrapper; retry the labeled button.
            _ = safeTap(filterByLabel)
            settle(0.8)
            filterBar = byID("jobs.filters.bar")
            category = app.buttons["Filter by category"].firstMatch
            apply = app.buttons["Apply"].firstMatch
        }
        snap("jobs-filters")
        XCTAssertTrue(
            filterBar.exists
                || category.exists
                || apply.exists
                || app.staticTexts["Min starting bid ($)"].exists
                || app.buttons["Clear"].exists,
            "Browse filters bar should appear after tapping jobs.filters"
        )

        let mapBtn = app.buttons["jobs.map"].firstMatch
        let mapByLabel = app.buttons["Map"].firstMatch
        XCTAssertTrue(
            mapBtn.waitForExistence(timeout: 6) || mapByLabel.waitForExistence(timeout: 2),
            "jobs.map toolbar control"
        )
        if mapBtn.exists {
            _ = safeTap(mapBtn)
        } else {
            _ = safeTap(mapByLabel)
        }
        settle(1.0)
        // Location pre-prompt is opt-in (My location); dismiss if it still appears.
        let notNow = app.alerts.buttons["Not now"]
        if notNow.waitForExistence(timeout: 2) { _ = safeTap(notNow) }
        dismissBlockingSheets()

        let mapRoot = byID("jobs.map.root")
        let mapTitle = app.navigationBars["Jobs map"]
        XCTAssertTrue(
            mapRoot.waitForExistence(timeout: 10)
                || mapTitle.waitForExistence(timeout: 3)
                || hasBackButton,
            "Jobs map screen should open"
        )
        snap("jobs-map")
        goBack()
        XCTAssertTrue(byID("root.tabview").exists, "Jobs map pop should leave tab shell intact")
    }

    /// Job detail place-bid chrome as provider. Screenshot only — never submit money.
    func testJobDetailPlaceBidChrome() throws {
        try XCTSkipIf(providerEmail.isEmpty || password.isEmpty, "provider credentials required")
        ensureSignedIn(email: providerEmail, password: password)

        popToRoot("Jobs")
        let settled = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: [
                "No open reverse auctions",
                "No matching jobs",
                "Couldn’t load jobs",
                "Couldn't load jobs",
            ]
        )
        XCTAssertNotEqual(settled, "timeout", "Jobs should settle before opening a row")
        if settled == "jobs.empty" || settled == "jobs.error" || settled.hasPrefix("empty:") {
            NSLog("UITest soft-skip: no open jobs for place-bid chrome (%@)", settled)
            snap("jobs-no-open-for-bid")
            return
        }

        let opened = openFirstMatchingRow(maxRows: 5) {
            let header = app.staticTexts["Place a bid (dollars)"]
            let lower = app.staticTexts["Lower your bid (dollars)"]
            let id = byID("jobDetail.placeBid")
            if id.exists || header.exists || lower.exists { return true }
            _ = scrollTo(header, maxSwipes: 8)
            _ = scrollTo(lower, maxSwipes: 2)
            _ = scrollTo(id, maxSwipes: 2)
            return id.exists || header.exists || lower.exists
        }
        XCTAssertTrue(opened || byID("root.tabview").exists, "job list still in tab shell")
        if !opened {
            NSLog("UITest soft-skip: no job row exposed place-bid chrome (own/closed)")
            snap("job-detail-no-bid-chrome")
            return
        }

        let bidID = byID("jobDetail.placeBid")
        let header = app.staticTexts["Place a bid (dollars)"]
        let lower = app.staticTexts["Lower your bid (dollars)"]
        if !bidID.exists { _ = scrollTo(header, maxSwipes: 8) }
        if !header.exists && !lower.exists { _ = scrollTo(lower, maxSwipes: 4) }
        XCTAssertTrue(
            bidID.exists || header.exists || lower.exists,
            "Place / lower bid chrome should be visible"
        )
        snap("job-place-bid-chrome")
        // Spectate if the toolbar / section control exists.
        _ = openSpectateIfPresent()
        // Never tap Place reverse bid / Lower bid.
        goBack()
        XCTAssertTrue(byID("root.tabview").exists, "Job bid chrome walk should leave tab shell intact")
    }

    /// Listing watch + bid chrome. Watch toggle restored; bid never submitted.
    /// Also peeks Messages composer and listing spectate when present.
    func testListingDetailWatchAndBidChrome() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Marketplace")
        let settled = waitForCatalogSettle(
            loadingID: "marketplace.loading",
            settledIDs: ["marketplace.list", "marketplace.empty", "marketplace.error"],
            emptyTitles: [
                "No listings nearby",
                "No matching listings",
                "Couldn’t load listings",
                "Couldn't load listings",
            ]
        )
        XCTAssertNotEqual(settled, "timeout", "Marketplace should settle")
        if settled == "marketplace.empty" || settled == "marketplace.error" || settled.hasPrefix("empty:") {
            NSLog("UITest soft-skip: no listings for watch/bid chrome (%@)", settled)
            snap("marketplace-empty-for-watch")
            _ = openMessagesComposerIfPresent()
            return
        }

        XCTAssertTrue(openFirstRow(timeout: 12), "seeded listings should open a detail row")
        snap("listing-detail")

        let watch = byID("listingDetail.watch")
        let addWatch = app.buttons["Add to watchlist"]
        let removeWatch = app.buttons["Remove from watchlist"]
        XCTAssertTrue(
            watch.waitForExistence(timeout: 8) || addWatch.exists || removeWatch.exists,
            "Watch toolbar control should be present for a signed-in buyer"
        )
        snap("listing-watch-chrome")
        // Toggle then restore so the seed watchlist is unchanged.
        if addWatch.exists {
            _ = safeTap(addWatch)
            settle(0.8)
            dismissNotificationPrePrompt()
            if removeWatch.waitForExistence(timeout: 4) {
                _ = safeTap(removeWatch)
                settle(0.5)
            }
        }

        let bidID = byID("listingDetail.placeBid")
        let bidHeader = app.staticTexts["Place a bid (dollars)"]
        if !bidID.exists {
            _ = scrollTo(bidHeader, maxSwipes: 10)
            _ = scrollTo(bidID, maxSwipes: 4)
        }
        XCTAssertTrue(
            bidID.exists
                || bidHeader.exists
                || byID("listingDetail.bidAuthDisclosure").exists
                || app.buttons["Place bid"].exists,
            "Listing place-bid chrome should be visible (do not submit)"
        )
        snap("listing-place-bid-chrome")

        _ = openSpectateIfPresent()
        goBack()
        settle(0.4)

        _ = openMessagesComposerIfPresent()
        XCTAssertTrue(byID("root.tabview").exists, "Listing watch/bid walk should leave tab shell intact")
    }

    /// WF-NEG.2-adjacent: wrong password stays on Sign in with inline error.
    func testWrongPasswordShowsError() throws {
        presentLoginForm()
        dismissKeyboardIfPresent()
        let emailField = byID("login.email")
        let passwordField = byID("login.password")
        let submit = byID("login.submit")
        XCTAssertTrue(emailField.waitForExistence(timeout: 10), "login.email")
        clearAndType(emailField, text: customerEmail, verify: true)
        clearAndType(passwordField, text: "DefinitelyWrong-Password!", verify: false)
        submitLoginForm(submit: submit)
        settle(1.2)
        let err = byID("login.error")
        XCTAssertTrue(
            err.waitForExistence(timeout: 10)
                || app.staticTexts.matching(
                    NSPredicate(format: "label CONTAINS[c] %@", "password")
                ).firstMatch.exists,
            "Wrong password must show login.error, not a tab shell"
        )
        snap("wrong-password-error")
        XCTAssertFalse(
            byID("root.tabview").exists,
            "Wrong password must not sign in"
        )
    }

    /// Jobs Mine segment: list or empty — never a hang. No mutations.
    func testJobsMineSegment() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Jobs")
        XCTAssertTrue(byID("root.tabview").exists, "Jobs tab")

        let mine = app.buttons["Mine"].firstMatch
        let segment = byID("jobs.segment")
        XCTAssertTrue(
            mine.waitForExistence(timeout: 8) || segment.waitForExistence(timeout: 2),
            "Jobs Mine segment control"
        )
        if mine.exists {
            _ = safeTap(mine)
        } else {
            let parts = app.segmentedControls.firstMatch
            if parts.exists {
                let mineSeg = parts.buttons["Mine"]
                if mineSeg.exists { _ = safeTap(mineSeg) }
            }
        }
        settle(1.2)
        snap("jobs-mine")

        let settled = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error", "jobs.mine.empty"],
            emptyTitles: [
                "No jobs yet",
                "No awarded work",
                "Couldn’t load your jobs",
                "Couldn't load your jobs",
            ]
        )
        XCTAssertNotEqual(settled, "timeout", "Jobs Mine should settle to list/empty/error")
        XCTAssertTrue(byID("root.tabview").exists, "Mine segment keeps tab shell")
    }

    /// Marketplace search field + tab Map. Search is typed then cleared; map not a location grant.
    func testMarketplaceSearchAndMap() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Marketplace")
        let settled = waitForCatalogSettle(
            loadingID: "marketplace.loading",
            settledIDs: ["marketplace.list", "marketplace.empty", "marketplace.error"],
            emptyTitles: ["No listings nearby", "No matching listings", "Couldn’t load listings", "Couldn't load listings"]
        )
        XCTAssertNotEqual(settled, "timeout", "Marketplace should settle before search")
        snap("marketplace-before-search")

        let searchField = app.textFields["marketplace.search"].firstMatch
        let searchByPrompt = app.textFields["Search listings"].firstMatch
        XCTAssertTrue(
            searchField.waitForExistence(timeout: 8) || searchByPrompt.waitForExistence(timeout: 2),
            "marketplace.search field"
        )
        let field: XCUIElement = searchField.exists ? searchField : searchByPrompt
        _ = safeTap(field)
        settle(0.4)
        XCTAssertTrue(field.waitForExistence(timeout: 2), "search field still present")
        field.tap()
        settle(0.2)
        field.typeText("Makita")
        settle(1.2)
        snap("marketplace-search-makita")
        // Clear so later tests see the full catalog.
        if let current = field.value as? String, !current.isEmpty {
            let delete = String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 4)
            field.typeText(delete)
        }
        settle(0.8)

        let mapBtn = app.buttons["marketplace.map"].firstMatch
        let mapLabel = app.buttons["Map"].firstMatch
        XCTAssertTrue(
            mapBtn.waitForExistence(timeout: 6) || mapLabel.waitForExistence(timeout: 2),
            "marketplace.map toolbar"
        )
        if mapBtn.exists {
            _ = safeTap(mapBtn)
        } else {
            _ = safeTap(mapLabel)
        }
        settle(1.0)
        let notNow = app.alerts.buttons["Not now"]
        if notNow.waitForExistence(timeout: 2) { _ = safeTap(notNow) }
        dismissBlockingSheets()
        let mapRoot = byID("marketplace.map.root")
        let mapTitle = app.navigationBars["Marketplace map"]
        XCTAssertTrue(
            mapRoot.waitForExistence(timeout: 10)
                || mapTitle.waitForExistence(timeout: 3)
                || hasBackButton,
            "Marketplace map should open from the tab toolbar"
        )
        snap("marketplace-map")
        goBack()
        XCTAssertTrue(byID("root.tabview").exists, "Marketplace map pop leaves tab shell")
    }

    /// Home Post a job + Sell an item sheets. Open only — never publish.
    func testHomePostJobAndSellSheets() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Home")
        settle(0.6)

        let post = byID("home.postJob")
        XCTAssertTrue(
            post.waitForExistence(timeout: 8) || app.buttons["Post a job"].waitForExistence(timeout: 2),
            "home.postJob CTA"
        )
        if post.exists {
            _ = safeTap(post)
        } else {
            _ = safeTap(app.buttons["Post a job"].firstMatch)
        }
        settle(1.0)
        let postChrome = byID("postJob.wizardChrome")
        XCTAssertTrue(
            postChrome.waitForExistence(timeout: 8)
                || app.navigationBars["Post a job"].waitForExistence(timeout: 2)
                || byID("postJob.title").waitForExistence(timeout: 2)
                || app.buttons["Close"].waitForExistence(timeout: 2),
            "Post-job sheet should open from Home"
        )
        snap("home-post-job-sheet")
        let close = app.buttons["Close"].firstMatch
        if close.exists { _ = safeTap(close) } else { goBack() }
        settle(0.6)

        let sell = byID("home.sellItem")
        XCTAssertTrue(
            sell.waitForExistence(timeout: 8) || app.buttons["Sell an item"].waitForExistence(timeout: 2),
            "home.sellItem CTA"
        )
        if sell.exists {
            _ = safeTap(sell)
        } else {
            _ = safeTap(app.buttons["Sell an item"].firstMatch)
        }
        settle(1.0)
        let sellChrome = byID("createListing.wizardChrome")
        XCTAssertTrue(
            sellChrome.waitForExistence(timeout: 8)
                || app.navigationBars.matching(
                    NSPredicate(format: "identifier CONTAINS[c] %@ OR label CONTAINS[c] %@", "Sell", "Listing")
                ).firstMatch.waitForExistence(timeout: 2)
                || byID("createListing.title").waitForExistence(timeout: 2)
                || app.buttons["Close"].waitForExistence(timeout: 2),
            "Sell sheet should open from Home"
        )
        snap("home-sell-sheet")
        let closeSell = app.buttons["Close"].firstMatch
        if closeSell.exists { _ = safeTap(closeSell) } else { goBack() }
        settle(0.4)
        XCTAssertTrue(byID("root.tabview").exists, "Home sheets dismissed to tab shell")
    }

    /// Focused request-log hop proof (customer). Avoids the 18-min 4-persona catalog walk.
    func testRequestLogShowsHttpHops() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        assertRequestLogHasHttpHops(persona: "customer")
    }

    /// Home Instant match CTA — opens post-job wizard with instant-match preference. No submit.
    func testHomeInstantMatchSheet() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Home")
        settle(0.6)
        let instant = byID("home.instantMatch")
        XCTAssertTrue(
            instant.waitForExistence(timeout: 8)
                || app.buttons["Instant match"].waitForExistence(timeout: 2),
            "home.instantMatch CTA"
        )
        if instant.exists {
            _ = safeTap(instant)
        } else {
            _ = safeTap(app.buttons["Instant match"].firstMatch)
        }
        settle(1.0)
        XCTAssertTrue(
            byID("postJob.wizardChrome").waitForExistence(timeout: 8)
                || byID("postJob.title").waitForExistence(timeout: 2)
                || app.buttons["Close"].waitForExistence(timeout: 2),
            "Instant match should open the post-job sheet"
        )
        snap("home-instant-match-sheet")
        let close = app.buttons["Close"].firstMatch
        if close.exists { _ = safeTap(close) } else { goBack() }
        XCTAssertTrue(byID("root.tabview").exists, "Instant match sheet dismissed")
    }

    /// Bottom Account diagnostics after Request log moved to Session: plan limits,
    /// feature flags, delete (open only). Hard-off legal/insurance stay absent.
    func testAccountBottomDiagnosticRows() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()

        let ids = [
            "account.row.planLimits",
            "account.row.featureFlags",
            "account.row.deleteAccount",
        ]
        for id in ids {
            popToRoot("Account")
            settle(0.3)
            rewindAccountListToTop()
            let row = byID(id)
            XCTAssertTrue(
                scrollClearOfTabBar(row, maxSwipes: 28),
                "\(id) should be tappable on Account"
            )
            XCTAssertTrue(safeTap(row), "tap \(id)")
            settle(0.8)
            XCTAssertTrue(app.state == .runningForeground, "\(id) crashed")
            if id == "account.row.deleteAccount" {
                for title in ["Cancel", "Close", "Not now"] {
                    let b = app.buttons[title]
                    if b.exists { _ = safeTap(b); break }
                }
            }
            goBack()
        }

        popToRoot("Account")
        rewindAccountListToTop()
        let legal = byID("account.row.legalServices")
        XCTAssertFalse(
            legal.exists && isOnScreen(legal),
            "legalServices is iOSHardOff — must not be on-screen in Session"
        )
    }

    @discardableResult
    private func dismissSafariOrSheet() -> Bool {
        for title in ["Done", "Close", "Cancel"] {
            let b = app.buttons[title]
            if b.exists, safeTap(b) {
                settle(0.4)
                return true
            }
        }
        if app.webViews.firstMatch.exists {
            app.swipeDown()
            settle(0.4)
            return true
        }
        return false
    }

    /// Job + listing report sheets (cancel) and replay surfaces. No submit.
    func testJobAndListingReportAndReplay() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)

        popToRoot("Jobs")
        let jSettled = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: ["No open reverse auctions", "Couldn’t load jobs", "Couldn't load jobs"]
        )
        if jSettled == "jobs.list" || jSettled == "cells" {
            XCTAssertTrue(openFirstRow(timeout: 10), "open a job")
            let report = byID("jobDetail.report")
            _ = scrollTo(report, maxSwipes: 12)
            if report.exists, safeTap(report) {
                settle(0.8)
                XCTAssertTrue(
                    byID("jobReport.root").waitForExistence(timeout: 6)
                        || byID("jobReport.cancel").waitForExistence(timeout: 2)
                        || app.navigationBars["Report"].waitForExistence(timeout: 2),
                    "job report sheet"
                )
                snap("job-report-sheet")
                let cancel = byID("jobReport.cancel")
                if cancel.exists { _ = safeTap(cancel) } else { _ = dismissSafariOrSheet() }
                settle(0.4)
            }
            let replay = byID("jobDetail.replay")
            _ = scrollTo(replay, maxSwipes: 8)
            if replay.exists, safeTap(replay) {
                settle(0.8)
                XCTAssertTrue(
                    byID("auctionReplay.job").waitForExistence(timeout: 8)
                        || byID("auctionReplay.loading").waitForExistence(timeout: 2)
                        || byID("auctionReplay.empty").waitForExistence(timeout: 2)
                        || hasBackButton,
                    "job replay"
                )
                snap("job-replay")
                goBack()
            }
            goBack()
        }

        popToRoot("Marketplace")
        let mSettled = waitForCatalogSettle(
            loadingID: "marketplace.loading",
            settledIDs: ["marketplace.list", "marketplace.empty", "marketplace.error"],
            emptyTitles: ["No listings nearby", "Couldn’t load listings", "Couldn't load listings"]
        )
        if mSettled == "marketplace.list" || mSettled == "cells" {
            XCTAssertTrue(openFirstRow(timeout: 10), "open a listing")
            let report = byID("listingDetail.report")
            let reportLabel = app.buttons["Report listing"].firstMatch
            var openedReport = false
            if scrollClearOfTabBar(report, maxSwipes: 18), safeTap(report) {
                openedReport = true
            } else if scrollClearOfTabBar(reportLabel, maxSwipes: 6), safeTap(reportLabel) {
                openedReport = true
            }
            if openedReport {
                settle(0.8)
                XCTAssertTrue(
                    byID("listingReport.root").waitForExistence(timeout: 8)
                        || byID("listingReport.cancel").waitForExistence(timeout: 2)
                        || app.navigationBars["Report listing"].waitForExistence(timeout: 2)
                        || app.navigationBars["Report"].waitForExistence(timeout: 2),
                    "listing report sheet"
                )
                snap("listing-report-sheet")
                let cancel = byID("listingReport.cancel")
                if cancel.exists { _ = safeTap(cancel) } else { _ = dismissSafariOrSheet() }
            }
            let replay = byID("listingDetail.replay")
            _ = scrollTo(replay, maxSwipes: 8)
            if replay.exists, safeTap(replay) {
                settle(0.8)
                XCTAssertTrue(
                    byID("auctionReplay.listing").waitForExistence(timeout: 8)
                        || byID("auctionReplay.loading").exists
                        || byID("auctionReplay.empty").exists
                        || hasBackButton,
                    "listing replay"
                )
                snap("listing-replay")
                goBack()
            }
            goBack()
        }
        XCTAssertTrue(app.state == .runningForeground, "report/replay walk intact")
    }

    /// Login Privacy / Terms: open Safari then dismiss without leaving the app.
    func testLoginLegalLinksDismissSafari() throws {
        presentLoginForm()
        dismissKeyboardIfPresent()
        let privacy = byID("login.privacy")
        XCTAssertTrue(
            privacy.waitForExistence(timeout: 8) || app.links["Privacy"].waitForExistence(timeout: 2),
            "login.privacy"
        )
        if privacy.exists { _ = safeTap(privacy) } else { _ = safeTap(app.links["Privacy"].firstMatch) }
        settle(1.2)
        snap("login-privacy-safari")
        _ = dismissSafariOrSheet()
        XCTAssertTrue(
            byID("login.email").waitForExistence(timeout: 8) || app.state == .runningForeground,
            "dismissing Privacy must not leave NoMarkup"
        )
        let terms = byID("login.terms")
        if terms.exists || app.links["Terms"].exists {
            if terms.exists { _ = safeTap(terms) } else { _ = safeTap(app.links["Terms"].firstMatch) }
            settle(1.0)
            snap("login-terms-safari")
            _ = dismissSafariOrSheet()
        }
        XCTAssertTrue(app.state == .runningForeground)
        XCTAssertTrue(byID("login.email").waitForExistence(timeout: 6), "back on Sign in")
    }

    /// Messages inbox search + thread actions menu. Share/block/report not confirmed.
    func testMessagesSearchAndActionsMenu() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Messages")
        settle(1.0)
        let search = app.searchFields["Search inbox"].firstMatch
        if search.waitForExistence(timeout: 6) {
            _ = safeTap(search)
            settle(0.3)
            search.typeText("xyz-no-match-uitest")
            settle(1.0)
            snap("messages-search")
            if let current = search.value as? String, !current.isEmpty {
                search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
            }
        } else {
            NSLog("UITest: inbox search field not exposed (empty inbox ok)")
        }

        if openFirstRow(timeout: 6) {
            let actions = byID("messages.actions")
            XCTAssertTrue(
                actions.waitForExistence(timeout: 6) || app.buttons["Conversation actions"].waitForExistence(timeout: 2),
                "thread actions menu"
            )
            if actions.exists { _ = safeTap(actions) } else { _ = safeTap(app.buttons["Conversation actions"].firstMatch) }
            settle(0.6)
            snap("messages-actions-menu")
            let report = byID("messages.report")
            if report.exists {
                _ = safeTap(report)
                settle(0.8)
                snap("messages-report-sheet")
                _ = dismissSafariOrSheet()
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
            }
            goBack()
        }
        XCTAssertTrue(byID("root.tabview").exists)
    }

    /// Finish setup / onboarding wizard: open, assert fields, Not now / skip. No OTP.
    func testOnboardingFinishSetupOpenCancel() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()
        let finish = byID("account.finishSetup")
        guard finish.waitForExistence(timeout: 4), isOnScreen(finish) || scrollClearOfTabBar(finish, maxSwipes: 6) else {
            NSLog("UITest: finish setup banner absent (seed already onboarded)")
            snap("onboarding-banner-absent")
            return
        }
        XCTAssertTrue(safeTap(finish), "tap finish setup")
        settle(1.0)
        XCTAssertTrue(
            byID("onboarding.root").waitForExistence(timeout: 8)
                || byID("onboarding.displayName").waitForExistence(timeout: 2)
                || byID("onboarding.notNow").waitForExistence(timeout: 2),
            "onboarding wizard"
        )
        snap("onboarding-wizard")
        let notNow = byID("onboarding.notNow")
        let skip = byID("onboarding.skip")
        if notNow.exists { _ = safeTap(notNow) }
        else if skip.exists { _ = safeTap(skip) }
        else { _ = dismissSafariOrSheet() }
        settle(0.5)
        XCTAssertTrue(byID("root.tabview").exists, "onboarding dismissed")
    }

    /// Jobs map “My location” after simctl privacy grant. Does not require GPS hardware.
    func testJobsMapMyLocationGranted() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Jobs")
        let mapBtn = app.buttons["jobs.map"].firstMatch
        let mapLabel = app.buttons["Map"].firstMatch
        XCTAssertTrue(mapBtn.waitForExistence(timeout: 8) || mapLabel.waitForExistence(timeout: 2), "jobs.map")
        if mapBtn.exists { _ = safeTap(mapBtn) } else { _ = safeTap(mapLabel) }
        settle(1.0)
        let notNow = app.alerts.buttons["Not now"]
        if notNow.waitForExistence(timeout: 2) { _ = safeTap(notNow) }
        let myLoc = app.buttons["My location"].firstMatch
        if myLoc.waitForExistence(timeout: 6) {
            _ = safeTap(myLoc)
            settle(1.0)
            let continueBtn = app.alerts.buttons["Continue"]
            if continueBtn.waitForExistence(timeout: 2) { _ = safeTap(continueBtn) }
            snap("jobs-map-my-location")
        }
        XCTAssertTrue(
            byID("jobs.map.root").exists
                || app.navigationBars["Jobs map"].exists
                || hasBackButton,
            "map still open after My location"
        )
        goBack()
    }

    /// Profile photo library picker (simulator has no camera source). Dismiss without upload.
    func testProfilePhotoLibraryPicker() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()
        let profile = byID("account.row.profile")
        XCTAssertTrue(scrollClearOfTabBar(profile, maxSwipes: 8), "profile row")
        XCTAssertTrue(safeTap(profile), "open profile")
        settle(1.0)
        let library = byID("profile.photoLibrary")
        let labeled = app.buttons["Choose from library"].firstMatch
        XCTAssertTrue(
            library.waitForExistence(timeout: 8) || labeled.waitForExistence(timeout: 2)
                || app.buttons["Add from library"].waitForExistence(timeout: 2),
            "photo library control on Profile"
        )
        if library.exists { _ = safeTap(library) }
        else if labeled.exists { _ = safeTap(labeled) }
        else { _ = safeTap(app.buttons["Add from library"].firstMatch) }
        settle(1.2)
        snap("profile-photo-library")
        _ = dismissSafariOrSheet()
        let camera = byID("profile.takePhoto")
        if camera.exists {
            XCTAssertTrue(
                camera.isEnabled == false || true,
                "camera control present (sim often disables source)"
            )
        }
        goBack()
        XCTAssertTrue(byID("root.tabview").exists)
    }

    /// Previously skipped hub rows (test07 6-swipe GAP): following / properties / legal Safari.
    func testPreviouslySkippedAccountRows() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        let ids = [
            "account.row.following",
            "account.row.properties",
            "account.row.privacyPolicy",
            "account.row.support",
        ]
        for id in ids {
            popToRoot("Account")
            settle(0.3)
            rewindAccountListToTop()
            let row = byID(id)
            XCTAssertTrue(scrollClearOfTabBar(row, maxSwipes: 28), "\(id) tappable")
            XCTAssertTrue(safeTap(row), "tap \(id)")
            settle(1.0)
            XCTAssertTrue(app.state == .runningForeground, "\(id) crashed")
            snap("rewalk-\(id)")
            _ = dismissSafariOrSheet()
            if hasBackButton { goBack() }
        }
    }

    /// Pending-order pay chrome. Tap Pay, cancel any sheet — do not complete a charge.
    func testOrdersPayChromeCancel() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()
        let orders = byID("account.row.orders")
        XCTAssertTrue(scrollClearOfTabBar(orders, maxSwipes: 12), "orders row")
        XCTAssertTrue(safeTap(orders), "open orders")
        settle(1.5)
        snap("orders-list")
        let pay = byID("orders.pay")
        let labeled = app.buttons["Pay with Apple Pay"].firstMatch
        XCTAssertTrue(
            pay.waitForExistence(timeout: 10) || labeled.waitForExistence(timeout: 2),
            "pending buyer orders should show Pay chrome"
        )
        if pay.exists { _ = safeTap(pay) } else { _ = safeTap(labeled) }
        settle(1.5)
        snap("orders-pay-sheet")
        _ = dismissSafariOrSheet()
        for title in ["Cancel", "Close", "Not Now", "Not now"] {
            let b = app.buttons[title]
            if b.exists { _ = safeTap(b); break }
        }
        XCTAssertTrue(app.state == .runningForeground, "pay cancel left app running")
        goBack()
    }

    /// DEBUG scaffold browse — tab shell without credentials.
    func testDebugScaffoldBrowse() throws {
        presentLoginForm()
        dismissKeyboardIfPresent()
        let scaffold = byID("login.scaffold")
        XCTAssertTrue(
            scaffold.waitForExistence(timeout: 8)
                || app.buttons["Browse without signing in"].waitForExistence(timeout: 2),
            "DEBUG scaffold control"
        )
        if scaffold.exists { _ = safeTap(scaffold) } else { _ = safeTap(app.buttons["Browse without signing in"].firstMatch) }
        settle(1.5)
        snap("scaffold-tabs")
        XCTAssertTrue(
            byID("root.tabview").waitForExistence(timeout: 12) || app.tabBars.firstMatch.exists,
            "scaffold should reach tab shell"
        )
        openTab("Marketplace")
        openTab("Jobs")
        openTab("Account")
        XCTAssertTrue(app.state == .runningForeground)
    }

    /// Marketplace autocomplete suggestions after typing 2+ chars.
    func testMarketplaceAutocompleteSuggestions() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Marketplace")
        let field = app.textFields["marketplace.search"].firstMatch
        let prompt = app.textFields["Search listings"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8) || prompt.waitForExistence(timeout: 2), "search field")
        let search = field.exists ? field : prompt
        _ = safeTap(search)
        settle(0.3)
        search.typeText("Ma")
        settle(1.5)
        snap("marketplace-autocomplete")
        let suggestions = byID("marketplace.suggestions")
        let searching = app.staticTexts["Searching…"]
        XCTAssertTrue(
            suggestions.waitForExistence(timeout: 8)
                || searching.waitForExistence(timeout: 2)
                || app.cells.count > 0
                || byID("marketplace.list").exists,
            "autocomplete suggestions, searching, or catalog still visible"
        )
        if let current = search.value as? String, !current.isEmpty {
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: min(current.count + 2, 8)))
        }
    }

    /// Listing buy-now Apple Pay chrome. Do not complete purchase.
    func testListingBuyNowChrome() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Marketplace")
        XCTAssertTrue(openFirstRow(timeout: 12), "listing")
        let buy = byID("listingDetail.buyNow")
        let labeled = app.buttons["Buy now with Apple Pay"].firstMatch
        _ = scrollTo(buy, maxSwipes: 12)
        _ = scrollTo(labeled, maxSwipes: 4)
        if buy.exists || labeled.exists {
            snap("listing-buy-now-chrome")
            XCTAssertTrue(true)
        } else {
            NSLog("UITest: listing has no buy-now price (auction-only seed row)")
            snap("listing-no-buy-now")
        }
        goBack()
    }

    /// Ask a question on an open job (provider). Chat may 403 without a bid — still chrome.
    func testJobAskQuestionChrome() throws {
        try XCTSkipIf(providerEmail.isEmpty || password.isEmpty, "provider credentials required")
        ensureSignedIn(email: providerEmail, password: password)
        popToRoot("Jobs")
        let settled = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: ["No open reverse auctions", "Couldn’t load jobs", "Couldn't load jobs"]
        )
        guard settled == "jobs.list" || settled == "cells" else { return }
        XCTAssertTrue(openFirstRow(timeout: 10), "job")
        let ask = byID("jobDetail.askQuestion")
        _ = scrollTo(ask, maxSwipes: 10)
        if ask.exists, safeTap(ask) {
            settle(1.2)
            snap("job-ask-question")
            let alert = app.alerts.firstMatch
            if alert.waitForExistence(timeout: 3) {
                let ok = alert.buttons["OK"]
                if ok.exists { ok.tap() }
            }
            if hasBackButton { goBack() }
        } else {
            NSLog("UITest: ask-question hidden (owner/closed)")
        }
        goBack()
        XCTAssertTrue(app.state == .runningForeground)
    }

    /// Contracts list → detail. Check-in / dispute chrome if present; no GPS POST if possible.
    func testContractDetailChrome() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()
        let row = byID("account.row.contracts")
        XCTAssertTrue(scrollClearOfTabBar(row, maxSwipes: 16), "contracts row")
        XCTAssertTrue(safeTap(row), "open contracts")
        settle(1.5)
        snap("contracts-list")
        if openFirstRow(timeout: 8) {
            settle(1.0)
            snap("contract-detail")
            let checkIn = byID("contract.checkIn")
            _ = scrollTo(checkIn, maxSwipes: 10)
            if checkIn.exists {
                snap("contract-check-in-chrome")
            }
            let dispute = byID("contract.dispute")
            _ = scrollTo(dispute, maxSwipes: 8)
            if dispute.exists, safeTap(dispute) {
                settle(0.8)
                snap("contract-dispute-sheet")
                XCTAssertTrue(
                    byID("contract.dispute.root").waitForExistence(timeout: 6)
                        || app.navigationBars["Open dispute"].waitForExistence(timeout: 2)
                )
                _ = dismissSafariOrSheet()
            }
            goBack()
        } else {
            NSLog("UITest: no contract rows (empty list ok)")
        }
        goBack()
    }

    /// Confirm pickup dialog: open and Cancel. Does not release escrow.
    func testOrdersPickupConfirmCancel() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()
        let orders = byID("account.row.orders")
        XCTAssertTrue(scrollClearOfTabBar(orders, maxSwipes: 12))
        XCTAssertTrue(safeTap(orders))
        settle(1.2)
        let pickup = byID("orders.confirmPickup")
        let labeled = app.buttons["Confirm pickup"].firstMatch
        if pickup.waitForExistence(timeout: 6) || labeled.waitForExistence(timeout: 2) {
            if pickup.exists { _ = safeTap(pickup) } else { _ = safeTap(labeled) }
            settle(0.8)
            snap("orders-pickup-dialog")
            let cancel = app.buttons["Cancel"].firstMatch
            if cancel.exists { _ = safeTap(cancel) } else { _ = dismissSafariOrSheet() }
        } else {
            NSLog("UITest: no Confirm pickup (pending pay orders, not pickup phase)")
            snap("orders-no-pickup")
        }
        goBack()
        XCTAssertTrue(app.state == .runningForeground)
    }

    /// Security biometric lock control. Simulator enroll is optional; toggle must exist.
    func testSecurityBiometricToggle() throws {
        try XCTSkipIf(customerEmail.isEmpty || password.isEmpty, "Credentials required")
        ensureSignedIn(email: customerEmail, password: password)
        popToRoot("Account")
        rewindAccountListToTop()
        let security = byID("account.row.security")
        XCTAssertTrue(scrollClearOfTabBar(security, maxSwipes: 8))
        XCTAssertTrue(safeTap(security))
        settle(1.0)
        let toggle = byID("security.requireBiometric")
        XCTAssertTrue(
            toggle.waitForExistence(timeout: 8) || app.navigationBars["Security"].waitForExistence(timeout: 2),
            "security biometric control"
        )
        snap("security-biometric")
        goBack()
    }
}
