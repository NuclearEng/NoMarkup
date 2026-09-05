import AppIntents
import Foundation

// INT.3 closed: `SearchNoMarkupIntent` (`@AppIntent(schema: .system.search)` /
// `ShowInAppSearchResultsIntent`) plus always-available `SearchCatalogIntent` in
// AppShortcuts. Visual Intelligence: `ListingVisualIntelligence.swift`.

// MARK: - Session guard (IOS-INT.1)

/// Read-only session presence for App Intents. Conforming types must never perform a
/// network token refresh — an intent either has a stored session or throws.
protocol IntentSessionProviding: Sendable {
    /// True when a signed-in session is stored on this device.
    func hasStoredSession() -> Bool
}

extension KeychainTokenStore: IntentSessionProviding {
    /// A stored access OR refresh token counts as a session: the access token may be
    /// expired, but the app can refresh it after launching — the intent itself must
    /// never attempt that refresh (INT.1).
    func hasStoredSession() -> Bool {
        hasAccessToken() || hasRefreshToken()
    }
}

/// Signed-out failure for App Intents (INT.1). Intents run in the app process but
/// headless (Siri / Shortcuts / Spotlight): navigating while signed out would
/// "succeed" and strand the user on LoginView with the route silently dropped
/// (`RootTabView` only mounts when authenticated), so the guard fails fast with a
/// sign-in message instead.
enum IntentAuthGuard {
    /// Throws a sign-in error when no session is stored. Never refreshes tokens.
    static func requireSession(
        _ session: any IntentSessionProviding = KeychainTokenStore()
    ) throws {
        guard session.hasStoredSession() else {
            throw signedOutError()
        }
    }

    /// iOS 18+: the system-standard sign-in error, which Siri / Shortcuts render with
    /// the canonical "needs sign-in" treatment. iOS 17 (deployment floor): a
    /// LocalizedError with explicit guidance. Note `needsToContinueInAppError` does
    /// not exist in the installed SDK's AppIntents interface —
    /// `AppIntentError.UserActionRequired.signin` is the verified equivalent.
    static func signedOutError() -> any Error {
        if #available(iOS 18.0, *) {
            return AppIntentError.UserActionRequired.signin
        }
        return IntentSignedOutError()
    }
}

/// Pre-iOS 18 signed-out error with actionable copy (INT.1).
struct IntentSignedOutError: LocalizedError {
    var errorDescription: String? {
        "You're signed out of NoMarkup. Open the app and sign in, then try again."
    }
}

// MARK: - Entities (IOS-INT.2)
//
// IOS-INT.4 (view annotations) — closed via the verified NSUserActivity bridge:
// `JobDetailView` / `ListingDetailView` set `activity.appEntityIdentifier =
// EntityIdentifier(for:identifier:)` (`AppEntityAnnotatable`, iOS 18.2+) on the view
// activities they already donate, linking the on-screen view to `JobEntity` /
// `ListingEntity` below. The installed SDK (iPhoneOS 26.5) has no SwiftUI
// `.appEntity`-style view modifier (searched the SwiftUI and _AppIntents_SwiftUI
// swiftinterfaces); the NSUserActivity property is the only view↔entity
// association API present.

/// Read-only, non-network source shared by the entity queries: the app-group widget
/// snapshot (`WidgetSharedStore`) of auctions the user has bid on. `kind` is written
/// as `"job"` / `"listing"` by the Live Activity path.
private enum IntentEntitySnapshot {
    static func auctions(kind: String) -> [WidgetSharedStore.AuctionSnapshot] {
        WidgetSharedStore.load().auctions.filter { $0.kind == kind }
    }

    static func titlesByID(kind: String) -> [String: String] {
        var titles: [String: String] = [:]
        for auction in auctions(kind: kind) {
            titles[auction.id] = auction.title
        }
        return titles
    }
}

/// Service job (reverse auction) as an App Intents entity. The identifier is the job
/// UUID — the same id `DeepLinkRouter` deep-links via `/jobs/{id}`.
struct JobEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Job" }
    static var defaultQuery: JobEntityQuery { JobEntityQuery() }

    /// Job UUID (deep-linkable: `/jobs/{id}`).
    var id: String
    /// Title when known (widget snapshot); nil when resolved from a bare identifier.
    var title: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title ?? "Job")",
            subtitle: "Service job"
        )
    }
}

struct JobEntityQuery: EntityQuery {
    /// Resolves offline: identifiers are deep-linkable UUIDs, enriched with a title
    /// when the widget snapshot knows the job. No network (INT.1 / INT.2).
    func entities(for identifiers: [String]) async throws -> [JobEntity] {
        let titles = IntentEntitySnapshot.titlesByID(kind: "job")
        return identifiers
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { JobEntity(id: $0, title: titles[$0]) }
    }

