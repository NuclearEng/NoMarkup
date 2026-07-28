import XCTest
@testable import NoMarkup

@MainActor
final class NotificationDeepLinkTests: XCTestCase {
    private let sampleUUID = "550e8400-e29b-41d4-a716-446655440000"

    func testJobPath() {
        let dest = NotificationDeepLink.destination(from: "/jobs/\(sampleUUID)")
        XCTAssertEqual(dest?.kindLabel, "job")
    }

    func testJobAPIPath() {
        let dest = NotificationDeepLink.destination(from: "/api/v1/jobs/\(sampleUUID)")
        XCTAssertEqual(dest?.kindLabel, "job")
    }

    func testContractPath() {
        let dest = NotificationDeepLink.destination(from: "/contracts/\(sampleUUID)")
        XCTAssertEqual(dest?.kindLabel, "contract")
    }

    func testAbsoluteURLUsesPath() {
        let dest = NotificationDeepLink.destination(
            from: "https://no-markup.com/jobs/\(sampleUUID)?utm=1"
        )
        XCTAssertEqual(dest?.kindLabel, "job")
    }

    func testMessagesAndOrders() {
        XCTAssertEqual(NotificationDeepLink.destination(from: "/messages")?.kindLabel, "messages")
        XCTAssertEqual(NotificationDeepLink.destination(from: "/chat/thread")?.kindLabel, "messages")
        XCTAssertEqual(NotificationDeepLink.destination(from: "/orders")?.kindLabel, "orders")
        XCTAssertEqual(NotificationDeepLink.destination(from: "/orders/\(sampleUUID)")?.kindLabel, "orders")
    }

    func testListingAndAuctionPaths() {
        XCTAssertEqual(
            NotificationDeepLink.destination(from: "/listings/\(sampleUUID)")?.kindLabel,
            "listing"
        )
        XCTAssertEqual(
            NotificationDeepLink.destination(from: "/marketplace/listings/\(sampleUUID)")?.kindLabel,
            "listing"
        )
        XCTAssertEqual(
            NotificationDeepLink.destination(from: "/auctions/\(sampleUUID)")?.kindLabel,
            "listing"
        )
    }

    func testDeepLinkRouterParsesCustomScheme() {
        let url = URL(string: "nomarkup://jobs/\(sampleUUID)")!
        let route = DeepLinkRouter.route(from: url)
        XCTAssertEqual(route, .job(id: sampleUUID))
        XCTAssertEqual(route?.actionURLString, "/jobs/\(sampleUUID)")
    }

    func testDeepLinkRouterParsesPathString() {
        let route = DeepLinkRouter.route(fromActionString: "/contracts/\(sampleUUID)")
        XCTAssertEqual(route, .contract(id: sampleUUID))
    }

    func testNilEmptyUnknown() {
        XCTAssertNil(NotificationDeepLink.destination(from: nil))
        XCTAssertNil(NotificationDeepLink.destination(from: ""))
        XCTAssertNil(NotificationDeepLink.destination(from: "   "))
        XCTAssertNil(NotificationDeepLink.destination(from: "/unknown/path"))
        XCTAssertNil(NotificationDeepLink.destination(from: "/jobs/not-a-uuid"))
    }
}
