import AppIntents
import UserNotifications
import XCTest
@testable import NoMarkup

#if canImport(AppIntentsTesting)
import AppIntentsTesting
#endif
#if canImport(VisualIntelligence)
import VisualIntelligence
#endif

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

    func testJobsRootIsBrowseNotPost() {
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/jobs"), .jobsBrowse)
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "jobs"), .jobsBrowse)
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "nomarkup://jobs")!),
            .jobsBrowse
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "https://no-markup.com/jobs")!),
            .jobsBrowse
        )
        XCTAssertNotEqual(DeepLinkRouter.route(fromActionString: "/jobs"), .postJob)
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/jobs")?.actionURLString, "/jobs")
    }

    func testJobsNewIsPostJob() {
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/jobs/new"), .postJob)
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "nomarkup://jobs/new")!),
            .postJob
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "https://no-markup.com/jobs/new")!),
            .postJob
        )
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/jobs/new")?.actionURLString, "/jobs/new")
    }

    func testJobsUUIDIsJob() {
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/jobs/\(sampleUUID)"),
            .job(id: sampleUUID)
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "nomarkup://jobs/\(sampleUUID)")!),
            .job(id: sampleUUID)
        )
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/jobs/\(sampleUUID)")?.actionURLString,
            "/jobs/\(sampleUUID)"
        )
    }

    func testNilEmptyUnknown() {
        XCTAssertNil(NotificationDeepLink.destination(from: nil))
        XCTAssertNil(NotificationDeepLink.destination(from: ""))
        XCTAssertNil(NotificationDeepLink.destination(from: "   "))
        XCTAssertNil(NotificationDeepLink.destination(from: "/unknown/path"))
        XCTAssertNil(NotificationDeepLink.destination(from: "/jobs/not-a-uuid"))
    }

    func testDestinationRejectsDangerousSchemesEvenWhenPathLooksValid() {
        XCTAssertNil(NotificationDeepLink.destination(from: "javascript:alert(1)"))
        XCTAssertNil(NotificationDeepLink.destination(from: "javascript:/jobs/\(sampleUUID)"))
        XCTAssertNil(NotificationDeepLink.destination(from: "file:///jobs/\(sampleUUID)"))
        XCTAssertNil(NotificationDeepLink.destination(from: "data:text/html,<script>alert(1)</script>"))
        XCTAssertNil(NotificationDeepLink.destination(from: "about:blank"))
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

    func testRegisteredCategoriesIncludeNewMessage() {
        XCTAssertEqual(
            PushRegistration.registeredCategoryIdentifiers,
            [
                "bid_outbid",
                "bid_awarded",
                "auction_closing_soon",
                "contract_created",
                "new_message",
            ]
        )
        XCTAssertTrue(PushRegistration.registeredCategoryIdentifiers.contains("new_message"))
        XCTAssertEqual(PushRegistration.viewActionIdentifier, "VIEW")
        XCTAssertEqual(PushRegistration.dismissActionIdentifier, "DISMISS")
        XCTAssertTrue(PushRegistration.categoryIdentifiersWithDismiss.contains("new_message"))
        XCTAssertTrue(PushRegistration.categoryIdentifiersWithDismiss.contains("bid_outbid"))
        XCTAssertFalse(PushRegistration.categoryIdentifiersWithDismiss.contains("bid_awarded"))
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

    func testSearchCatalogIntentSignedOutThrows() async {
        var intent = SearchCatalogIntent()
        intent.session = StubIntentSession(signedIn: false)
        intent.query = "bike"
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "SearchCatalogIntent")
    }

    func testSearchNoMarkupIntentSignedOutThrows() async {
        guard #available(iOS 18.0, *) else { return }
        var intent = SearchNoMarkupIntent()
        intent.session = StubIntentSession(signedIn: false)
        intent.criteria = StringSearchCriteria(term: "bike")
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "SearchNoMarkupIntent")
    }

    func testOpenListingIntentSignedOutThrows() async {
        var intent = OpenListingIntent()
        intent.session = StubIntentSession(signedIn: false)
        intent.target = ListingEntity(id: sampleUUID, title: "Bike")
        let configured = intent
        await assertThrowsAndDoesNotNavigate({ _ = try await configured.perform() }, "OpenListingIntent")
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
        let result = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .checkIn(contractID: sampleUUID))
        // Production path does not POST — in-app UI confirms.
        let container = result as? IntentResultContainer<String, Never, Never, IntentDialog>
        XCTAssertEqual(container?.value, "opened")
    }

    func testCheckInToJobIntentSignedInRoutesWithoutContract() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = CheckInToJobIntent()
        intent.session = StubIntentSession(signedIn: true)
        _ = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .checkIn(contractID: nil))
    }

    func testCheckInToJobIntentInjectedAPIChecksIn() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        let calls = CheckInCallBox()
        var intent = CheckInToJobIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.contract = ContractEntity(id: sampleUUID)
        intent.locationCoordinateProvider = { (37.7749, -122.4194) }
        intent.checkInAPI = { contractId, lat, lng in
            await calls.record(contractId: contractId, lat: lat, lng: lng)
        }

        let result = try await intent.perform()

        XCTAssertEqual(DeepLinkRouter.shared.route, .checkIn(contractID: sampleUUID))
        let recorded = await calls.snapshot()
        XCTAssertEqual(recorded?.contractId, sampleUUID)
        XCTAssertEqual(recorded?.lat ?? 0, 37.7749, accuracy: 0.0001)
        XCTAssertEqual(recorded?.lng ?? 0, -122.4194, accuracy: 0.0001)
        let container = result as? IntentResultContainer<String, Never, Never, IntentDialog>
        XCTAssertEqual(container?.value, "checked_in")
    }

    func testSearchCatalogIntentSignedInRoutesMarketplace() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = SearchCatalogIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.query = "  vintage bike  "
        _ = try await intent.perform()

        XCTAssertEqual(
            DeepLinkRouter.shared.route,
            .catalogSearch(surface: .marketplace, query: "vintage bike")
        )
        XCTAssertEqual(DeepLinkRouter.shared.catalogSearchQuery, "vintage bike")
    }

    func testSearchNoMarkupIntentSignedInRoutesMarketplace() async throws {
        guard #available(iOS 18.0, *) else { return }
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = SearchNoMarkupIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.criteria = StringSearchCriteria(term: "  vintage bike  ")
        _ = try await intent.perform()

        XCTAssertEqual(
            DeepLinkRouter.shared.route,
            .catalogSearch(surface: .marketplace, query: "vintage bike")
        )
        XCTAssertEqual(DeepLinkRouter.shared.catalogSearchQuery, "vintage bike")
        XCTAssertEqual(DeepLinkRouter.shared.catalogSearchSurface, .marketplace)
        XCTAssertEqual(
            DeepLinkRouter.shared.consumeCatalogSearchQuery(for: .marketplace),
            "vintage bike"
        )
        XCTAssertNil(DeepLinkRouter.shared.catalogSearchQuery)
    }

    func testSearchNoMarkupIntentJobsSurface() async throws {
        guard #available(iOS 18.0, *) else { return }
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = SearchNoMarkupIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.criteria = StringSearchCriteria(term: "plumbing")
        intent.surface = .jobs
        _ = try await intent.perform()

        XCTAssertEqual(
            DeepLinkRouter.shared.route,
            .catalogSearch(surface: .jobs, query: "plumbing")
        )
        XCTAssertEqual(DeepLinkRouter.shared.consumeCatalogSearchQuery(for: .jobs), "plumbing")
        XCTAssertNil(DeepLinkRouter.shared.consumeCatalogSearchQuery(for: .marketplace))
    }

    func testOpenListingIntentSignedInRoutes() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = OpenListingIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.target = ListingEntity(id: sampleUUID, title: "Vintage road bike")
        _ = try await intent.perform()
        XCTAssertEqual(DeepLinkRouter.shared.route, .listing(id: sampleUUID))
    }

    func testCheckInToJobIntentInjectedAPIFailureStillDeepLinks() async throws {
        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        var intent = CheckInToJobIntent()
        intent.session = StubIntentSession(signedIn: true)
        intent.contract = ContractEntity(id: sampleUUID)
        intent.locationCoordinateProvider = { (1, 2) }
        intent.checkInAPI = { _, _, _ in
            throw CheckInTestError.failed
        }

        let result = try await intent.perform()

        XCTAssertEqual(DeepLinkRouter.shared.route, .checkIn(contractID: sampleUUID))
        let container = result as? IntentResultContainer<String, Never, Never, IntentDialog>
        XCTAssertEqual(container?.value, "fallback")
    }
}

