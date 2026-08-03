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

// MARK: - Listing promotion pricebook / decode (Wave 5)

final class ListingPromotionTests: XCTestCase {
    func testPricebookMatchesGatewayTiers() {
        XCTAssertEqual(ListingPromotionTier.all.count, 3)
        XCTAssertEqual(ListingPromotionTier.expectedAmountCents(for: 24), 500)
        XCTAssertEqual(ListingPromotionTier.expectedAmountCents(for: 72), 1_200)
        XCTAssertEqual(ListingPromotionTier.expectedAmountCents(for: 168), 2_500)
        XCTAssertNil(ListingPromotionTier.expectedAmountCents(for: 48))
        XCTAssertFalse(ListingPromotionTier.isAllowed(1))
        XCTAssertTrue(ListingPromotionTier.isAllowed(24))
    }

    func testPromoteResponseAcceptsStripeAndDevSecrets() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        let stripeJSON = """
        {
          "charge_id": "11111111-1111-1111-1111-111111111111",
          "listing_id": "22222222-2222-2222-2222-222222222222",
          "duration_hours": 24,
          "amount_cents": 500,
          "stripe_client_secret": "seti_abc123_secret_xyz",
          "promoted_until_estimate": "2026-08-03T12:00:00Z",
          "status": "pending"
        }
        """.data(using: .utf8)!
        let stripe = try decoder.decode(PromoteListingResponse.self, from: stripeJSON)
        XCTAssertTrue(stripe.isStripeSetupSecret)
        XCTAssertFalse(stripe.isDevSetupSecret)
        XCTAssertTrue(stripe.matchesExpectedPricebook())

        let devJSON = """
        {
          "charge_id": "11111111-1111-1111-1111-111111111111",
          "listing_id": "22222222-2222-2222-2222-222222222222",
          "duration_hours": 72,
          "amount_cents": 1200,
          "stripe_client_secret": "dev_promote_22222222-2222-2222-2222-222222222222",
          "status": "pending"
        }
        """.data(using: .utf8)!
        let dev = try decoder.decode(PromoteListingResponse.self, from: devJSON)
        XCTAssertTrue(dev.isDevSetupSecret)
        XCTAssertFalse(dev.isStripeSetupSecret)
        XCTAssertTrue(dev.matchesExpectedPricebook())
    }

    func testPromoteResponseRejectsPricebookMismatch() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let json = """
        {
          "charge_id": "11111111-1111-1111-1111-111111111111",
          "listing_id": "22222222-2222-2222-2222-222222222222",
          "duration_hours": 24,
          "amount_cents": 1,
          "stripe_client_secret": "seti_abc123_secret_xyz",
          "status": "pending"
        }
        """.data(using: .utf8)!
        let response = try decoder.decode(PromoteListingResponse.self, from: json)
        XCTAssertFalse(response.matchesExpectedPricebook())
    }

    func testConfirmPromotionDecode() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let json = """
        {
          "charge_id": "11111111-1111-1111-1111-111111111111",
          "listing_id": "22222222-2222-2222-2222-222222222222",
          "is_promoted": true,
          "promoted_until": "2026-08-03T12:00:00Z",
          "status": "succeeded"
        }
        """.data(using: .utf8)!
        let response = try decoder.decode(ConfirmPromotionResponse.self, from: json)
        XCTAssertEqual(response.isPromoted, true)
        XCTAssertEqual(response.status, "succeeded")
        XCTAssertNotNil(response.promotedUntilDate)
    }
}
