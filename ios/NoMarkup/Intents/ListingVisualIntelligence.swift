import AppIntents
import Foundation

#if canImport(VisualIntelligence)
import VisualIntelligence
#endif

// IOS-AI.11 — Visual Intelligence over the photo-backed goods catalog.
//
// Device SDK (iPhoneOS 26.5) symbols used:
// - `IntentValueQuery` (AppIntents, iOS 26.0) — `values(for: SemanticContentDescriptor)`
// - `VisualIntelligence.SemanticContentDescriptor` (`labels`, `pixelBuffer`)
// - `@AppIntent(schema: .visualIntelligence.semanticContentSearch)` → schema
//   identifier `ShowVisualSearchResultsInAppIntent`
// - `OpenIntent` (`target: ListingEntity`) so a Visual Intelligence result tap
//   opens `/listings/{id}`
//
// `VisualIntelligence.framework` is **device-only** (tbd `targets: [arm64e-ios]`;
// no module in iPhoneSimulator.sdk). Query + schema intent compile under
// `#if canImport(VisualIntelligence)` and `@available(iOS 26.0, *)`.
// `OpenListingIntent` and the label matcher do not need that framework.
//
// User-facing copy never says "Apple Intelligence" (IOS-AI.18).

/// Label matcher shared by Visual Intelligence and unit tests. Offline only:
/// titles come from the widget snapshot via `ListingEntityQuery` (INT.1 / INT.2).
enum ListingVisualSearchMatcher {
    /// Returns listings whose title contains any of `labels` (diacritic-insensitive).
    /// Empty labels or an empty catalog → `[]` (Visual Intelligence shows no results).
    static func matching(labels: [String], in catalog: [ListingEntity]) -> [ListingEntity] {
        let needles = labels
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !needles.isEmpty else { return [] }
        return catalog.filter { listing in
            let haystack = listing.title ?? ""
            guard !haystack.isEmpty else { return false }
            return needles.contains { haystack.localizedStandardContains($0) }
        }
    }
}

/// Opens a marketplace listing from Spotlight / Visual Intelligence result taps.
///
/// `OpenIntent` is the documented companion to `IntentValueQuery`: without it the
/// system has no way to navigate into the matched `ListingEntity`.
struct OpenListingIntent: OpenIntent {
    static var title: LocalizedStringResource { "Open Listing" }
    static var description: IntentDescription {
        IntentDescription("Opens a marketplace listing in NoMarkup.")
    }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Listing")
    var target: ListingEntity

    /// Session source — injectable for tests; never refreshes tokens (INT.1).
    var session: any IntentSessionProviding = KeychainTokenStore()

    init() {
        self.target = ListingEntity(id: "", title: nil)
    }

    init(target: ListingEntity, session: any IntentSessionProviding = KeychainTokenStore()) {
        self.target = target
        self.session = session
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        try IntentAuthGuard.requireSession(session)
        let id = target.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            DeepLinkRouter.shared.open(.catalogSearch(surface: .marketplace, query: ""))
            return .result()
        }
        DeepLinkRouter.shared.open(.listing(id: id))
        return .result()
    }
}

#if canImport(VisualIntelligence)
/// Visual Intelligence image/screenshot query over `ListingEntity`.
///
/// Matching uses `SemanticContentDescriptor.labels` against the offline listing
/// snapshot. There is no on-device catalog image index; a missing `pixelBuffer`
/// or empty labels returns `[]` rather than inventing hits.
@available(iOS 26.0, *)
struct ListingVisualSearchQuery: IntentValueQuery {
    func values(for input: SemanticContentDescriptor) async throws -> [ListingEntity] {
        let catalog = try await ListingEntityQuery().suggestedEntities()
        return ListingVisualSearchMatcher.matching(labels: input.labels, in: catalog)
    }
}

/// Opens Marketplace search from a Visual Intelligence “open in app” handoff.
/// Schema: `.visualIntelligence.semanticContentSearch` (`ShowVisualSearchResultsInAppIntent`).
@available(iOS 26.0, *)
@AppIntent(schema: .visualIntelligence.semanticContentSearch)
struct ShowVisualSearchResultsIntent {
    static var openAppWhenRun: Bool { true }

    var semanticContent: SemanticContentDescriptor

    var session: any IntentSessionProviding = KeychainTokenStore()

    @MainActor
    func perform() async throws -> some IntentResult {
        try IntentAuthGuard.requireSession(session)
        let query = semanticContent.labels
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        DeepLinkRouter.shared.open(.catalogSearch(surface: .marketplace, query: query))
        return .result()
    }
}
#endif
