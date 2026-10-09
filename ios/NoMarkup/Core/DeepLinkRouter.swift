import Foundation
import SwiftUI

/// Central deep-link / App Intent / push destination bus.
///
/// Consumed by:
/// - `RootTabView` (`pendingActionURL` from APNs, `route` from App Intents / custom URL)
/// - App Intents (`OpenMyBidsIntent`, `SearchNoMarkupIntent`, etc.)
/// - Widgets (`nomarkup://…` via `widgetURL`)
/// - `PushRegistration` notification taps
///
/// Catalog search (`SearchNoMarkupIntent` / Visual Intelligence) publishes
/// `catalogSearchQuery` for MarketplaceView / JobsView to copy into their search fields.
@MainActor
final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()

    /// Path or absolute URL from push `action_url` / userInfo (existing consumers).
    @Published var pendingActionURL: String?

    /// Typed route from App Intents, `onOpenURL`, or widgets.
    @Published private(set) var route: DeepLinkRoute?

    /// Bumped on every typed `open` so identical consecutive routes still fire `onChange`.
    @Published private(set) var sequence: UInt = 0

    /// Latest catalog search term from App Intents / `?q=` URLs. Survives `clear()`
    /// until `consumeCatalogSearchQuery(for:)` — `RootTabView` clears the typed route
    /// after switching tabs, and the catalog view reads this independently.
    @Published private(set) var catalogSearchQuery: String?

    /// Which catalog tab should apply `catalogSearchQuery`.
    @Published private(set) var catalogSearchSurface: CatalogSearchSurface?

    private init() {}

    // MARK: - Push / string paths (legacy + NotificationDeepLink)

    func open(actionURL: String?) {
        let trimmed = actionURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return }
        // Absolute URLs must be an allowed scheme (reject javascript: / file: / data:).
        if let url = URL(string: trimmed), url.scheme != nil {
            guard Self.isAllowedIncomingURL(url) else { return }
        }
        // Prefer typed route when we can parse it (App Intents / known paths).
        if let parsed = Self.route(fromActionString: trimmed) {
            open(parsed)
            return
        }
        // Fallback: NotificationDeepLink string parser (covers any path we haven't typed yet).
        pendingActionURL = trimmed
    }

    // MARK: - Typed routes (App Intents / custom scheme)

    func open(_ route: DeepLinkRoute) {
        if case .catalogSearch(let surface, let query) = route {
            catalogSearchQuery = query
            catalogSearchSurface = surface
        } else {
            catalogSearchQuery = nil
            catalogSearchSurface = nil
        }
        self.route = route
        sequence &+= 1
        // Do not also set pendingActionURL — RootTabView presents once via `sequence`/`route`.
    }

    func clear() {
        pendingActionURL = nil
        route = nil
        catalogSearchQuery = nil
        catalogSearchSurface = nil
    }

    /// Drop the typed route without discarding an in-flight catalog search query.
    func acknowledgeRoute() {
        pendingActionURL = nil
        route = nil
    }

    /// Returns and clears the pending catalog search when it targets `surface`.
    func consumeCatalogSearchQuery(for surface: CatalogSearchSurface) -> String? {
        guard catalogSearchSurface == surface else { return nil }
        let query = catalogSearchQuery
        catalogSearchQuery = nil
        catalogSearchSurface = nil
        return query
    }

    /// Parse `nomarkup://…` custom scheme or https host paths into a route.
    /// Rejects `javascript:`, `file:`, `data:`, and any other non-allowlisted scheme.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard Self.isAllowedIncomingURL(url) else { return false }
        if let route = Self.route(from: url) {
            open(route)
            return true
        }
        // Fall back: store raw absolute string for NotificationDeepLink parser.
        let s = url.absoluteString
        if !s.isEmpty {
            pendingActionURL = s
            return true
        }
        return false
    }

    /// Schemes the app will navigate from (`onOpenURL`, push `action_url`, widgets).
    /// Path-only strings (no scheme) are handled separately by `open(actionURL:)`.
    /// `nonisolated` so NotificationDeepLink (and unit tests) can reject
    /// `javascript:` / `file:` / `data:` without hopping onto the main actor.
    nonisolated static func isAllowedIncomingURL(_ url: URL) -> Bool {
        switch (url.scheme ?? "").lowercased() {
        case "nomarkup", "https", "http":
            return true
        default:
            return false
        }
    }

    // MARK: - Parsing

    static func route(fromActionString raw: String) -> DeepLinkRoute? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), url.scheme != nil {
            return route(from: url)
        }
        return routeFromPath(trimmed.hasPrefix("/") ? trimmed : "/" + trimmed)
    }

    static func route(from url: URL) -> DeepLinkRoute? {
        guard let parts = segments(from: url) else { return nil }
        return routeFromSegments(parts, queryItems: queryItems(from: url))
    }

    private static func routeFromPath(_ path: String) -> DeepLinkRoute? {
        let pathPart: String
        let items: [URLQueryItem]?
        if let q = path.firstIndex(of: "?") {
            pathPart = String(path[..<q])
            let query = String(path[path.index(after: q)...])
            items = URLComponents(string: "https://no-markup.com?\(query)")?.queryItems
        } else {
            pathPart = path
            items = nil
        }
        return routeFromSegments(segments(fromPath: pathPart), queryItems: items)
    }

    private static func queryItems(from url: URL) -> [URLQueryItem]? {
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            return items
        }
        return URLComponents(string: url.absoluteString)?.queryItems
    }

    private static func queryValue(_ items: [URLQueryItem]?, names: String...) -> String? {
        guard let items else { return nil }
        for name in names {
            if let raw = items.first(where: { $0.name.lowercased() == name })?.value {
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
        }
        return nil
    }

    /// URL → normalized path segments. `nomarkup://` counts the host as the first
    /// segment (`nomarkup://orders/x` → `["orders", "x"]`); http(s) uses the path.
    /// Returns nil for any other scheme.
    private static func segments(from url: URL) -> [String]? {
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "nomarkup" {
            var parts: [String] = []
            if let host = url.host, !host.isEmpty {
                parts.append(host)
            }
            let pathParts = url.path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
            parts.append(contentsOf: pathParts)
            return parts
        }
        if scheme == "https" || scheme == "http" {
            return segments(fromPath: url.path)
        }
        return nil
    }

    /// Path string → segments with any leading `/api/v1` prefix stripped.
    private static func segments(fromPath path: String) -> [String] {
        let parts = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        if parts.count >= 2, parts[0].lowercased() == "api", parts[1].lowercased() == "v1" {
            return Array(parts.dropFirst(2))
        }
        return parts
    }

    private static func routeFromSegments(
        _ parts: [String],
        queryItems: [URLQueryItem]? = nil
    ) -> DeepLinkRoute? {
        guard let head = parts.first?.lowercased() else { return nil }
        let searchQuery = queryValue(queryItems, names: "q", "query")
        switch head {
        case "bids", "my-bids", "mybids":
            return .bids
        case "watchlist", "watching":
            return .watchlist
        case "messages", "chat", "channels":
            return .messages
        case "notifications", "inbox":
            return .notifications
        case "account", "me", "profile":
            return .account
        case "post-job", "postjob", "jobs-new":
            return .postJob
        case "check-in", "checkin":
            if parts.count >= 2 {
                return .checkIn(contractID: parts[1])
            }
            return .checkIn(contractID: nil)
        case "search":
            let term = searchQuery ?? parts.dropFirst().joined(separator: " ")
            return .catalogSearch(surface: .marketplace, query: term)
        case "jobs", "job":
            if parts.count >= 2 {
                // `/jobs/new` is the create funnel; a bare `/jobs` is browse.
                if parts[1].lowercased() == "new" {
                    return .postJob
                }
                return .job(id: parts[1])
            }
            if let searchQuery {
                return .catalogSearch(surface: .jobs, query: searchQuery)
            }
            return .jobsBrowse
        case "listings", "listing", "marketplace", "auctions", "auction":
            // /marketplace/listings/{id} or /auctions/{id} → listing
            if parts.count >= 3, parts[1].lowercased() == "listings" {
                return .listing(id: parts[2])
            }
            if parts.count >= 2 {
                return .listing(id: parts[1])
            }
            return .catalogSearch(surface: .marketplace, query: searchQuery ?? "")
        case "orders", "order":
            // Orders (IOS-SEC.9): typed end-to-end. `nomarkup://orders` has an empty
            // `URL.path` (host-only), so a raw-string fallback would dead-end — the
            // typed case guarantees delivery to the My Orders surface.
            if parts.count >= 2 {
                return .orders(id: parts[1])
            }
            return .orders(id: nil)
        case "contracts", "contract":
            if parts.count >= 2 {
                return .contract(id: parts[1])
            }
            return nil
        case "stripe-redirect":
            return nil
        default:
            return nil
        }
    }
}

