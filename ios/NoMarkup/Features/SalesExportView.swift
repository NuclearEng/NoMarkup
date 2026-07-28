import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Seller sales CSV export — `GET /api/v1/me/sales.csv` then system share sheet.
struct SalesExportView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var isExporting = false
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var shareItem: ExportFileShareItem?
    @State private var tempFileURL: URL?

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in as a seller to download your completed sales as CSV.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to export sales."
                )
            } else {
                formContent
            }
        }
        .navigationTitle("Sales export")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        #if canImport(UIKit)
        .sheet(item: $shareItem, onDismiss: {
            cleanupTempFile()
        }) { item in
            ActivityShareSheet(items: [item.url])
        }
        #endif
    }

    private var formContent: some View {
        List {
            Section {
                Text("Download a CSV of your completed marketplace sales (held, pickup-confirmed, and released escrow). Buyer names are anonymized to initials.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("About").brandSectionHeader()
            }

            Section {
                Button {
                    Task { await exportCSV() }
                } label: {
                    HStack {
                        Label("Generate sales CSV", systemImage: "tablecells")
                        Spacer()
                        if isExporting {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        }
                    }
                    .frame(minHeight: 44)
                }
                .disabled(isExporting)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Downloads sales CSV from the server and opens the share sheet")

                if let statusMessage {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Export").brandSectionHeader()
            } footer: {
                Text("Columns: order_id, listing_title, sold_at, gross_cents, fee_cents, net_cents, buyer_anonymized, escrow_status. Large histories may truncate at 10,000 rows.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @MainActor
    private func exportCSV() async {
        statusMessage = nil
        statusIsError = false
        isExporting = true
        defer { isExporting = false }

        do {
            let data = try await APIClient.shared.exportSalesCSV()
            let url = try writeTempFile(data: data, prefix: "nomarkup-sales", ext: "csv")
            statusIsError = false
            statusMessage = "CSV ready (\(data.count) bytes). Choose where to save or share."
            tempFileURL = url
            shareItem = ExportFileShareItem(url: url)
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    private func writeTempFile(data: Data, prefix: String, ext: String) throws -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date())
        let filename = "\(prefix)-\(stamp).\(ext)"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try data.write(to: url, options: .atomic)
        return url
    }

    private func cleanupTempFile() {
        if let tempFileURL {
            try? FileManager.default.removeItem(at: tempFileURL)
        }
        tempFileURL = nil
        shareItem = nil
    }
}

/// Identifiable wrapper so export uses `sheet(item:)` and never presents an empty sheet.
struct ExportFileShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

#if canImport(UIKit)
/// System share sheet for CSV / ICS temp files.
struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
#endif

#Preview {
    NavigationStack {
        SalesExportView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
