import Foundation

/// Pre-prompt and Info.plist purpose strings for CoreLocation.
/// Source of truth: `docs/compliance/privacy-purpose-string-inventory.md`.
///
/// Check-in-only draft (inventory row 11 — keep for feature-scoped pre-prompts):
/// "NoMarkup uses your location to confirm you arrived at the job site. Check-in location is stored with the contract for dispute protection."
///
/// Market-only draft (inventory row 9):
/// "NoMarkup uses your location to suggest the nearest marketplace city. You can always pick a city manually."
enum LocationPurposeCopy {
    /// Combined `NSLocationWhenInUseUsageDescription` for the single When-In-Use key.
    /// Market picker + job-site check-in (broader string required when one authorization covers both).
    static let systemWhenInUseUsageDescription =
        "NoMarkup uses your location to suggest the nearest marketplace city and, when you check in to a job, to confirm you arrived at the job site for dispute protection. You can pick a city manually."

    /// In-app pre-prompt before requesting When-In-Use for market selection.
    static let marketPickerPrePrompt =
        "Used to find your nearest NoMarkup market. You can always pick a city manually."

    /// In-app pre-prompt before GPS check-in / check-out.
    static let jobSiteCheckInPrePrompt =
        "Location confirms you arrived at the job site. It is stored with the contract for dispute protection. GPS is required for check-in."

    /// Photo library purpose (Info.plist) — consolidated product uses.
    static let photoLibraryUsageDescription =
        "NoMarkup needs access to your photos so you can set a profile picture, add portfolio images, and attach photos to jobs, listings, and claims."

    /// Camera purpose (Info.plist) — only declare when capture is enabled in binary.
    static let cameraUsageDescription =
        "NoMarkup uses the camera so you can take photos for jobs, listings, or your profile instead of choosing an existing photo."
}