// MARK: - Incoming URL scheme gate (SIM-SEC.8)

@MainActor
final class DeepLinkIncomingSchemeTests: XCTestCase {
    private let sampleUUID = "550e8400-e29b-41d4-a716-446655440000"

    override func tearDown() {
        DeepLinkRouter.shared.clear()
        super.tearDown()
    }

    func testHandleRejectsJavaScriptAndFileSchemes() {
        let router = DeepLinkRouter.shared
        router.clear()

        XCTAssertFalse(router.handle(url: URL(string: "javascript:alert(1)")!))
        XCTAssertNil(router.route)
        XCTAssertNil(router.pendingActionURL)

        XCTAssertFalse(router.handle(url: URL(string: "javascript:/jobs/\(sampleUUID)")!))
        XCTAssertNil(router.route)
        XCTAssertNil(router.pendingActionURL)

        XCTAssertFalse(router.handle(url: URL(string: "file:///jobs/\(sampleUUID)")!))
        XCTAssertNil(router.route)
        XCTAssertNil(router.pendingActionURL)

        XCTAssertFalse(router.handle(url: URL(string: "data:text/html,hi")!))
        XCTAssertNil(router.route)
        XCTAssertNil(router.pendingActionURL)
    }

    func testOpenActionURLRejectsDangerousSchemes() {
        let router = DeepLinkRouter.shared
        router.clear()
        router.open(actionURL: "javascript:/jobs/\(sampleUUID)")
        XCTAssertNil(router.route)
        XCTAssertNil(router.pendingActionURL)

        router.open(actionURL: "file:///orders/\(sampleUUID)")
        XCTAssertNil(router.route)
        XCTAssertNil(router.pendingActionURL)
    }

