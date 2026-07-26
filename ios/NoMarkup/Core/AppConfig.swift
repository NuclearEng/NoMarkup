import Foundation

/// Runtime configuration for the native client.
///
/// API base URL resolution order:
/// 1. Process environment `NOMARKUP_API_BASE_URL` (debug launches, CI)
/// 2. Info.plist key `APIBaseURL` (release packaging)
/// 3. Debug default `http://localhost:8081` (matches local gateway / `.env.local`)
/// 4. Release default `https://api.no-markup.com`
enum AppConfig {
    /// Production marketing / legal site (hyphenated zone).
    static let publicWebBaseURL = URL(string: "https://no-markup.com")!

    static let privacyURL = publicWebBaseURL.appending(path: "privacy")
    static let termsURL = publicWebBaseURL.appending(path: "terms")
    static let communityGuidelinesURL = publicWebBaseURL.appending(path: "community-guidelines")
    static let supportURL = publicWebBaseURL.appending(path: "support")

    /// Gateway HTTP base (no trailing slash).
    ///
    /// Resolution:
    /// 1. `NOMARKUP_API_BASE_URL` env (any configuration)
    /// 2. **DEBUG:** `http://localhost:8080` (matches `.env.example` GATEWAY_PORT / NEXT_PUBLIC_API_URL)
    /// 3. Info.plist `APIBaseURL` (release packaging override)
    /// 4. `https://api.no-markup.com`
    static var apiBaseURL: URL {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_API_BASE_URL"],
           let url = URL(string: env), !env.isEmpty {
            return url
        }

        #if DEBUG
        return URL(string: "http://localhost:8080")!
        #else
        if let plist = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
           let url = URL(string: plist), !plist.isEmpty {
            return url
        }
        return URL(string: "https://api.no-markup.com")!
        #endif
    }

    static var apiBaseURLString: String {
        apiBaseURL.absoluteString
    }

    /// Bundle display name for chrome / about.
    static var appDisplayName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? "NoMarkup"
    }

    static var shortVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    }

    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    }
}
