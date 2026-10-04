import SafariServices
import SwiftUI

/// In-app Safari for **legal HTML** (Privacy, Terms, Guidelines) — not a general app shell.
/// The public URL is requested first. If that load fails, Privacy, Community Guidelines,
/// and Support show copy stored in the app (IOS-DIST.17). This does not mean the live site is up.
/// `SFSafariViewController` shares cookies with Safari and uses system chrome.
struct LegalWebView: View {
    /// How to present when the public host cannot be opened.
    enum Fallback: Equatable {
        /// Try Safari; on load failure show bundled copy when we have it, otherwise Retry + Mail.
        case safari
        /// On load failure, show native Support copy + mailto. The URL is still requested first.
        case nativeSupport
    }

    let title: String
    let url: URL
    var fallback: Fallback = .safari

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var safariPhase: SafariPhase = .checking

    private static let supportMailto = URL(string: "mailto:support@no-markup.com")!

    var body: some View {
        safariFlow
            .tint(BrandTheme.accent)
    }

    /// Explicit `.nativeSupport`, title "Support", or URL path `/support`.
    static func usesNativeSupport(title: String, url: URL, fallback: Fallback) -> Bool {
        if fallback == .nativeSupport { return true }
        if title.localizedCaseInsensitiveCompare("Support") == .orderedSame { return true }
        let path = url.path.lowercased()
        return path == "/support" || path.hasPrefix("/support/")
    }

    // MARK: - Safari (Privacy / Terms / other legal URLs)

    private enum SafariPhase: Equatable {
        case checking
        case safari
        case failed
    }

    @ViewBuilder
    private var safariFlow: some View {
        switch safariPhase {
        case .checking:
            ProgressView("Loading…")
                .tint(BrandTheme.accent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
                .task { await probeHostThenPresent() }
        case .safari:
            #if os(iOS)
            SafariView(url: url)
                .ignoresSafeArea()
                .accessibilityLabel(title)
            #else
            loadFailedPage
            #endif
        case .failed:
            loadFailedPage
        }
    }

    /// Request the public URL first. Transport errors and HTTP 4xx/5xx show the
    /// stored summary. A successful response opens Safari. This does not claim the site is up.
    private func probeHostThenPresent() async {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 6
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if Task.isCancelled { return }
            if let http = response as? HTTPURLResponse, (400 ..< 600).contains(http.statusCode) {
                safariPhase = .failed
            } else {
                safariPhase = .safari
            }
        } catch {
            if Task.isCancelled { return }
            safariPhase = .failed
        }
    }

    private enum OfflineDocument {
        case privacy
        case guidelines
        case support
        case generic
    }

    /// Which stored copy to show after the network attempt fails.
    private var offlineDocument: OfflineDocument {
        if Self.usesNativeSupport(title: title, url: url, fallback: fallback) {
            return .support
        }
        let path = url.path.lowercased()
        let name = title.lowercased()
        if path.contains("privacy") || name.contains("privacy") {
            return .privacy
        }
        if path.contains("guideline") || name.contains("guideline") {
            return .guidelines
        }
        return .generic
    }

    @ViewBuilder
    private var loadFailedPage: some View {
        switch offlineDocument {
        case .support:
            nativeSupportPage
        case .privacy:
            offlineSummaryPage(
                body: LegalOfflineCopy.privacySummary,
                identifier: "legal.offline.privacy"
            )
        case .guidelines:
            offlineSummaryPage(
                body: LegalOfflineCopy.guidelinesSummary,
                identifier: "legal.offline.guidelines"
            )
        case .generic:
            genericLoadFailedPage
        }
    }