    func testHandleStillAcceptsNomarkupAndHTTPS() {
        let router = DeepLinkRouter.shared
        router.clear()
        XCTAssertTrue(router.handle(url: URL(string: "nomarkup://jobs/\(sampleUUID)")!))
        XCTAssertEqual(router.route, .job(id: sampleUUID))

        router.clear()
        XCTAssertTrue(router.handle(url: URL(string: "https://no-markup.com/orders")!))
        XCTAssertEqual(router.route, .orders(id: nil))
    }

    func testAllowedIncomingURLSchemes() {
        XCTAssertTrue(DeepLinkRouter.isAllowedIncomingURL(URL(string: "nomarkup://bids")!))
        XCTAssertTrue(DeepLinkRouter.isAllowedIncomingURL(URL(string: "https://no-markup.com/jobs")!))
        XCTAssertTrue(DeepLinkRouter.isAllowedIncomingURL(URL(string: "http://127.0.0.1:8081/jobs")!))
        XCTAssertFalse(DeepLinkRouter.isAllowedIncomingURL(URL(string: "javascript:alert(1)")!))
        XCTAssertFalse(DeepLinkRouter.isAllowedIncomingURL(URL(string: "file:///tmp")!))
        XCTAssertFalse(DeepLinkRouter.isAllowedIncomingURL(URL(string: "data:text/plain,x")!))
    }
}

@MainActor
final class WebSocketURLSecurityTests: XCTestCase {
    func testChatAndAuctionWSURLsHaveNoQueryToken() {
        let chat = ChatWebSocketClient.chatWebSocketURL()
        XCTAssertNotNil(chat)
        XCTAssertNil(chat?.query)
        XCTAssertFalse(chat?.absoluteString.contains("token=") ?? true)
        XCTAssertTrue(["ws", "wss"].contains(chat?.scheme ?? ""))

        let auction = AuctionWebSocketClient.auctionWebSocketURL(jobID: "550e8400-e29b-41d4-a716-446655440000")
        XCTAssertNotNil(auction)
        XCTAssertNil(auction?.query)
        XCTAssertFalse(auction?.absoluteString.contains("token=") ?? true)
        XCTAssertTrue(auction?.path.contains("/ws/auction/") ?? false)
    }
}

private enum CheckInTestError: Error, LocalizedError {
    case failed
    var errorDescription: String? { "simulated check-in failure" }
}

