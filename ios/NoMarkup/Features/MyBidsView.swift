import SwiftUI

/// Goods + services bid history for the signed-in user.
///
/// - Goods: `GET /api/v1/listings/bids/mine`
/// - Services: `GET /api/v1/bids/mine`
struct MyBidsView: View {
    private enum Segment: String, CaseIterable, Identifiable {
        case goods = "Goods"
        case services = "Services"
        var id: String { rawValue }
    }

    @EnvironmentObject private var auth: AuthViewModel

    @State private var segment: Segment = .goods
    @State private var listingBids: [MyListingBidEntry] = []
    @State private var jobBids: [MyJobBidRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Scaffold session",
                    systemImage: "hammer",
                    message: "Scaffold sessions have no API credentials. Sign in against a live gateway to load your bids."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see marketplace and job bids you’ve placed.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                VStack(spacing: 0) {
                    Picker("Bid type", selection: $segment) {
                        ForEach(Segment.allCases) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(BrandTheme.navy)

                    content
                }
            }
        }
        .navigationTitle("My bids")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task(id: segment) { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && currentListIsEmpty {
            ProgressView("Loading bids…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, currentListIsEmpty {
            BrandEmptyState(
                title: "Couldn’t load bids",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if currentListIsEmpty {
            BrandEmptyState(
                title: segment == .goods ? "No goods bids yet" : "No service bids yet",
                systemImage: "hammer.circle",
                message: segment == .goods
                    ? "When you bid on marketplace listings, they show up here."
                    : "When you bid on service jobs as a provider, they show up here."
            )
        } else {
            List {
                switch segment {
                case .goods:
                    Section {
                        ForEach(listingBids) { entry in
                            listingBidRow(entry)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    } header: {
                        Text("\(listingBids.count) bid\(listingBids.count == 1 ? "" : "s")").brandSectionHeader()
                    } footer: {
                        Text("Winning status reflects the live auction ladder on each listing.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                case .services:
                    Section {
                        ForEach(jobBids) { bid in
                            jobBidRow(bid)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    } header: {
                        Text("\(jobBids.count) bid\(jobBids.count == 1 ? "" : "s")").brandSectionHeader()
                    } footer: {
                        Text("Service bids are reverse-auction (lower price is more competitive).")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }
            .brandListBackground()
        }
    }

    private var currentListIsEmpty: Bool {
        switch segment {
        case .goods: return listingBids.isEmpty
        case .services: return jobBids.isEmpty
        }
    }

    @ViewBuilder
    private func listingBidRow(_ entry: MyListingBidEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(entry.displayAmount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(entry.isWinning ? BrandTheme.bidWinning : BrandTheme.goldBright)
            }
            HStack(spacing: 8) {
                if entry.isWinning {
                    Text("Winning")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.navy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(BrandTheme.bidWinning))
                } else {
                    Text("Outbid / active")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(BrandTheme.bidActive)
                }
                if let status = entry.listing?.status, !status.isEmpty {
                    Text(StatusChipStyle.displayLabel(status))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let created = entry.bid?.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func jobBidRow(_ bid: MyJobBidRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(bid.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer(minLength: 8)
                Text(bid.displayAmount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
            HStack(spacing: 8) {
                Text(bid.displayStatus)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(statusColor(bid.status))
                if bid.isOfferAccepted == true {
                    Text("Accepted")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.navy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(BrandTheme.bidWinning))
                }
                if let created = bid.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func statusColor(_ raw: String?) -> Color {
        switch StatusChipStyle.forStatus(raw) {
        case .success: return BrandTheme.bidWinning
        case .info: return BrandTheme.bidActive
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    @MainActor
    private func load() async {
        if auth.isScaffoldSession || !auth.isAuthenticated {
            listingBids = []
            jobBids = []
            needsSignIn = !auth.isAuthenticated && !auth.isScaffoldSession
            return
        }

        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            switch segment {
            case .goods:
                let response = try await APIClient.shared.fetchMyListingBids(page: 1, pageSize: 40)
                listingBids = response.bids
            case .services:
                let response = try await APIClient.shared.fetchMyJobBids(page: 1, pageSize: 40)
                jobBids = response.bids
            }
        } catch let error as APIClientError where error.isUnauthorized {
            listingBids = []
            jobBids = []
            needsSignIn = true
        } catch {
            if currentListIsEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        MyBidsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