    private func offlineSummaryPage(body: String, identifier: String) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("The page couldn’t be loaded. This summary is stored in the app.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(body)
                        .font(.body)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Retry") {
                        safariPhase = .checking
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("\(identifier).retry")
                    Link(destination: Self.supportMailto) {
                        Label("Email support@no-markup.com", systemImage: "envelope")
                    }
                    .frame(minHeight: 44)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .brandScreenBackground()
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .accessibilityIdentifier(identifier)
        }
    }

    private var genericLoadFailedPage: some View {
        NavigationStack {
            BrandEmptyState(
                title: "Can't load page",
                systemImage: "wifi.slash",
                message: "This page isn't available right now.\n\(url.absoluteString)",
                actionTitle: "Retry",
                action: {
                    safariPhase = .checking
                },
                secondaryActionTitle: "Mail",
                secondaryAction: {
                    openURL(Self.supportMailto)
                }
            )
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .accessibilityIdentifier("legal.loadFailed.root")
        }
    }

    // MARK: - Native Support (DIST.17 in-app half)

    private var nativeSupportPage: some View {
        NavigationStack {
            List {
                Section {
                    Text(
                        "The support page couldn’t be loaded. Email us anytime at support@no-markup.com. We aim to respond during business hours (Pacific Time)."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    Link(destination: Self.supportMailto) {
                        Label("Email support@no-markup.com", systemImage: "envelope")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("legal.support.mail")
                } header: {
                    Text("Contact us").brandSectionHeader()
                }

                Section {
                    Text(
                        "To report prohibited content, scams, harassment, or unsafe jobs or listings, use the in-app Report control on the job, listing, message, or profile when available. Or email support@no-markup.com with the subject “Report abuse,” including URLs, display names, screenshots, and a short description."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    Text(
                        "For emergencies or imminent harm, contact local emergency services first, then notify us."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    Link(destination: URL(string: "mailto:support@no-markup.com?subject=Report%20abuse")!) {
                        Label("Report abuse by email", systemImage: "exclamationmark.bubble")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("legal.support.reportMail")
                } header: {
                    Text("Report abuse").brandSectionHeader()
                }

                Section {
                    Text(
                        "Signed-in users can export data or schedule account deletion (30-day grace) under Account → Your data. You can also email support@no-markup.com for privacy requests described in the Privacy Policy."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                } header: {
                    Text("Account and privacy").brandSectionHeader()
                }

                Section {
                    Text(
                        "Privacy Policy, Terms of Service, and Community Guidelines are in Account → Legal & support. If a page cannot be loaded, the app shows a short summary stored on this device. You do not need the website to reach support from this screen."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                } header: {
                    Text("Policies").brandSectionHeader()
                }
            }
            .brandListBackground()
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .accessibilityIdentifier("legal.support.root")
        }
    }
}

/// Privacy and community-guidelines copy shipped in the app (`LegalOfflineCopy.txt`).
/// Shown only after the public URL fails to load. Does not describe the live site as available.
enum LegalOfflineCopy {
    static var privacySummary: String {
        bundled(section: "PRIVACY") ?? privacyFallback
    }

    static var guidelinesSummary: String {
        bundled(section: "GUIDELINES") ?? guidelinesFallback
    }

    private static func bundled(section: String) -> String? {
        guard
            let url = Bundle.main.url(forResource: "LegalOfflineCopy", withExtension: "txt"),
            let text = try? String(contentsOf: url, encoding: .utf8)
        else { return nil }
        return sectionText(named: section, in: text)
    }

    private static func sectionText(named section: String, in text: String) -> String? {
        let marker = "=== \(section) ==="
        guard let start = text.range(of: marker) else { return nil }
        let after = text[start.upperBound...]
        let body: String
        if let next = after.range(of: "\n===") {
            body = String(after[..<next.lowerBound])
        } else {
            body = String(after)
        }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static let privacyFallback = """
    This summary is stored in the app because the privacy page could not be loaded. It is not the full policy.

    The app collects:
    - Account information you provide, including email and phone
    - Location when you use the map
    - Photos you choose for a job or listing
    - Payments processed by Stripe (the app does not store your full card number)
    - A device identifier so push notifications can reach this phone

    For privacy requests, email support@no-markup.com. Signed-in users can export data or schedule account deletion under Account, Your data.
    """

    private static let guidelinesFallback = """
    This summary is stored in the app because the community guidelines page could not be loaded.

    - No illegal goods or services
    - No harassment, threats, or scams
    - Report and block from the job, listing, message, or profile when those controls are shown
    - Or email support@no-markup.com with the subject "Report abuse"
    """
}

#if os(iOS)
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: config)
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {
        // URL is fixed for legal pages.
    }
}
#endif

#Preview("Privacy Safari") {
    NavigationStack {
        LegalWebView(title: "Privacy", url: AppConfig.privacyURL)
    }
}

#Preview("Support native") {
    LegalWebView(
        title: "Support",
        url: AppConfig.supportURL,
        fallback: .nativeSupport
    )
}