private actor CheckInCallBox {
    struct Call: Sendable {
        let contractId: String
        let lat: Double
        let lng: Double
    }

    private var call: Call?

    func record(contractId: String, lat: Double, lng: Double) {
        call = Call(contractId: contractId, lat: lat, lng: lng)
    }

    func snapshot() -> Call? { call }
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

    func testListingVisualSearchMatcherMatchesLabels() {
        let bike = ListingEntity(id: sampleUUID, title: "Vintage road bike")
        let chair = ListingEntity(id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Oak dining chair")
        let untitled = ListingEntity(id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: nil)
        let catalog = [bike, chair, untitled]

        let hits = ListingVisualSearchMatcher.matching(labels: ["BIKE", "unused"], in: catalog)
        XCTAssertEqual(hits.map(\.id), [sampleUUID])

        XCTAssertTrue(ListingVisualSearchMatcher.matching(labels: ["  "], in: catalog).isEmpty)
        XCTAssertTrue(ListingVisualSearchMatcher.matching(labels: ["bike"], in: []).isEmpty)
    }
}

// MARK: - Catalog search routing (IOS-INT.3)

@MainActor
final class CatalogSearchDeepLinkTests: XCTestCase {
    func testMarketplaceQueryURLs() {
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/marketplace?q=bike"),
            .catalogSearch(surface: .marketplace, query: "bike")
        )
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/search?q=oak%20chair"),
            .catalogSearch(surface: .marketplace, query: "oak chair")
        )
        XCTAssertEqual(
            DeepLinkRouter.route(from: URL(string: "nomarkup://marketplace?q=lamp")!),
            .catalogSearch(surface: .marketplace, query: "lamp")
        )
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/marketplace"),
            .catalogSearch(surface: .marketplace, query: "")
        )
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/listings/\(sampleListingID)"),
            .listing(id: sampleListingID)
        )
    }

    func testJobsQueryURLsKeepBrowseWithoutQuery() {
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/jobs?q=plumbing"),
            .catalogSearch(surface: .jobs, query: "plumbing")
        )
        XCTAssertEqual(DeepLinkRouter.route(fromActionString: "/jobs"), .jobsBrowse)
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: "/jobs/\(sampleListingID)"),
            .job(id: sampleListingID)
        )
    }

    func testCatalogSearchActionURLRoundTrip() {
        let market = DeepLinkRoute.catalogSearch(surface: .marketplace, query: "road bike")
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: market.actionURLString),
            market
        )
        let jobs = DeepLinkRoute.catalogSearch(surface: .jobs, query: "fence")
        XCTAssertEqual(
            DeepLinkRouter.route(fromActionString: jobs.actionURLString),
            jobs
        )
    }

    func testHandleMarketplaceSearchURLDeliversTypedRoute() {
        let router = DeepLinkRouter.shared
        router.clear()
        defer { router.clear() }

        XCTAssertTrue(router.handle(url: URL(string: "nomarkup://marketplace?q=bike")!))
        XCTAssertEqual(router.route, .catalogSearch(surface: .marketplace, query: "bike"))
        XCTAssertEqual(router.catalogSearchQuery, "bike")
        XCTAssertEqual(router.consumeCatalogSearchQuery(for: .jobs), nil)
        XCTAssertEqual(router.consumeCatalogSearchQuery(for: .marketplace), "bike")
    }

    private let sampleListingID = "550e8400-e29b-41d4-a716-446655440000"
}

// MARK: - App Intents Testing (IOS-INT.5)

/// `AppIntentsTesting.IntentDefinitions` is **not** in iPhoneOS 26.5 (Xcode 26.5.0):
/// searched iPhoneOS/iPhoneSimulator SDKs and Developer Library Frameworks.
/// That module is WWDC26 / Xcode 27 (`IntentDefinitions(bundleIdentifier:)` +
/// `makeIntent().run()` in a UI-test process).
///
/// SDK-equivalent on this SDK: in-process `AppIntent.perform()` — the same method
/// the system invokes inside the app. When `AppIntentsTesting` appears, the
/// `canImport` branch type-checks `IntentDefinitions`.
@MainActor
final class AppIntentsTestingFrameworkTests: XCTestCase {
    func testAppIntentsTestingModuleOrSDKEquivalentPerform() async throws {
        #if canImport(AppIntentsTesting)
        let definitions = IntentDefinitions(bundleIdentifier: "com.nomarkup.app")
        XCTAssertNotNil(definitions)
        #endif

        DeepLinkRouter.shared.clear()
        defer { DeepLinkRouter.shared.clear() }

        if #available(iOS 18.0, *) {
            var search = SearchNoMarkupIntent()
            search.session = StubIntentSession(signedIn: true)
            search.criteria = StringSearchCriteria(term: "desk lamp")
            _ = try await search.perform()
            XCTAssertEqual(
                DeepLinkRouter.shared.route,
                .catalogSearch(surface: .marketplace, query: "desk lamp")
            )
        }

        DeepLinkRouter.shared.clear()
        var open = OpenListingIntent()
        open.session = StubIntentSession(signedIn: true)
        open.target = ListingEntity(id: "550e8400-e29b-41d4-a716-446655440000", title: "Lamp")
        _ = try await open.perform()
        XCTAssertEqual(
            DeepLinkRouter.shared.route,
            .listing(id: "550e8400-e29b-41d4-a716-446655440000")
        )
    }

    func testVisualIntelligenceQueryCompilesWhenFrameworkPresent() async throws {
        XCTAssertTrue(ListingVisualSearchMatcher.matching(labels: [], in: []).isEmpty)
        #if canImport(VisualIntelligence)
        if #available(iOS 26.0, *) {
            let query = ListingVisualSearchQuery()
            // SemanticContentDescriptor has no public memberwise init in the
            // 26.5 swiftinterface; decode the documented `labels` payload.
            let descriptor = try JSONDecoder().decode(
                SemanticContentDescriptor.self,
                from: Data(#"{"labels":["bike"]}"#.utf8)
            )
            let results = try await query.values(for: descriptor)
            let catalog = try await ListingEntityQuery().suggestedEntities()
            XCTAssertEqual(
                results.map(\.id),
                ListingVisualSearchMatcher.matching(
                    labels: ["bike"],
                    in: catalog
                ).map(\.id)
            )
        }
        #endif
    }
}
