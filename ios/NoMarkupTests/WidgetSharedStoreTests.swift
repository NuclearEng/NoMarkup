import XCTest
@testable import NoMarkup

/// Widget snapshot merge — one rail must not overwrite the other.
final class WidgetSharedStoreTests: XCTestCase {
    override func setUp() {
        super.setUp()
        WidgetSharedStore.clear()
    }

    override func tearDown() {
        WidgetSharedStore.clear()
        super.tearDown()
    }

    func testReplaceRailSumsActiveBidCount() {
        WidgetSharedStore.replaceRail(.goods, activeCount: 3)
        WidgetSharedStore.replaceRail(.services, activeCount: 2)
        XCTAssertEqual(WidgetSharedStore.load().activeBidCount, 5)
        XCTAssertEqual(WidgetSharedStore.load().goodsBidCount, 3)
        XCTAssertEqual(WidgetSharedStore.load().servicesBidCount, 2)
    }

    func testSwitchingGoodsDoesNotZeroServices() {
        WidgetSharedStore.replaceRail(.services, activeCount: 4)
        WidgetSharedStore.replaceRail(.goods, activeCount: 1)
        let snap = WidgetSharedStore.load()
        XCTAssertEqual(snap.servicesBidCount, 4)
        XCTAssertEqual(snap.goodsBidCount, 1)
        XCTAssertEqual(snap.activeBidCount, 5)
    }

    func testReplaceRailMergesNextClosingFromBothRails() {
        let soon = Date().addingTimeInterval(3600)
        let later = Date().addingTimeInterval(7200)
        WidgetSharedStore.replaceRail(
            .goods,
            activeCount: 1,
            auctions: [
                WidgetSharedStore.AuctionSnapshot(
                    id: "listing-1",
                    title: "Bike",
                    endsAt: later,
                    amountCents: 12_000,
                    kind: WidgetSharedStore.BidRail.goods.kind
                ),
            ]
        )
        WidgetSharedStore.replaceRail(
            .services,
            activeCount: 1,
            auctions: [
                WidgetSharedStore.AuctionSnapshot(
                    id: "job-1",
                    title: "Lawn",
                    endsAt: soon,
                    amountCents: 8_000,
                    kind: WidgetSharedStore.BidRail.services.kind
                ),
            ]
        )
        let snap = WidgetSharedStore.load()
        XCTAssertEqual(Set(snap.auctions.map(\.id)), Set(["listing-1", "job-1"]))
        XCTAssertEqual(snap.nextClosing?.id, "job-1")
    }

    func testReplaceRailKeepsOtherRailAuctionsWhenNil() {
        let soon = Date().addingTimeInterval(3600)
        WidgetSharedStore.replaceRail(
            .services,
            activeCount: 1,
            auctions: [
                WidgetSharedStore.AuctionSnapshot(
                    id: "job-keep",
                    title: "Fence",
                    endsAt: soon,
                    amountCents: 5_000,
                    kind: WidgetSharedStore.BidRail.services.kind
                ),
            ]
        )
        WidgetSharedStore.replaceRail(.goods, activeCount: 2, auctions: [])
        let snap = WidgetSharedStore.load()
        XCTAssertEqual(snap.auctions.map(\.id), ["job-keep"])
        XCTAssertEqual(snap.goodsBidCount, 2)
        XCTAssertEqual(snap.servicesBidCount, 1)
    }

    func testApplyGoodsWritesLiveClosingAndSkipsEnded() {
        let future = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
        let past = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600))
        let live = MyListingBidEntry(
            bid: ListingBidRow(id: "bid-live", amountCents: 24_000),
            listing: MyListingBidListing(
                id: "listing-live",
                title: "Amp",
                status: "active",
                currentBidCents: 24_000,
                auctionEndsAt: future
            )
        )
        let ended = MyListingBidEntry(
            bid: ListingBidRow(id: "bid-ended", amountCents: 10_000),
            listing: MyListingBidListing(
                id: "listing-ended",
                title: "Closed lot",
                status: "sold",
                currentBidCents: 10_000,
                auctionEndsAt: past
            )
        )
        WidgetBidSnapshotSync.applyGoods([live, ended])
        let snap = WidgetSharedStore.load()
        XCTAssertEqual(snap.goodsBidCount, 1)
        XCTAssertEqual(snap.auctions.map(\.id), ["listing-live"])
        XCTAssertEqual(snap.nextClosing?.title, "Amp")
    }

    func testApplyServicesCountsWithdrawableOnly() {
        let active = MyJobBidRow(id: "svc-1", status: "active")
        let withdrawn = MyJobBidRow(id: "svc-2", status: "withdrawn")
        WidgetBidSnapshotSync.applyServices([active, withdrawn])
        XCTAssertEqual(WidgetSharedStore.load().servicesBidCount, 1)
    }
}
