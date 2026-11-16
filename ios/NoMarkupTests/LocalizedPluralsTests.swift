import XCTest
@testable import NoMarkup

/// IOS-L10N.5 — verifies the string-catalog plural variations end-to-end:
/// `String(localized:)` in the host app resolves the `%lld`-keyed plural
/// entries from `NoMarkup/Localizable.xcstrings` (compiled into the app
/// bundle), including the irregular one-forms ("Used once", "1 property").
///
/// The chosen mechanism for every converted `count == 1 ? … : …` site is
/// catalog `variations.plural` + `String(localized:)` — one mechanism
/// app-wide; the widget target carries the shared keys in its own
/// `NoMarkupWidget/Localizable.xcstrings` because extension lookups resolve
/// against the appex bundle.
final class LocalizedPluralsTests: XCTestCase {
    func testReviewCountPluralizes() {
        XCTAssertEqual(String(localized: "\(1) reviews"), "1 review")
        XCTAssertEqual(String(localized: "\(2) reviews"), "2 reviews")
    }

    func testBidCountPluralizes() {
        XCTAssertEqual(String(localized: "\(1) bids"), "1 bid")
        XCTAssertEqual(String(localized: "\(5) bids"), "5 bids")
    }

    /// `%lld active bids` is a widget-only key (used by `ActiveBidsWidget`), so
    /// it lives in `NoMarkupWidget/Localizable.xcstrings` — resolve it against
    /// the embedded appex bundle to prove the widget catalog compiles and
    /// pluralizes.
    func testActiveBidsPluralizesFromWidgetCatalog() throws {
        let appexURL = Bundle.main.bundleURL.appendingPathComponent("PlugIns/NoMarkupWidget.appex")
        let widgetBundle = try XCTUnwrap(Bundle(url: appexURL))
        XCTAssertEqual(String(localized: "\(1) active bids", bundle: widgetBundle), "1 active bid")
        XCTAssertEqual(String(localized: "\(3) active bids", bundle: widgetBundle), "3 active bids")
    }

    func testIntentDialogKeyPluralizes() {
        XCTAssertEqual(String(localized: "You have \(1) active bids."), "You have 1 active bid.")
        XCTAssertEqual(String(localized: "You have \(4) active bids."), "You have 4 active bids.")
    }

    func testUsedTimesIrregularOneForm() {
        XCTAssertEqual(String(localized: "Used \(1) times"), "Used once")
        XCTAssertEqual(String(localized: "Used \(3) times"), "Used 3 times")
    }

    func testPropertiesIrregularPlural() {
        XCTAssertEqual(String(localized: "\(1) properties"), "1 property")
        XCTAssertEqual(String(localized: "\(2) properties"), "2 properties")
    }

    func testJobsCompletedPluralizes() {
        XCTAssertEqual(String(localized: "\(1) jobs completed"), "1 job completed")
        XCTAssertEqual(String(localized: "\(7) jobs completed"), "7 jobs completed")
    }

    /// End-to-end through the shared widget helper (compiled into the app for
    /// this test; the widget target resolves the same keys from its own
    /// catalog).
    func testSpokenDeadlineEndToEnd() {
        let now = Date()
        XCTAssertEqual(
            WidgetSharedStore.spokenDeadline(endsAt: now.addingTimeInterval(60), now: now),
            "ends in 1 minute"
        )
        XCTAssertEqual(
            WidgetSharedStore.spokenDeadline(endsAt: now.addingTimeInterval(2 * 3600), now: now),
            "ends in 2 hours"
        )
        XCTAssertEqual(
            WidgetSharedStore.spokenDeadline(endsAt: now.addingTimeInterval(3600 + 5 * 60), now: now),
            "ends in 1 hour 5 minutes"
        )
    }
}
