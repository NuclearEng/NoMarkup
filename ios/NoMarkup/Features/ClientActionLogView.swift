import SwiftUI

/// Local + server API hop log — pairs a tap/submit with gateway `X-Request-ID`.
struct ClientActionLogView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @ObservedObject private var log = ClientActionLog.shared

    @State private var serverRows: [ClientActionLog.MeActivityItem] = []
    @State private var serverNote = ""
    @State private var isLoadingServer = false

    private var merged: [ClientActionLog.MergedActionEvent] {
        ClientActionLog.mergeActivity(local: log.events, server: serverRows)
    }

    private var httpCount: Int { merged.filter { $0.kind == "http" }.count }

    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 4) {
                Text("HTTP hops: \(httpCount)")
                    .font(.caption.monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
                    .accessibilityIdentifier("requestLog.httpCount")
                    .accessibilityValue("\(httpCount)")
                if !serverNote.isEmpty {
                    Text(serverNote)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .accessibilityIdentifier("requestLog.serverNote")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
            .padding(.horizontal, 16)

            if merged.isEmpty && !isLoadingServer {
                BrandEmptyState(
                    title: "No requests yet",
                    systemImage: "list.clipboard",
                    message: "Open another Account destination or pull to refresh a list. Each API call appears here with status, duration, and request id."
                )
                .accessibilityIdentifier("requestLog.empty")
            } else if merged.isEmpty && isLoadingServer {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading request log…")
                    .accessibilityIdentifier("requestLog.loading")
            } else {
                List {
                    Section {
                        Text("This device plus server activity when signed in. Last \(ClientActionLog.capacity) local hops. Bodies, tokens, query strings, and typed field values are never stored. Quote the request id on HTTP rows when matching gateway logs.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                    Section {
                        ForEach(merged) { event in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(event.kind)
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(BrandTheme.goldBright)
                                    Text(event.method)
                                        .font(.caption.weight(.semibold).monospaced())
                                        .foregroundStyle(BrandTheme.goldBright)
                                    Text(event.path)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(BrandTheme.textPrimary)
                                        .lineLimit(2)
                                }
                                HStack {
                                    Text(event.statusLabel)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(event.status >= 200 && event.status < 300 ? BrandTheme.success : BrandTheme.destructive)
                                    Text("\(event.durationMs) ms")
                                        .font(.caption.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                    Spacer(minLength: 8)
                                    Text(sourceLabel(event.source))
                                        .font(.caption2)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                    Text(event.outcome)
                                        .font(.caption2)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                Text(event.requestID.isEmpty ? "no request id" : event.requestID)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .textSelection(.enabled)
                                    .accessibilityIdentifier("requestLog.row.\(event.id)")
                            }
                            .padding(.vertical, 4)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("\(event.method) \(event.path) \(event.statusLabel) \(event.durationMs) milliseconds")
                        }
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Request log")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .toolbar {
            ToolbarItem(id: "requestLog.clear", placement: .topBarTrailing) {
                Button("Clear", systemImage: "trash") {
                    log.clear()
                }
                .disabled(log.events.isEmpty)
                .accessibilityIdentifier("requestLog.clear")
                .accessibilityLabel("Clear request log")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("requestLog.root")
        .task(id: auth.isAuthenticated) {
            await loadServerActivity()
        }
        .refreshable {
            await loadServerActivity()
        }
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "both": return "Local + server"
        case "server": return "Server"
        default: return "This device"
        }
    }

    @MainActor
    private func loadServerActivity() async {
        if !auth.isAuthenticated || auth.isScaffoldSession {
            serverRows = []
            serverNote = auth.isScaffoldSession
                ? "Browse-only mode has no server activity."
                : "Sign in to merge server activity."
            isLoadingServer = false
            return
        }

        isLoadingServer = true
        defer { isLoadingServer = false }
        do {
            let rows = try await APIClient.shared.fetchMeActivity()
            serverRows = rows
            if rows.isEmpty {
                serverNote = "No server activity for this account. Local hops still appear."
            } else {
                let noun = rows.count == 1 ? "row" : "rows"
                serverNote = "\(rows.count) server \(noun) merged by request id."
            }
        } catch {
            serverRows = []
            serverNote = "Server activity unavailable — showing this device only."
        }
    }
}
