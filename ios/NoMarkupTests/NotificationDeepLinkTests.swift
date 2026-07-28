import AppIntents
import UserNotifications
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

// MARK: - Orders routing (IOS-SEC.9 route half)

/// Orders is a typed `DeepLinkRoute` case end-to-end: every orders entry point
/// (`/orders*` universal links, `nomarkup://orders`, push `action_url` strings,
/// the `/order` alias) parses to `.orders(id:)`, which `RootTabView` presents as
/// `MyOrdersView` — the same surface the `NotificationDeepLink` fallback maps
/// `/orders*` to. The delivery guarantees below predate the typed case; only the
/// mechanism (typed route vs normalized `pendingActionURL`) changed.
@MainActor
final class DeepLinkOrdersRouteTests: XCTestCase {
    private let sampleUUID = "550e8400-e29b-41d4-a716-446655440000"

    func testOrdersRouteFromPathStrings() {
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/orders"), .orders(id: nil))
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "orders"), .orders(id: nil))
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/order"), .orders(id: nil))
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/orders/\(sampleUUID)"),
            .orders(id: sampleUUID)
        )
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/api/v1/orders/\(sampleUUID)"),
            .orders(id: sampleUUID)
        )
    }

    func testOrdersRouteFromURLs() {
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "https://no-markup.com/orders?utm=1")!),
            .orders(id: nil)
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "https://no-markup.com/orders/\(sampleUUID)")!),
            .orders(id: sampleUUID)
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "nomarkup://orders")!),
            .orders(id: nil)
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "nomarkup://orders/\(sampleUUID)")!),
            .orders(id: sampleUUID)
        )
    }

    func testOrdersRouteRejectsNonOrders() {
        XCTAssertNil(DeepLinkRouter.route(fromActionString: ""))
        XCTAssertNil(DeepLinkRouter.route(fromActionString: "/ordersx"))
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/jobs/\(sampleUUID)"),
            .job(id: sampleUUID)
        )
        XCTAssertEqual(DeepLinkRouter.route(from: URL(string: "nomarkup://bids")!), .bids)
    }

    func testOrdersTypedRouteStaysStringDeliverable() {
        // The typed route's canonical path must remain parseable by the string
        // fallback layer (`NotificationDeepLink`), which maps it to My Orders —
        // so push payloads carrying these paths land on the same surface.
        let list = DeepLinkRouter.route(fromActionString: "/orders")
        XCTAssertEqual(list, .orders(id: nil))
        XCTAssertEqual(
            NotificationDeepLink.destination(from: list?.actionURLString)?.kindLabel,
            "orders"
        )
        let detail = DeepLinkRouter.route(fromActionString: "/orders/\(sampleUUID)")
        XCTAssertEqual(detail?.actionURLString, "/orders/\(sampleUUID)")
        XCTAssertEqual(
            NotificationDeepLink.destination(from: detail?.actionURLString)?.kindLabel,
            "orders"
        )
    }

    func testHandleCustomSchemeOrdersURLDeliversTypedRoute() {
        let router = DeepLinkRouter.shared
        router.clear()
        defer { router.clear() }

        // Previously dead-ended: `nomarkup://orders` has an empty URL.path, so the
        // raw absolute-string fallback was unparseable by NotificationDeepLink.
        XCTAssertTrue(router.handle(url: URL(string: "nomarkup://orders")!))
        XCTAssertEqual(router.route, .orders(id: nil))
        XCTAssertNil(router.pendingActionURL)
    }

    func testHandleUniversalLinkOrdersDetailDeliversTypedRoute() {
        let router = DeepLinkRouter.shared
        router.clear()
        defer { router.clear() }

        XCTAssertTrue(router.handle(url: URL(string: "https://no-markup.com/orders/\(sampleUUID)")!))
        XCTAssertEqual(router.route, .orders(id: sampleUUID))
        XCTAssertNil(router.pendingActionURL)
    }

    func testOpenActionStringOrderAliasDeliversTypedRoute() {
        let router = DeepLinkRouter.shared
        router.clear()
        defer { router.clear() }

        router.open(actionURL: "/order")
        XCTAssertEqual(router.route, .orders(id: nil))
        XCTAssertNil(router.pendingActionURL)
    }

    func testNonOrdersUnknownURLKeepsRawFallback() {
        let router = DeepLinkRouter.shared
        router.clear()
        defer { router.clear() }

        let raw = "https://no-markup.com/stripe-redirect"
        XCTAssertTrue(router.handle(url: URL(string: raw)!))
        XCTAssertEqual(router.pendingActionURL, raw)
    }
}

