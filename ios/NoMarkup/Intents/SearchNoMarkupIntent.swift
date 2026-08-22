import AppIntents
import Foundation

/// Shared navigation for in-app catalog search (IOS-INT.3).
enum CatalogSearchIntentNavigation {
    @MainActor
    static func open(
        term: String,
        surface: CatalogSearchSurface,
        session: any IntentSessionProviding
    ) throws {
        try IntentAuthGuard.requireSession(session)
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        DeepLinkRouter.shared.open(.catalogSearch(surface: surface, query: trimmed))
    }
}

/// AppShortcuts-visible catalog search (iOS 17 deployment floor).
///
/// `SearchNoMarkupIntent` (`@AppIntent(schema: .system.search)`) is iOS 18-only because
/// the schema macro expands `@Parameter()` on `criteria` using an iOS 18 `IntentParameter`
/// init. `AppShortcutsBuilder` cannot mix `if #available` with `AppShortcut` expressions
/// at this SDK (`cannot pass array of type '[AppShortcut]' as variadic arguments`), and
/// an explicit `[AppShortcut]` array is rejected by `appintentsmetadataprocessor`
/// (`Expected an 'AppShortcut' initialization call`). This always-available intent is
/// the phrases entry; the schema intent below is what Siri/system.search binds to.
struct SearchCatalogIntent: AppIntent {
    static var title: LocalizedStringResource { "Search NoMarkup" }
    static var description: IntentDescription {
        IntentDescription("Searches marketplace listings and jobs in NoMarkup.")
    }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Query")
    var query: String

    var session: any IntentSessionProviding = KeychainTokenStore()
    var surface: CatalogSearchSurface = .marketplace

    init() {
        self.query = ""
    }

    init(
        query: String,
        session: any IntentSessionProviding = KeychainTokenStore(),
        surface: CatalogSearchSurface = .marketplace
    ) {
        self.query = query
        self.session = session
        self.surface = surface
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        try CatalogSearchIntentNavigation.open(term: query, surface: surface, session: session)
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let dialog: IntentDialog = term.isEmpty
            ? IntentDialog("Opening search in NoMarkup.")
            : IntentDialog("Searching NoMarkup for \(term).")
        return .result(dialog: dialog)
    }
}

/// In-app catalog search (IOS-INT.3) — `ShowInAppSearchResultsIntent` + `system.search`.
///
/// SDK identifier: `AssistantSchemas.SystemIntent.search` → `ShowInAppSearchResultsIntent`.
/// Siri / Spotlight “search in NoMarkup” opens Marketplace (default) and fills the
/// catalog search field the UI already reads.
@available(iOS 18.0, *)
@AppIntent(schema: .system.search)
struct SearchNoMarkupIntent: ShowInAppSearchResultsIntent {
    static var searchScopes: [StringSearchScope] { [.general] }
    static var openAppWhenRun: Bool { true }

    /// Search term provided by Siri / Spotlight / Shortcuts.
    var criteria: StringSearchCriteria

    /// Session source — injectable for tests; never refreshes tokens (INT.1).
    var session: any IntentSessionProviding = KeychainTokenStore()

    /// Optional surface override for tests / in-app callers. Production Siri uses
    /// marketplace (the photo catalog). Not a `@Parameter` — the `system.search`
    /// schema allows only `criteria`.
    var surface: CatalogSearchSurface = .marketplace

    init() {
        self.criteria = StringSearchCriteria(term: "")
    }

    init(
        criteria: StringSearchCriteria,
        session: any IntentSessionProviding = KeychainTokenStore(),
        surface: CatalogSearchSurface = .marketplace
    ) {
        self.criteria = criteria
        self.session = session
        self.surface = surface
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        try CatalogSearchIntentNavigation.open(
            term: criteria.term,
            surface: surface,
            session: session
        )
        let term = criteria.term.trimmingCharacters(in: .whitespacesAndNewlines)
        let dialog: IntentDialog = term.isEmpty
            ? IntentDialog("Opening search in NoMarkup.")
            : IntentDialog("Searching NoMarkup for \(term).")
        return .result(dialog: dialog)
    }
}
