import XCTest

/// Focused tab E2E audit: Home / Jobs / Marketplace / Messages + provider bid path.
/// Writes PNG screenshots to `NOMARKUP_UI_SHOT_DIR` (default under docs/compliance/sim-runs).
final class TabAuditUITests: XCTestCase {
    private var app: XCUIApplication!

    private static func env(_ key: String, default def: String = "") -> String {
        let e = ProcessInfo.processInfo.environment
        for c in [key, "TEST_RUNNER_\(key)"] {
            if let v = e[c], !v.isEmpty { return v }
        }
        return def
    }

    private var shotDir: URL {
        let raw = Self.env(
            "NOMARKUP_UI_SHOT_DIR",
            default: "/Users/nuclearisotope/Projects/Personal/NoMarkup/docs/compliance/sim-runs/2026-08-05-full-audit"
        )
        let url = URL(fileURLWithPath: raw, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private var customerEmail: String {
        Self.env("NOMARKUP_UI_TEST_EMAIL", default: "customer@nomarkup.com")
    }
    private var providerEmail: String {
        Self.env("NOMARKUP_UI_TEST_PROVIDER_EMAIL", default: "provider@nomarkup.com")
    }
    private var password: String {
        Self.env("NOMARKUP_UI_TEST_PASSWORD", default: "Password123!")
    }

    private var shotCounter = 0
    private var findings: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = true
        app = XCUIApplication()
        addUIInterruptionMonitor(withDescription: "System dialog") { alert in
            for title in ["Don’t Allow", "Don't Allow", "Not Now", "Cancel", "OK"] {
                let button = alert.buttons[title]
                if button.exists { button.tap(); return true }
            }
            return false
        }
    }

    override func tearDownWithError() throws {
        writeFindings()
        app = nil
    }

    // MARK: - Main audit

    func testTabsCustomerAndProviderAudit() throws {
        // Customer via DEBUG auto-login env (faster + stable).
        app.launchEnvironment["NOMARKUP_UI_TEST_EMAIL"] = customerEmail
        app.launchEnvironment["NOMARKUP_UI_TEST_PASSWORD"] = password
        app.launchEnvironment["NOMARKUP_API_BASE_URL"] = Self.env(
            "NOMARKUP_API_BASE_URL",
            default: "http://127.0.0.1:8081"
        )
        app.launch()

        XCTAssertTrue(waitForSignedInShell(timeout: 30), "customer should reach tab shell")
        snap("10-customer-signed-in")

        // --- Home ---
        openTab("Home")
        settle(1.2)
        snap("11-home")
        notePresence("home.hero", byID("home.hero").waitForExistence(timeout: 6))
        notePresence("home.browseJobs", byID("home.browseJobs").exists)
        notePresence("home.marketDesk", byID("home.marketDesk").exists || scrollTo(byID("home.marketDesk"), maxSwipes: 5))
        if byID("home.marketDesk").exists || app.staticTexts["MARKET DESK"].exists
            || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "DESK")).firstMatch.exists
        {
            findings.append("PASS home market desk / DESK copy visible")
        } else {
            findings.append("WARN home market desk not found")
        }
        // LIVE / revision footer cues
        let live = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "LIVE")).firstMatch
        let deskLive = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "DESK LIVE")).firstMatch
        if deskLive.exists || live.exists {
            findings.append("PASS DESK LIVE / LIVE indicator visible on Home")
            snap("12-home-desk-live")
        } else {
            // Scroll for footer revision
            app.swipeUp()
            settle(0.4)
            app.swipeUp()
            settle(0.5)
            snap("12-home-scrolled")
            let rev = app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "rev", "git")
            ).firstMatch
            if rev.exists {
                findings.append("PASS revision footer-ish copy: \(rev.label)")
            } else {
                findings.append("WARN DESK LIVE / revision not clearly visible (may be below fold or different copy)")
            }
        }
        // CTAs
        if byID("home.browseJobs").exists {
            findings.append("PASS home.browseJobs CTA present")
        }

        // --- Marketplace ---
        openTab("Marketplace")
        let mState = waitForCatalogSettle(
            loadingID: "marketplace.loading",
            settledIDs: ["marketplace.list", "marketplace.empty", "marketplace.error"],
            emptyTitles: ["No listings nearby", "Couldn’t load listings", "Couldn't load listings"]
        )
        snap("20-marketplace-list")
        findings.append("Marketplace settle: \(mState)")
        XCTAssertNotEqual(mState, "timeout", "Marketplace should settle (list/empty/error)")
        noteAPIErrorIfPresent(context: "marketplace")

        var openedListing = false
        if mState == "marketplace.list" || mState == "cells" {
            if openFirstRow() {
                openedListing = true
                snap("21-listing-detail")
                findings.append("PASS opened first marketplace listing")
                // Watch
                let addWatch = app.buttons["Add to watchlist"]
                let removeWatch = app.buttons["Remove from watchlist"]
                if addWatch.exists {
                    addWatch.tap()
                    settle(1.0)
                    dismissNotificationPrePrompt()
                    snap("22-listing-watch-on")
                    findings.append("PASS watchlist add tapped")
                    if removeWatch.waitForExistence(timeout: 4) {
                        removeWatch.tap()
                        settle(0.6)
                    }
                } else if removeWatch.exists {
                    findings.append("PASS watchlist already on (remove present)")
                    snap("22-listing-watch-already-on")
                } else {
                    findings.append("WARN no watchlist toolbar control")
                }
                // Bid UI (do not submit)
                let bidHeader = app.staticTexts["Place a bid (dollars)"]
                if scrollTo(bidHeader, maxSwipes: 10) {
                    snap("23-listing-place-bid-ui")
                    findings.append("PASS listing place-bid UI visible")
                } else {
                    findings.append("WARN listing place-bid UI not found (ended/seller?)")
                    snap("23-listing-detail-scrolled")
                }
                goBack()
            } else {
                findings.append("WARN marketplace list but no navigable rows")
            }
        }

        // --- Jobs ---
        openTab("Jobs")
        let jState = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: ["No open reverse auctions", "Couldn’t load jobs", "Couldn't load jobs"]
        )
        snap("30-jobs-list")
        findings.append("Jobs settle: \(jState)")
        XCTAssertNotEqual(jState, "timeout", "Jobs should settle")
        noteAPIErrorIfPresent(context: "jobs")

        if jState == "jobs.list" || jState == "cells" {
            if openFirstRow() {
                snap("31-job-detail")
                findings.append("PASS opened first job")
                app.swipeUp()
                settle(0.5)
                snap("32-job-detail-scrolled")
                // Customer may not see place-bid (provider-only)
                let place = app.staticTexts["Place a bid (dollars)"]
                let lower = app.staticTexts["Lower your bid (dollars)"]
                if place.exists || lower.exists {
                    findings.append("INFO customer sees bid section (roles may include provider)")
                    snap("33-job-bid-ui-as-customer")
                } else {
                    findings.append("INFO customer job detail has no place-bid (expected if pure customer)")
                }
                goBack()
            } else {
                findings.append("WARN jobs list but no navigable rows")
            }
        }

        // --- Messages ---
        openTab("Messages")
        settle(2.0)
        snap("40-messages-list")
        noteAPIErrorIfPresent(context: "messages")
        if openFirstRow(timeout: 6) {
            snap("41-messages-thread")
            findings.append("PASS opened messages thread")
            let composer = app.textFields["Message"]
            if composer.waitForExistence(timeout: 4) {
                snap("42-messages-composer")
                findings.append("PASS messages composer present")
            }
            goBack()
        } else {
            findings.append("WARN no messages threads (empty inbox OK for sparse seed)")
        }

        // Tab switch stability (no crash)
        for label in ["Home", "Jobs", "Marketplace", "Messages", "Account", "Home"] {
            openTab(label)
            XCTAssertTrue(byID("root.tabview").exists, "tab shell after \(label)")
        }
        snap("50-tab-switch-home")
        findings.append("PASS tab switch cycle without crash")

        // --- Provider bid path ---
        signOutIfNeeded()
        app.terminate()
        app = XCUIApplication()
        app.launchEnvironment["NOMARKUP_UI_TEST_EMAIL"] = providerEmail
        app.launchEnvironment["NOMARKUP_UI_TEST_PASSWORD"] = password
        app.launchEnvironment["NOMARKUP_API_BASE_URL"] = Self.env(
            "NOMARKUP_API_BASE_URL",
            default: "http://127.0.0.1:8081"
        )
        app.launch()
        XCTAssertTrue(waitForSignedInShell(timeout: 30), "provider should reach tab shell")
        snap("60-provider-signed-in")

        openTab("Jobs")
        let pj = waitForCatalogSettle(
            loadingID: "jobs.loading",
            settledIDs: ["jobs.list", "jobs.empty", "jobs.error"],
            emptyTitles: ["No open reverse auctions", "Couldn’t load jobs", "Couldn't load jobs"]
        )
        snap("61-provider-jobs-list")
        findings.append("Provider jobs settle: \(pj)")
        if pj == "jobs.list" || pj == "cells" {
            if openFirstRow() {
                snap("62-provider-job-detail")
                let bidHeader = app.staticTexts["Place a bid (dollars)"]
                let lowerHeader = app.staticTexts["Lower your bid (dollars)"]
                if scrollTo(bidHeader, maxSwipes: 10) {
                    snap("63-provider-place-bid-ui")
                    findings.append("PASS provider place-bid UI")
                    // Smoke: fill amount field if present, do not submit money unless safe
                    let amountField = app.textFields.firstMatch
                    if amountField.exists {
                        // Leave empty — screenshot-only smoke for bid chrome
                        findings.append("INFO bid amount field present (not submitted)")
                    }
                } else if scrollTo(lowerHeader, maxSwipes: 4) {
                    snap("63-provider-lower-bid-ui")
                    findings.append("PASS provider lower-bid UI (already has bid)")
                } else {
                    // try next rows
                    findings.append("WARN first job no bid UI; trying more rows")
                    goBack()
                    var foundBid = false
                    let cells = app.cells
                    let count = min(cells.count, 5)
                    for i in 1..<count {
                        let cell = cells.element(boundBy: i)
                        guard cell.exists else { continue }
                        if !isOnScreen(cell) { app.swipeUp(); settle(0.3) }
                        guard safeTap(cell) else { continue }
                        settle(1.4)
                        if scrollTo(app.staticTexts["Place a bid (dollars)"], maxSwipes: 8)
                            || scrollTo(app.staticTexts["Lower your bid (dollars)"], maxSwipes: 2)
                        {
                            snap("63-provider-bid-ui-row\(i)")
                            findings.append("PASS provider bid UI on row \(i)")
                            foundBid = true
                            break
                        }
                        goBack()
                    }
                    if !foundBid {
                        findings.append("FAIL/SOFT no provider bid UI on first jobs (own jobs or closed)")
                        snap("63-provider-no-bid-ui")
                    }
                }
            } else {
                findings.append("WARN provider jobs: no navigable rows")
            }
        }

        openTab("Marketplace")
        settle(1.5)
        snap("64-provider-marketplace")
        openTab("Messages")
        settle(1.2)
        snap("65-provider-messages")
        openTab("Home")
        settle(1.0)
        snap("66-provider-home")
        findings.append("PASS provider tab walk complete")

        writeFindings()
        // Soft assertion: no hard 500 surfaces flagged as FAIL
        let hardFails = findings.filter { $0.hasPrefix("FAIL") }
        XCTAssertTrue(hardFails.isEmpty, "Hard fails: \(hardFails.joined(separator: "; "))")
        _ = openedListing
    }

    // MARK: - Helpers

    private func note(_ s: String) { findings.append(s); NSLog("TAB-AUDIT %@", s) }

    private func notePresence(_ id: String, _ ok: Bool) {
        findings.append(ok ? "PASS \(id)" : "WARN missing \(id)")
    }

    private func noteAPIErrorIfPresent(context: String) {
        // Never match the substring "500" — seed jobs show "$500.00" and
        // would false-positive as HTTP 500.
        let err = app.staticTexts.matching(
            NSPredicate(
                format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@ OR label CONTAINS[c] %@",
                "server error",
                "HTTP 500",
                "internal server"
            )
        ).firstMatch
        if err.exists {
            findings.append("FAIL \(context) shows API error: \(err.label)")
            snap("ERR-\(context)-api")
        }
        let couldnt = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Couldn’t load")
        ).firstMatch
        let couldnt2 = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Couldn't load")
        ).firstMatch
        if couldnt.exists || couldnt2.exists {
            let label = couldnt.exists ? couldnt.label : couldnt2.label
            findings.append("WARN \(context) load error UI: \(label)")
        }
    }

    private func snap(_ name: String) {
        shotCounter += 1
        let fileName = String(format: "%02d-%@.png", shotCounter, name)
        let url = shotDir.appendingPathComponent(fileName)
        let shot = XCUIScreen.main.screenshot()
        do {
            try shot.pngRepresentation.write(to: url)
            NSLog("TAB-AUDIT wrote %@", url.path)
        } catch {
            NSLog("TAB-AUDIT screenshot write failed: %@", error.localizedDescription)
        }
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = fileName
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func writeFindings() {
        let text = findings.joined(separator: "\n") + "\n"
        let url = shotDir.appendingPathComponent("tab-audit-findings.txt")
        try? text.write(to: url, atomically: true, encoding: .utf8)
        let attachment = XCTAttachment(string: text)
        attachment.name = "tab-audit-findings"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func settle(_ seconds: TimeInterval = 0.6) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    private func byID(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func isOnScreen(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let f = element.frame
        guard f.width > 1, f.height > 1 else { return false }
        let bounds = app.frame
        return f.midX > bounds.minX + 2
            && f.midX < bounds.maxX - 2
            && f.midY > bounds.minY + 2
            && f.midY < bounds.maxY - 2
    }

    @discardableResult
    private func safeTap(_ element: XCUIElement) -> Bool {
        guard isOnScreen(element) else { return false }
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        return true
    }

    private func openTab(_ label: String) {
        let barButton = app.tabBars.buttons[label]
        if barButton.waitForExistence(timeout: 4) {
            if safeTap(barButton) {
                settle(0.5)
                return
            }
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            if safeTap(barButton) {
                settle(0.5)
                return
            }
            barButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            settle(0.5)
            return
        }
        findings.append("WARN tab bar button missing: \(label)")
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
        return first.frame.minX < 80 && first.frame.width < 120
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
            while gate.exists && Date() < deadline { settle(0.4) }
        }
        settle(0.4)
        return true
    }

    @discardableResult
    private func waitForSignedInShell(timeout: TimeInterval = 25) -> Bool {
        let tabView = byID("root.tabview")
        if tabView.waitForExistence(timeout: timeout) {
            completeAgeGateIfPresent()
            dismissNotificationPrePrompt()
            return true
        }
        // Manual login fallback
        let emailField = byID("login.email")
        if emailField.waitForExistence(timeout: 4) {
            let passwordField = byID("login.password")
            let submit = byID("login.submit")
            clearAndType(emailField, text: customerEmail, secure: false)
            clearAndType(passwordField, text: password, secure: true)
            submit.tap()
            if tabView.waitForExistence(timeout: 25) {
                completeAgeGateIfPresent()
                dismissNotificationPrePrompt()
                return true
            }
        }
        return false
    }

    private func clearAndType(_ field: XCUIElement, text: String, secure: Bool) {
        field.tap()
        settle(0.2)
        let existing = (field.value as? String) ?? ""
        if !existing.isEmpty && existing != "Email" && existing != "Password" {
            field.tap(withNumberOfTaps: 3, numberOfTouches: 1)
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count + 2))
        }
        field.typeText(text)
        _ = secure
    }

    private func signOutIfNeeded() {
        guard byID("root.tabview").waitForExistence(timeout: 4) else { return }
        completeAgeGateIfPresent()
        dismissNotificationPrePrompt()
        openTab("Account")
        settle(0.6)
        let signOut = app.buttons["Sign out"]
        if scrollTo(signOut, maxSwipes: 8), safeTap(signOut) {
            _ = byID("login.email").waitForExistence(timeout: 10)
        }
    }

    @discardableResult
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 8) -> Bool {
        if isOnScreen(element) { return true }
        for _ in 0..<maxSwipes {
            app.swipeUp()
            settle(0.15)
            if isOnScreen(element) { return true }
        }
        for _ in 0..<maxSwipes {
            app.swipeDown()
            settle(0.15)
            if isOnScreen(element) { return true }
        }
        return isOnScreen(element)
    }

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
            settle(1.5)
            if hasBackButton { return true }
        }
        return false
    }

    @discardableResult
    private func waitForCatalogSettle(
        loadingID: String,
        settledIDs: [String],
        emptyTitles: [String],
        timeout: TimeInterval = 18
    ) -> String {
        let deadline = Date().addingTimeInterval(timeout)
        let loading = byID(loadingID)
        while loading.exists && Date() < deadline { settle(0.35) }
        while Date() < deadline {
            for id in settledIDs where byID(id).exists { return id }
            for title in emptyTitles where app.staticTexts[title].exists { return "empty:\(title)" }
            if app.cells.firstMatch.exists { return "cells" }
            settle(0.35)
        }
        return "timeout"
    }
}
