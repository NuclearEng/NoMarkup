import XCTest

/// Smoke XCUITests for cold launch and optional credentialed login.
/// Credentials (optional): set `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD`
/// on the test process environment (scheme or `xcodebuild` env).
final class NoMarkupUITests: XCTestCase {
    private var app: XCUIApplication!

    /// Credentials from process env, `TEST_RUNNER_*`, or optional local file
    /// `NoMarkupUITests/Credentials.local` (gitignored) with lines KEY=value.
    private static func testCredential(_ key: String) -> String {
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
        if key == "NOMARKUP_UI_TEST_EMAIL" { return "customer@nomarkup.com" }
        if key == "NOMARKUP_UI_TEST_PASSWORD" { return "Password123!" }
        return ""
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()

        // Optional credentials for testLoginWithEnvCredentials — also available to the app under test.
        let email = Self.testCredential("NOMARKUP_UI_TEST_EMAIL")
        let password = Self.testCredential("NOMARKUP_UI_TEST_PASSWORD")
        if !email.isEmpty {
            app.launchEnvironment["NOMARKUP_UI_TEST_EMAIL"] = email
        }
        if !password.isEmpty {
            app.launchEnvironment["NOMARKUP_UI_TEST_PASSWORD"] = password
        }

        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    /// After cold launch, either the login form or the signed-in tab shell is visible.
    func testColdLaunchShowsLoginOrTabs() throws {
        let loginEmail = app.descendants(matching: .any)["login.email"]
        let tabView = app.descendants(matching: .any)["root.tabview"]

        // Wait up to 15s for either surface (single budget, not sequential waits).
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
        let email = Self.testCredential("NOMARKUP_UI_TEST_EMAIL")
        let password = Self.testCredential("NOMARKUP_UI_TEST_PASSWORD")

        try XCTSkipIf(
            email.isEmpty || password.isEmpty,
            "Set NOMARKUP_UI_TEST_EMAIL and NOMARKUP_UI_TEST_PASSWORD (or TEST_RUNNER_*) to run credentialed login"
        )

        // Prefer app auto-login via launchEnvironment (DEBUG RootView).
        // Fall back to typing if still on login after short wait.
        let tabView = app.descendants(matching: .any)["root.tabview"]
        if tabView.waitForExistence(timeout: 12) {
            return // auto-login succeeded
        }

        let emailField = app.descendants(matching: .any)["login.email"]
        let passwordField = app.descendants(matching: .any)["login.password"]
        let submit = app.descendants(matching: .any)["login.submit"]

        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "login.email not found")
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "login.password not found")
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "login.submit not found")

        emailField.tap()
        emailField.typeText(email)

        passwordField.tap()
        passwordField.typeText(password)

        submit.tap()

        XCTAssertTrue(
            tabView.waitForExistence(timeout: 30),
            "root.tabview should appear after successful login"
        )
    }

    /// After auto-login, walk primary tabs that host the dual-rail product shell.
    func testSignedInTabNavigation() throws {
        let email = Self.testCredential("NOMARKUP_UI_TEST_EMAIL")
        let password = Self.testCredential("NOMARKUP_UI_TEST_PASSWORD")
        try XCTSkipIf(email.isEmpty || password.isEmpty, "Credentials required for signed-in tab smoke")

        let tabView = app.descendants(matching: .any)["root.tabview"]
        XCTAssertTrue(tabView.waitForExistence(timeout: 20), "Expected signed-in root.tabview")

        // Tab bar labels from RootTabView
        let tabIds = ["tab.home", "tab.marketplace", "tab.jobs", "tab.messages", "tab.account"]
        for id in tabIds {
            let tab = app.descendants(matching: .any)[id]
            if tab.waitForExistence(timeout: 5) {
                tab.tap()
                // Brief settle so destination loads without flaking on network
                RunLoop.current.run(until: Date().addingTimeInterval(0.6))
                XCTAssertTrue(tabView.exists, "Tab shell should remain after tapping \(id)")
            } else {
                // Fallback: system tab bar buttons by label
                let labels = ["Home", "Marketplace", "Jobs", "Messages", "Account"]
                let idx = tabIds.firstIndex(of: id) ?? 0
                let button = app.tabBars.buttons[labels[idx]]
                if button.waitForExistence(timeout: 3) {
                    button.tap()
                    RunLoop.current.run(until: Date().addingTimeInterval(0.6))
                }
            }
        }
    }
}
