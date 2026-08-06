import SwiftUI

/// Power-seller roll-up — `GET /api/v1/me/seller-analytics?range=7d|30d|90d`.
struct SellerAnalyticsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var analytics: SellerAnalytics?
    @State private var range = "30d"
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let ranges: [(id: String, label: String)] = [
        ("7d", "7 days"),
        ("30d", "30 days"),
        ("90d", "90 days"),
    ]

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in as a seller to see revenue, sell-through, and top categories.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway for seller analytics."
                )
            } else if isLoading && analytics == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading analytics…")
            } else if let errorMessage, analytics == nil {
                BrandEmptyState(
                    title: "Couldn’t load analytics",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if let analytics {
                content(analytics)
            } else {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            }
        }
        .navigationTitle("Seller analytics")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: range) { _, _ in
            Task { await load() }
        }
    }

    @ViewBuilder
    private func content(_ analytics: SellerAnalytics) -> some View {
        List {
            Section {
                Picker("Range", selection: $range) {
                    ForEach(ranges, id: \.id) { item in
                        Text(item.label).tag(item.id)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityLabel("Analytics date range")
            }

            Section {
                metricRow(title: "Gross revenue", value: analytics.displayTotalGross)
                metricRow(title: "Orders sold", value: "\(analytics.totalSold ?? 0)")
                metricRow(title: "Listings created", value: "\(analytics.totalListed ?? 0)")
                metricRow(title: "Sell-through", value: analytics.displaySellThrough)
                metricRow(title: "Avg sale price", value: analytics.displayAvgSale)
            } header: {
                Text("Summary · last \(analytics.rangeDays ?? 30) days").brandSectionHeader()
            } footer: {
                Text("Gross includes held, pickup-confirmed, and released escrow orders. Sell-through is sold vs listed in the same window.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            let daily = analytics.dailyRevenue ?? []
            if !daily.isEmpty {
                Section {
                    ForEach(daily) { point in
                        HStack {
                            Text(point.displayDate)
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textPrimary)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(point.displayGross)
                                    .font(.subheadline.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(BrandTheme.goldBright)
                                Text(String(localized: "\(point.orderCount ?? 0) orders"))
                                    .font(.caption2)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text("Daily revenue").brandSectionHeader()
                }
            }

            let cats = analytics.topCategories ?? []
            if !cats.isEmpty {
                Section {
                    ForEach(cats) { cat in
                        HStack {
                            Text(cat.displayName)
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textPrimary)
                                .lineLimit(2)
                            Spacer()
                            Text("\(cat.count ?? 0)")
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text("Top categories").brandSectionHeader()
                }
            }

            if daily.isEmpty && cats.isEmpty && (analytics.totalSold ?? 0) == 0 {
                Section {
                    Text("No sales in this range yet. List items under Account → Sell an item to start building your stats.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
        }
        .brandListBackground()
        .overlay {
            if isLoading {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .padding(12)
                    .brandOverlayChipBackground()
            }
        }
    }

    @ViewBuilder
    private func metricRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(BrandTheme.textPrimary)
        }
        .frame(minHeight: 44)
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = analytics == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            analytics = try await APIClient.shared.fetchSellerAnalytics(range: range)
        } catch {
            if analytics == nil {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        SellerAnalyticsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
