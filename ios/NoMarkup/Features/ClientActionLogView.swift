import SwiftUI

/// Local API hop log — pairs a tap/submit with gateway `X-Request-ID`.
struct ClientActionLogView: View {
    @ObservedObject private var log = ClientActionLog.shared

    private var httpCount: Int { log.events.filter { $0.kind == "http" }.count }

    var body: some View {
        Group {
            Text("HTTP hops: \(httpCount)")
                .font(.caption.monospaced())
                .foregroundStyle(BrandTheme.textSecondary)
                .accessibilityIdentifier("requestLog.httpCount")
                .accessibilityValue("\(httpCount)")
                .padding(.top, 8)
            if log.events.isEmpty {
                BrandEmptyState(
                    title: "No requests yet",
                    systemImage: "list.clipboard",
                    message: "Open another Account destination or pull to refresh a list. Each API call appears here with status, duration, and request id."
                )
            } else {
                List {
                    Section {
                        Text("This device only — last \(ClientActionLog.capacity) hops (taps, screens, and API calls). Bodies, tokens, query strings, and typed field values are never stored. Quote the request id on HTTP rows when matching gateway logs.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                    Section {
                        ForEach(log.events) { event in
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
                                    Text(event.outcome)
                                        .font(.caption2)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                Text(event.requestID.isEmpty ? "no request id" : event.requestID)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .textSelection(.enabled)
                                    .accessibilityIdentifier("requestLog.row.\(event.id.uuidString)")
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
            ToolbarItem(placement: .topBarTrailing) {
                Button("Clear") {
                    log.clear()
                }
                .disabled(log.events.isEmpty)
                .accessibilityIdentifier("requestLog.clear")
            }
        }
        .accessibilityIdentifier("requestLog.root")
    }
}