// MARK: - Notification action branching (IOS-SYS.NT.3 client half)

final class NotificationActionBranchTests: XCTestCase {
    func testDefaultTapAndViewActionDeepLink() {
        XCTAssertTrue(
            PushRegistration.shouldDeepLink(forActionIdentifier: UNNotificationDefaultActionIdentifier)
        )
        XCTAssertTrue(
            PushRegistration.shouldDeepLink(forActionIdentifier: PushRegistration.viewActionIdentifier)
        )
    }

    func testDismissAndUnknownActionsNeverNavigate() {
        XCTAssertFalse(
            PushRegistration.shouldDeepLink(forActionIdentifier: PushRegistration.dismissActionIdentifier)
        )
        XCTAssertFalse(
            PushRegistration.shouldDeepLink(forActionIdentifier: UNNotificationDismissActionIdentifier)
        )
        XCTAssertFalse(PushRegistration.shouldDeepLink(forActionIdentifier: "SOME_FUTURE_ACTION"))
    }
}

// MARK: - App Intents session guard (IOS-INT.1 / INT.5)

private struct StubIntentSession: IntentSessionProviding {
    let signedIn: Bool
    func hasStoredSession() -> Bool { signedIn }
}

@MainActor
final class AppIntentsAuthGuardTests: XCTestCase {
    private let sampleUUID = "550e8400-e29b-41d4-a716-446655440000"

    func testRequireSessionThrowsWhenSignedOut() {
        XCTAssertThrowsError(try IntentAuthGuard.requireSession(StubIntentSession(signedIn: false))) { error in
            if #available(iOS 18.0, *) {
                XCTAssertTrue(error is AppIntentError, "expected AppIntentError.UserActionRequired.signin")
            } else {
                let signedOut = error as? IntentSignedOutError
                XCTAssertNotNil(signedOut)
                XCTAssertEqual(signedOut?.errorDescription?.isEmpty, false)
            }
        }
    }

    func testRequireSessionPassesWhenSignedIn() {
        XCTAssertNoThrow(try IntentAuthGuard.requireSession(StubIntentSession(signedIn: true)))
    }

    func testEmptyKeychainCountsAsSignedOut() throws {
        // Real KeychainTokenStore with a dedicated, guaranteed-empty service.
        let store = KeychainTokenStore(service: "com.nomarkup.tests.intent-auth-empty")
        try? store.delete(.accessToken)
        try? store.delete(.refreshToken)

        XCTAssertFalse(store.hasStoredSession())
        XCTAssertThrowsError(try IntentAuthGuard.requireSession(store))
    }

    // MARK: Signed-out perform() — every intent throws and never navigates.

    private func assertThrowsAndDoesNotNavigate(
        _ perform: () async throws -> Void,
        _ name: String
    ) async {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }
        do {
            try await perform()
            XCTFail("\(name): expected signed-out error")
        } catch {
            XCTAssertNil(DeepLinkRouter.shared.route, "\(name): signed-out intent must not navigate")
            XCTAssertNil(DeepLinkRouter.shared.pendingActionURL, "\(name): signed-out intent must not navigate")
        }
    }

    func testOpenMyBidsIntentSignedOutThrows() async {
        var intent = OpenMyBidsIntent()
        intent.session = StubIntentSession(signedIn: false)
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "OpenMyBidsIntent")
    }

    func testOpenWatchlistIntentSignedOutThrows() async {
        var intent = OpenWatchlistIntent()
        intent.session = StubIntentSession(signedIn: false)
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "OpenWatchlistIntent")
    }

    func testOpenPostJobIntentSignedOutThrows() async {
        var intent = OpenPostJobIntent()
        intent.session = StubIntentSession(signedIn: false)
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "OpenPostJobIntent")
    }

    func testCheckInToJobIntentSignedOutThrows() async {
        var intent = CheckInToJobIntent()
        intent.session = StubIntentSession(signedIn: false)
        intent.contract = ContractEntity(id: sampleUUID)
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "CheckInToJobIntent")
    }

    // MARK: Signed-in perform() — routes land on the shared router.

    func testOpenMyBidsIntentSignedInRoutesAndReturnsCount() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = OpenMyBidsIntent()
        intent.session = StubIntentSession(signedIn: true)
        let result = try await intent.perform()

        XCTAssertEqual(DeepLinkRouter.shared.route, .bids)
        // INT.6c: the result carries the snapshot's active bid count plus a dialog.
        let container = result as? IntentResultContainer<Int, Never, Never, IntentDialog>
        XCTAssertNotNil(container, "expected value+dialog result container")
        XCTAssertEqual(container?.value, WidgetSharedStore.load().activeBidCount)
        XCTAssertNotNil(container?.dialog)
    }

    func testOpenWatchlistIntentSignedInRoutes() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = OpenWatchlistIntent()
        intent.session = StubIntentSession(signedIn: true)
        _ = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .watchlist)
    }

    func testOpenPostJobIntentSignedInRoutes() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = OpenPostJobIntent()
        intent.session = StubIntentSession(signedIn: true)
        _ = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .postJob)
    }

    func testCheckInToJobIntentSignedInRoutesWithContract() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = CheckInToJobIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.contract = ContractEntity(id: sampleUUID)
        _ = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .checkIn(contractID: sampleUUID))
    }

    func testCheckInToJobIntentSignedInRoutesWithoutContract() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = CheckInToJobIntent()
        intent.session = StubIntentSession(signedIn: true)
        _ = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .checkIn(contractID: nil))
    }
}