/// Catalog tab that should receive an in-app search term (IOS-INT.3).
enum CatalogSearchSurface: String, Equatable, Hashable, Sendable {
    case marketplace
    case jobs
}

/// In-app destinations opened from URLs, push, widgets, and App Intents.
enum DeepLinkRoute: Equatable, Hashable, Identifiable {
    case job(id: String)
    case listing(id: String)
    case bids
    case messages
    case contract(id: String)
    case notifications
    case watchlist
    case postJob
    /// Jobs tab browse (`/jobs` / `nomarkup://jobs`) — not the create sheet.
    case jobsBrowse
    /// Account tab (`/account` / `nomarkup://account`).
    case account
    case checkIn(contractID: String?)
    /// My Orders (IOS-SEC.9). `id` is the order UUID when the link carried one;
    /// the surface is the same either way (`MyOrdersView` has no detail init yet).
    case orders(id: String?)
    /// In-app catalog search (IOS-INT.3). Switches to Marketplace or Jobs and
    /// publishes `catalogSearchQuery` for the search field already on those views.
    case catalogSearch(surface: CatalogSearchSurface, query: String)

    var id: String {
        switch self {
        case .job(let id): return "job:\(id)"
        case .listing(let id): return "listing:\(id)"
        case .bids: return "bids"
        case .messages: return "messages"
        case .contract(let id): return "contract:\(id)"
        case .notifications: return "notifications"
        case .watchlist: return "watchlist"
        case .postJob: return "postJob"
        case .jobsBrowse: return "jobsBrowse"
        case .account: return "account"
        case .checkIn(let id): return "checkIn:\(id ?? "")"
        case .orders(let id): return "orders:\(id ?? "")"
        case .catalogSearch(let surface, let query): return "catalogSearch:\(surface.rawValue):\(query)"
        }
    }

