import CoreSpotlight
import Foundation

/// Best-effort Core Spotlight lifecycle (IOS-INT.2 delete half).
///
/// Donation lives on detail views via `NSUserActivity` + `contentAttributeSet`.
/// Identifiers match `persistentIdentifier` (`jobID` / `listingID`).
/// Failures are ignored — index cleanup must never block sign-out or navigation.
enum SpotlightIndex {
    /// Remove specific donated items (e.g. 404 / removed content).
    static func delete(identifiers: [String]) async {
        let ids = identifiers.filter { !$0.isEmpty }
        guard !ids.isEmpty else { return }
        try? await CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids)
    }

    /// Wipe the entire app Spotlight index (e.g. sign-out).
    static func deleteAll() async {
        try? await CSSearchableIndex.default().deleteAllSearchableItems()
    }
}
