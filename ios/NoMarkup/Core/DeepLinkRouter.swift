import Foundation
import SwiftUI

/// Central deep-link / App Intent / push destination bus.
///
/// Consumed by:
/// - `RootTabView` (`pendingActionURL` from APNs, `route` from App Intents / custom URL)
/// - App Intents (`OpenMyBidsIntent`, etc.)
/// - Widgets (`nomarkup://…` via `widgetURL`)
/// - `PushRegistration` notification taps
@MainActor
final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()

    /// Path or absolute URL from push `action_url` / userInfo (existing consumers).
    @Published var pendingActionURL: String?

    /// Typed route from App Intents, `onOpenURL`, or widgets.
    @Published private(set) var route: DeepLinkRoute?

    /// Bumped on every typed `open` so identical consecutive routes still fire `onChange`.
    @Published private(set) var sequence: UInt = 0

    private init() {}

    // MARK: - Push / string paths (legacy + NotificationDeepLink)

    func open(actionURL: String?) {
        let trimmed = actionURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return }
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
        self.route = route
        sequence &+= 1
        // Do not also set pendingActionURL — RootTabView presents once via `sequence`/`route`.
    }

    func clear() {
        pendingActionURL = nil
        route = nil
    }

    /// Parse `nomarkup://…` custom scheme or https host paths into a route.
    @discardableResult
    func handle(url: URL) -> Bool {
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
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "nomarkup" {
            return routeFromNomarkupURL(url)
        }
        if scheme == "https" || scheme == "http" {
            return routeFromPath(url.path)
        }
        return nil
    }

    private static func routeFromNomarkupURL(_ url: URL) -> DeepLinkRoute? {
        var parts: [String] = []
        if let host = url.host, !host.isEmpty {
            parts.append(host)
        }
        let pathParts = url.path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        parts.append(contentsOf: pathParts)
        guard let first = parts.first?.lowercased() else { return nil }
        return routeFromSegments([first] + Array(parts.dropFirst()))
    }

    private static func routeFromPath(_ path: String) -> DeepLinkRoute? {
        let parts = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        let trimmed: [String]
        if parts.count >= 2, parts[0].lowercased() == "api", parts[1].lowercased() == "v1" {
            trimmed = Array(parts.dropFirst(2))
        } else {
            trimmed = parts
        }
        return routeFromSegments(trimmed)
    }

    private static func routeFromSegments(_ parts: [String]) -> DeepLinkRoute? {
        guard let head = parts.first?.lowercased() else { return nil }
        switch head {
        case "bids", "my-bids", "mybids":
            return .bids
        case "watchlist", "watching":
            return .watchlist
        case "messages", "chat", "channels":
            return .messages
        case "notifications", "inbox":
            return .notifications
        case "post-job", "postjob", "jobs-new":
            return .postJob
        case "check-in", "checkin":
            if parts.count >= 2 {
                return .checkIn(contractID: parts[1])
            }
            return .checkIn(contractID: nil)
        case "jobs", "job":
            if parts.count >= 2 {
                return .job(id: parts[1])
            }
            return .postJob
        case "listings", "listing", "marketplace", "auctions", "auction":
            // /marketplace/listings/{id} or /auctions/{id} → listing
            if parts.count >= 3, parts[1].lowercased() == "listings" {
                return .listing(id: parts[2])
            }
            if parts.count >= 2 {
                return .listing(id: parts[1])
            }
            return nil
        case "orders", "order":
            // Orders list / detail — surface via messages-adjacent account sheet path later;
            // keep string pendingActionURL for NotificationDeepLink when typed route is nil.
            return nil
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
    case checkIn(contractID: String?)

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
        case .checkIn(let id): return "checkIn:\(id ?? "")"
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
        case .checkIn(let id):
            if let id, !id.isEmpty { return "/contracts/\(id)" }
            return "/contracts"
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