    /// Jobs the user is actively bidding on, from the app-group widget snapshot —
    /// the only non-network job source available to the intent process. Empty when
    /// the snapshot is (e.g. before the first bid).
    func suggestedEntities() async throws -> [JobEntity] {
        IntentEntitySnapshot.auctions(kind: "job")
            .map { JobEntity(id: $0.id, title: $0.title) }
    }
}

/// Marketplace listing (forward auction) as an App Intents entity. The identifier is
/// the listing UUID — the same id `DeepLinkRouter` deep-links via `/listings/{id}`.
struct ListingEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Listing" }
    static var defaultQuery: ListingEntityQuery { ListingEntityQuery() }

    /// Listing UUID (deep-linkable: `/listings/{id}`).
    var id: String
    /// Title when known (widget snapshot); nil when resolved from a bare identifier.
    var title: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title ?? "Listing")",
            subtitle: "Marketplace listing"
        )
    }
}

struct ListingEntityQuery: EntityQuery {
    /// Resolves offline: identifiers are deep-linkable UUIDs, enriched with a title
    /// when the widget snapshot knows the listing. No network (INT.1 / INT.2).
    func entities(for identifiers: [String]) async throws -> [ListingEntity] {
        let titles = IntentEntitySnapshot.titlesByID(kind: "listing")
        return identifiers
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { ListingEntity(id: $0, title: titles[$0]) }
    }

    /// Listings the user is actively bidding on, from the app-group widget snapshot —
    /// the only non-network listing source available to the intent process. Empty when
    /// the snapshot is (e.g. before the first bid).
    func suggestedEntities() async throws -> [ListingEntity] {
        IntentEntitySnapshot.auctions(kind: "listing")
            .map { ListingEntity(id: $0.id, title: $0.title) }
    }
}

// Spotlight indexability (INT.2): `IndexedEntity` is iOS 18+ while the app targets
// iOS 17, so the conformances are availability-gated. `attributeSet` falls back to
// the SDK's `defaultAttributeSet` (derived from `displayRepresentation`). Donation
// calls (`CSSearchableIndex.indexAppEntities`) belong to the detail views'
// NSUserActivity/CoreSpotlight work, not to this file.
@available(iOS 18.0, *)
extension JobEntity: IndexedEntity {}

@available(iOS 18.0, *)
extension ListingEntity: IndexedEntity {}

// MARK: - Shortcuts provider

/// Siri / Shortcuts phrases for NoMarkup App Intents (IOS-SYS.AI.1).
///
/// Search phrases bind to `SearchCatalogIntent` (always available). The iOS 18
/// `SearchNoMarkupIntent` (`system.search` schema) cannot sit in this builder:
/// `@available(iOS 18)` + `if #available` hits `AppShortcutsBuilder.buildBlock`
/// (`cannot pass array of type '[AppShortcut]'`), and an explicit array is
/// rejected by `appintentsmetadataprocessor`.
struct NoMarkupAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenMyBidsIntent(),
            phrases: [
                "Open my bids in \(.applicationName)",
                "Show my bids in \(.applicationName)",
                "My bids on \(.applicationName)",
            ],
            shortTitle: "My Bids",
            systemImageName: "hammer.fill"
        )
        AppShortcut(
            intent: OpenWatchlistIntent(),
            phrases: [
                "Open my watchlist in \(.applicationName)",
                "Show watchlist in \(.applicationName)",
                "What am I watching on \(.applicationName)",
            ],
            shortTitle: "Watchlist",
            systemImageName: "eye.fill"
        )
        AppShortcut(
            intent: CheckInToJobIntent(),
            phrases: [
                "Check in to job with \(.applicationName)",
                "Job site check in on \(.applicationName)",
                "Check in with \(.applicationName)",
            ],
            shortTitle: "Check In",
            systemImageName: "mappin.and.ellipse"
        )
        AppShortcut(
            intent: OpenPostJobIntent(),
            phrases: [
                "Post a job on \(.applicationName)",
                "New job on \(.applicationName)",
                "Create a job with \(.applicationName)",
            ],
            shortTitle: "Post Job",
            systemImageName: "plus.circle.fill"
        )
        AppShortcut(
            intent: SearchCatalogIntent(),
            phrases: [
                "Search \(.applicationName)",
                "Find on \(.applicationName)",
                "Search listings in \(.applicationName)",
            ],
            shortTitle: "Search",
            systemImageName: "magnifyingglass"
        )
    }
}