// MARK: - App Intents entities (IOS-INT.2 / INT.6b)

final class AppIntentsEntityTests: XCTestCase {
    private let sampleUUID = "550e8400-e29b-41d4-a716-446655440000"

    func testContractEntityQueryResolvesIdentifiersOffline() async throws {
        let entities = try await ContractEntityQuery().entities(for: [sampleUUID, "  ", ""])
        XCTAssertEqual(entities.map(\.id), [sampleUUID])
    }

    func testContractEntityQuerySuggestedIsEmptyByDesign() async throws {
        // No non-network contract source exists; intents must not hit the network.
        let suggested = try await ContractEntityQuery().suggestedEntities()
        XCTAssertTrue(suggested.isEmpty)
    }

    func testJobAndListingQueriesResolveIdentifiersOffline() async throws {
        let jobs = try await JobEntityQuery().entities(for: [sampleUUID, ""])
        XCTAssertEqual(jobs.map(\.id), [sampleUUID])

        let listings = try await ListingEntityQuery().entities(for: [sampleUUID])
        XCTAssertEqual(listings.map(\.id), [sampleUUID])
    }

    func testSuggestedEntitiesMirrorWidgetSnapshotByKind() async throws {
        // Source of truth is the app-group snapshot; suggestions must be exactly the
        // matching-kind rows (empty snapshot → empty suggestions, never a throw).
        let snapshot = WidgetSharedStore.load()

        let jobs = try await JobEntityQuery().suggestedEntities()
        XCTAssertEqual(jobs.map(\.id), snapshot.auctions.filter { $0.kind == "job" }.map(\.id))

        let listings = try await ListingEntityQuery().suggestedEntities()
        XCTAssertEqual(listings.map(\.id), snapshot.auctions.filter { $0.kind == "listing" }.map(\.id))
    }

    func testDisplayRepresentations() {
        let titledJob = JobEntity(id: sampleUUID, title: "Fix kitchen sink")
        XCTAssertEqual(String(localized: titledJob.displayRepresentation.title), "Fix kitchen sink")

        let bareJob = JobEntity(id: sampleUUID, title: nil)
        XCTAssertEqual(String(localized: bareJob.displayRepresentation.title), "Job")

        let listing = ListingEntity(id: sampleUUID, title: "Vintage road bike")
        XCTAssertEqual(String(localized: listing.displayRepresentation.title), "Vintage road bike")

        let contract = ContractEntity(id: sampleUUID)
        XCTAssertEqual(
            String(localized: contract.displayRepresentation.title),
            "Contract \(String(sampleUUID.prefix(8)))"
        )
    }
}
