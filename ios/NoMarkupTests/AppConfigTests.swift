import XCTest
@testable import NoMarkup

final class AppConfigTests: XCTestCase {
    func testResolvePrefersEnvHTTPS() {
        let envURL = AppConfig.resolveAPIBaseURL(
            envValue: "https://staging.example.com",
            plistValue: "http://192.168.1.1:8081",
            debugSimulatorDefault: URL(string: "http://127.0.0.1:8081"),
            allowCleartext: true
        )
        XCTAssertEqual(envURL.absoluteString, "https://staging.example.com")
        XCTAssertTrue(AppConfig.isHTTPSAPIBase(envURL))
    }

    func testResolveUsesDebugSimulatorWhenEnvEmpty() {
        let url = AppConfig.resolveAPIBaseURL(
            envValue: nil,
            plistValue: "http://192.168.1.101:8081",
            debugSimulatorDefault: URL(string: "http://127.0.0.1:8081"),
            allowCleartext: true
        )
        XCTAssertEqual(url.host, "127.0.0.1")
        XCTAssertEqual(url.port, 8081)
        XCTAssertFalse(AppConfig.isHTTPSAPIBase(url))
    }

    func testReleaseRejectsCleartextEnvAndPlist() {
        let url = AppConfig.resolveAPIBaseURL(
            envValue: "http://192.168.1.101:8081",
            plistValue: "http://evil.example:8081",
            debugSimulatorDefault: nil,
            allowCleartext: false
        )
        XCTAssertEqual(url, AppConfig.productionAPIBaseURL)
        XCTAssertTrue(AppConfig.isHTTPSAPIBase(url))
    }

    func testResolveFallsBackToProductionHTTPSWhenEmpty() {
        let url = AppConfig.resolveAPIBaseURL(
            envValue: nil,
            plistValue: "",
            debugSimulatorDefault: nil,
            allowCleartext: false
        )
        XCTAssertEqual(url, AppConfig.productionAPIBaseURL)
        XCTAssertTrue(AppConfig.isHTTPSAPIBase(url))
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "api.no-markup.com")
    }

    func testIsHTTPSAPIBaseRejectsHTTP() {
        XCTAssertFalse(AppConfig.isHTTPSAPIBase(URL(string: "http://api.no-markup.com")!))
        XCTAssertTrue(AppConfig.isHTTPSAPIBase(URL(string: "https://api.no-markup.com")!))
    }

    func testGoogleOAuthCallbackSchemeFromClientID() {
        let scheme = AppConfig.googleOAuthCallbackScheme(
            forClientID: "123-abc.apps.googleusercontent.com"
        )
        XCTAssertEqual(scheme, "com.googleusercontent.apps.123-abc")
        XCTAssertNil(AppConfig.googleOAuthCallbackScheme(forClientID: "not-a-google-client"))
        XCTAssertNil(AppConfig.googleOAuthCallbackScheme(forClientID: ".apps.googleusercontent.com"))
    }

    func testLegalURLsAreHTTPSOnPublicSite() {
        XCTAssertEqual(AppConfig.privacyURL.scheme, "https")
        XCTAssertEqual(AppConfig.privacyURL.host, "no-markup.com")
        XCTAssertTrue(AppConfig.privacyURL.path.contains("privacy"))
        XCTAssertEqual(AppConfig.termsURL.host, "no-markup.com")
        XCTAssertEqual(AppConfig.supportURL.host, "no-markup.com")
    }

    func testMarketplaceRadiusWithinGatewayCap() {
        XCTAssertEqual(AppConfig.marketplaceRadiusKm, 40)
        XCTAssertLessThanOrEqual(AppConfig.marketplaceRadiusKm, 40)
    }

    func testFacebookOAuthCallbackSchemeIsNomarkup() {
        XCTAssertEqual(AppConfig.facebookOAuthCallbackScheme, "nomarkup")
    }

    func testLaunchTestAuthParsesEnvAndArgv() {
        let envCreds = LaunchTestAuth.credentials(
            environment: [
                "NOMARKUP_UI_TEST_EMAIL": "  customer@nomarkup.com ",
                "NOMARKUP_UI_TEST_PASSWORD": "Password123!",
            ],
            arguments: ["NoMarkup"]
        )
        XCTAssertEqual(envCreds?.email, "customer@nomarkup.com")
        XCTAssertEqual(envCreds?.password, "Password123!")

        let argvWins = LaunchTestAuth.credentials(
            environment: [
                "NOMARKUP_UI_TEST_EMAIL": "env@nomarkup.com",
                "NOMARKUP_UI_TEST_PASSWORD": "env-pass",
            ],
            arguments: ["NoMarkup", "-ui-test-email", "argv@nomarkup.com", "-ui-test-password", "argv-pass"]
        )
        XCTAssertEqual(argvWins?.email, "argv@nomarkup.com")
        XCTAssertEqual(argvWins?.password, "argv-pass")

        XCTAssertNil(
            LaunchTestAuth.credentials(
                environment: ["NOMARKUP_UI_TEST_EMAIL": "solo@nomarkup.com"],
                arguments: []
            )
        )
        XCTAssertNil(LaunchTestAuth.credentials(environment: [:], arguments: ["NoMarkup"]))
    }

    func testStoreKitEnabledDefaultsFalse() {
        // Committed Info.plist sets StoreKitEnabled=false; purchase paths must stay off for 3.1.1 free-tier binary.
        // Env override may flip true in dogfood schemes — only assert default when env unset.
        if ProcessInfo.processInfo.environment["NOMARKUP_STOREKIT_ENABLED"] == nil {
            XCTAssertFalse(AppConfig.storeKitEnabled, "StoreKit must default off until ASC products + Review Notes")
        }
    }

    func testDefaultStoreKitProductIDsAreASCDrafts() {
        let ids = AppConfig.defaultStoreKitProductIDs
        XCTAssertTrue(ids.contains("nomarkup.provider.pro.monthly"))
        XCTAssertTrue(ids.contains("nomarkup.provider.pro.yearly"))
        XCTAssertTrue(ids.contains("nomarkup.provider.business.monthly"))
        XCTAssertTrue(ids.contains("nomarkup.provider.business.yearly"))
        XCTAssertEqual(ids.count, 4)
        // Resolved list is non-empty (plist or defaults).
        XCTAssertFalse(AppConfig.storeKitProductIDs.isEmpty)
        for id in AppConfig.storeKitProductIDs {
            XCTAssertTrue(id.hasPrefix("nomarkup."), "unexpected product id \(id)")
        }
    }

    /// `isEnabled` is @MainActor on a FeatureFlags instance (needs an API client).
    /// Static set membership is enough to prove the App Store hard-off inventory
    /// without constructing a live client.
    @MainActor
    func testIOSHardOffKeysContainsRegulatedRails() {
        let expected: Set<String> = [
            "customer_bnpl",
            "working_capital",
            "per_job_insurance",
            "insurance_competition",
            "legal_services",
            "lead_gen",
            "instant_payout",
        ]
        XCTAssertTrue(expected.isSubset(of: FeatureFlags.iOSHardOffKeys))
        XCTAssertEqual(FeatureFlags.iOSHardOffKeys, expected)
    }
}
