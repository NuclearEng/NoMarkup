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
}
