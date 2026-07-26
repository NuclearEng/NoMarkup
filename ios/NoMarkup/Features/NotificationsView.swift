import SwiftUI

/// Read-only notification inbox — `GET /api/v1/notifications`.
/// Mark-as-read / push registration are deferred (web parity partial).
struct NotificationsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var items: [AppNotification] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load notifications."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "bell.slash",
                    message: "Sign in to see reverse-auction awards, order escrow, and message alerts.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if isLoading && items.isEmpty {
                ProgressView("Loading notifications…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, items.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load notifications",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if items.isEmpty {
                BrandEmptyState(
                    title: "No notifications",
                    systemImage: "bell",
                    message: "Outbid alerts, awards, escrow payments, and messages appear here when the market moves."
                )
            } else {
                List {
                    Section {
                        ForEach(items) { note in
                            notificationRow(note)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    } header: {
                        Text("\(items.count) recent").brandSectionHeader()
                    } footer: {
                        Text("Read-only in this build. Open the web app to manage preferences or mark all as read.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Notifications")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func notificationRow(_ note: AppNotification) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(note.unread ? BrandTheme.bidActive : BrandTheme.textSecondary.opacity(0.35))
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(note.displayTitle)
                    .font(.body.weight(note.unread ? .semibold : .regular))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !note.displayBody.isEmpty {
                    Text(note.displayBody)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineLimit(4)
                }

                HStack(spacing: 8) {
                    if let type = note.typeLabel {
                        Text(type)
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.bidActive.opacity(0.9))
                    }
                    if let created = note.createdAt, !created.isEmpty {
                        Text(CatalogDateFormat.friendlyDateTime(created))
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            note.unread
                ? "Unread: \(note.displayTitle). \(note.displayBody)"
                : "\(note.displayTitle). \(note.displayBody)"
        )
    }

    @MainActor
    private func load() async {
        if auth.isScaffoldSession || !auth.isAuthenticated {
            items = []
            needsSignIn = !auth.isAuthenticated && !auth.isScaffoldSession
            return
        }

        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchNotifications(page: 1, pageSize: 40)
            items = response.notifications
        } catch let error as APIClientError where error.isUnauthorized {
            items = []
            needsSignIn = true
        } catch {
            if items.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        NotificationsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