    /// Path string compatible with `NotificationDeepLink` where possible.
    var actionURLString: String {
        switch self {
        case .job(let id): return "/jobs/\(id)"
        case .listing(let id): return "/listings/\(id)"
        case .bids: return "/bids"
        case .messages: return "/messages"
        case .contract(let id): return "/contracts/\(id)"
        case .notifications: return "/notifications"
        case .watchlist: return "/watchlist"
        case .postJob: return "/jobs/new"
        case .jobsBrowse: return "/jobs"
        case .account: return "/account"
        case .checkIn(let id):
            if let id, !id.isEmpty { return "/contracts/\(id)" }
            return "/contracts"
        case .orders(let id):
            if let id, !id.isEmpty { return "/orders/\(id)" }
            return "/orders"
        case .catalogSearch(let surface, let query):
            var comps = URLComponents()
            comps.path = surface == .jobs ? "/jobs" : "/marketplace"
            if !query.isEmpty {
                comps.queryItems = [URLQueryItem(name: "q", value: query)]
            }
            return comps.string ?? comps.path
        }
    }
}

extension Notification.Name {
    /// Posted when a remote/local notification is tapped. `userInfo["action_url"]` is a String.
    /// Raw name: `NoMarkupOpenNotificationDeepLink`.
    static let noMarkupOpenNotificationDeepLink = Notification.Name("NoMarkupOpenNotificationDeepLink")

    /// Posted when an App Intent wants navigation (optional mirror of `DeepLinkRouter.open`).
    static let noMarkupDeepLink = Notification.Name("com.nomarkup.deeplink")
}
