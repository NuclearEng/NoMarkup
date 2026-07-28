import SwiftUI

/// Sellers the signed-in user follows — `GET /api/v1/me/follows` + unfollow.
struct FollowingView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var follows: [FollowedSeller] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var unfollowingID: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.2",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to manage follows."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see sellers you follow and open their profiles.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                content
            }
        }
        .navigationTitle("Following")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && follows.isEmpty {
            ProgressView("Loading following…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, follows.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load following",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if follows.isEmpty {
            BrandEmptyState(
                title: "Not following anyone yet",
                systemImage: "person.2.slash",
                message: "Follow sellers from their provider profile. Their active auctions show up in Following feed."
            )
        } else {
            listContent
        }
    }

    private var listContent: some View {
        List {
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            Section {
                ForEach(follows) { seller in
                    followRow(seller)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                if let total = pagination?.resolvedTotal, total > 0 {
                    Text("\(follows.count) of \(total)").brandSectionHeader()
                } else {
                    Text(String(localized: "\(follows.count) sellers"))
                        .brandSectionHeader()
                }
            } footer: {
                Text("Tap a name to open their provider profile. Unfollow anytime.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func followRow(_ seller: FollowedSeller) -> some View {
        HStack(alignment: .center, spacing: 12) {
            NavigationLink {
                ProviderDetailView(providerID: seller.sellerId)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(seller.displayLabel)
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .lineLimit(2)
                    if let at = seller.followedAtLabel {
                        Text("Followed \(at)")
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: 44)
            }
            .accessibilityHint("Opens provider profile")

            Button {
                Task { await unfollow(seller) }
            } label: {
                if unfollowingID == seller.id {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .frame(minWidth: 80, minHeight: 44)
                } else {
                    Text("Unfollow")
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 80, minHeight: 44)
                }
            }
            .buttonStyle(.bordered)
            .tint(BrandTheme.accent)
            .disabled(unfollowingID != nil)
            .accessibilityLabel("Unfollow \(seller.displayLabel)")
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            needsSignIn = !auth.isAuthenticated || auth.isScaffoldSession
            follows = []
            return
        }

        needsSignIn = false
        isLoading = follows.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchFollows(page: 1, pageSize: 40)
            follows = response.follows
            pagination = response.pagination
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            follows = []
            errorMessage = nil
        } catch {
            if follows.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func unfollow(_ seller: FollowedSeller) async {
        statusMessage = nil
        statusIsError = false
        unfollowingID = seller.id
        defer { unfollowingID = nil }

        do {
            try await APIClient.shared.unfollowUser(id: seller.sellerId)
            follows.removeAll { $0.id == seller.id }
            statusIsError = false
            statusMessage = "Unfollowed \(seller.displayLabel)."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        FollowingView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
