import XCTest
@testable import NoMarkup

final class MoneyFormatTests: XCTestCase {
    func testUSDFormatsIntegerCents() {
        XCTAssertEqual(MoneyFormat.usd(cents: 0), "$0.00")
        XCTAssertEqual(MoneyFormat.usd(cents: 1), "$0.01")
        XCTAssertEqual(MoneyFormat.usd(cents: 2500), "$25.00")
        XCTAssertEqual(MoneyFormat.usd(cents: 1_234_567), "$12,345.67")
    }

    func testCentsParsesDollarText() {
        XCTAssertEqual(MoneyFormat.cents(fromDollarsText: "12"), 1200)
        XCTAssertEqual(MoneyFormat.cents(fromDollarsText: "12.5"), 1250)
        XCTAssertEqual(MoneyFormat.cents(fromDollarsText: "12.50"), 1250)
        XCTAssertEqual(MoneyFormat.cents(fromDollarsText: "$1,500.00"), 150_000)
        XCTAssertEqual(MoneyFormat.cents(fromDollarsText: "  9.99  "), 999)
    }

    func testCentsRejectsEmptyZeroNegative() {
        XCTAssertNil(MoneyFormat.cents(fromDollarsText: ""))
        XCTAssertNil(MoneyFormat.cents(fromDollarsText: "   "))
        XCTAssertNil(MoneyFormat.cents(fromDollarsText: "0"))
        XCTAssertNil(MoneyFormat.cents(fromDollarsText: "0.00"))
        XCTAssertNil(MoneyFormat.cents(fromDollarsText: "-5"))
        XCTAssertNil(MoneyFormat.cents(fromDollarsText: "abc"))
    }

    func testBidAmountRulesLowerOnly() {
        XCTAssertNil(BidAmountRules.validateLowerOnly(currentCents: 1000, newCents: 900))
        XCTAssertNotNil(BidAmountRules.validateLowerOnly(currentCents: 1000, newCents: 1000))
        XCTAssertNotNil(BidAmountRules.validateLowerOnly(currentCents: 1000, newCents: 1100))
        XCTAssertNotNil(BidAmountRules.validateLowerOnly(currentCents: 1000, newCents: 0))
    }

    func testBidAmountRulesOfferAccepted() {
        XCTAssertNil(BidAmountRules.validateOfferAccepted(startingCents: 5000, offerCents: 5000))
        XCTAssertNil(BidAmountRules.validateOfferAccepted(startingCents: 5000, offerCents: 4000))
        XCTAssertNotNil(BidAmountRules.validateOfferAccepted(startingCents: 5000, offerCents: 5001))
        XCTAssertNotNil(BidAmountRules.validateOfferAccepted(startingCents: 5000, offerCents: 0))
    }
}
