import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Jobs / contracts calendar export — `GET /api/v1/me/calendar.ics` then share sheet.
struct CalendarExportView: View {
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
                    message: "Sign in to download an iCal feed of your contracts, pickups, and auction deadlines.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to export your calendar."
                )
            } else {
                formContent
            }
        }
        .navigationTitle("Calendar export")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
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
                Text("Export an .ics calendar of your service contracts, marketplace pickups, and auction-end deadlines. Open it in Apple Calendar, Google Calendar, or Outlook.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("About").brandSectionHeader()
            }

            Section {
                Button {
                    Task { await exportICS() }
                } label: {
                    HStack {
                        Label("Generate calendar (.ics)", systemImage: "calendar.badge.clock")
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
                .accessibilityHint("Downloads an iCal file and opens the system share sheet")

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
                Text("This is a one-shot download. For continuous calendar subscription from a desktop app, use the web feed URL with a long-lived token.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @MainActor
    private func exportICS() async {
        statusMessage = nil
        statusIsError = false
        isExporting = true
        defer { isExporting = false }

        do {
            let data = try await APIClient.shared.exportCalendarICS()
            let url = try writeTempFile(data: data)
            statusIsError = false
            statusMessage = "Calendar ready (\(data.count) bytes). Share to Calendar or Files."
            tempFileURL = url
            shareItem = ExportFileShareItem(url: url)
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    private func writeTempFile(data: Data) throws -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date())
        let filename = "nomarkup-calendar-\(stamp).ics"
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

#Preview {
    NavigationStack {
        CalendarExportView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
