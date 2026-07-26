import SafariServices
import SwiftUI

/// In-app Safari for **legal / support HTML only** — not a general app shell.
/// Uses `SFSafariViewController` (shares cookies with Safari, system chrome).
struct LegalWebView: View {
    let title: String
    let url: URL

    var body: some View {
        SafariView(url: url)
            .ignoresSafeArea()
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .accessibilityLabel(title)
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

#Preview {
    NavigationStack {
        LegalWebView(title: "Privacy", url: AppConfig.privacyURL)
    }
}
