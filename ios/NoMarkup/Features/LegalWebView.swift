import SafariServices
import SwiftUI

/// In-app Safari for **legal HTML** (Privacy, Terms, Guidelines) — not a general app shell.
/// Support uses a native page so NXDOMAIN on `no-markup.com` is not a dead-end (IOS-DIST.17).
/// `SFSafariViewController` shares cookies with Safari and uses system chrome.
struct LegalWebView: View {
    /// How to present when the public host cannot be opened.
    enum Fallback: Equatable {
        /// Try Safari; on DNS/load failure show a generic "Can't load page" + Retry + Mail.
        case safari
        /// Always show native Support copy + mailto (do not open Safari).
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
        Group {
            if usesNativeSupport {
                nativeSupportPage
            } else {
                safariFlow
            }
        }
        .tint(BrandTheme.accent)
    }

    /// Explicit `.nativeSupport`, title "Support", or URL path `/support`.
    static func usesNativeSupport(title: String, url: URL, fallback: Fallback) -> Bool {
        if fallback == .nativeSupport { return true }
        if title.localizedCaseInsensitiveCompare("Support") == .orderedSame { return true }
        let path = url.path.lowercased()
        return path == "/support" || path.hasPrefix("/support/")
    }

    private var usesNativeSupport: Bool {
        Self.usesNativeSupport(title: title, url: url, fallback: fallback)
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

    /// DNS/host probe so NXDOMAIN never presents a blank Safari sheet.
    /// Non-DNS errors still open Safari (HEAD 405, slow origin, etc.).
    private func probeHostThenPresent() async {
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 6
        do {
            _ = try await URLSession.shared.data(for: request)
            safariPhase = .safari
        } catch {
            let code = (error as? URLError)?.code
            switch code {
            case .cannotFindHost, .dnsLookupFailed:
                safariPhase = .failed
            default:
                safariPhase = .safari
            }
        }
    }

    private var loadFailedPage: some View {
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
                        "Email us anytime at support@no-markup.com. We aim to respond during business hours (Pacific Time)."
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
                        "Privacy Policy, Terms of Service, and Community Guidelines are in Account → Legal & support. The public web copies live at no-markup.com when that host is provisioned; they are not required to reach support from this screen."
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
