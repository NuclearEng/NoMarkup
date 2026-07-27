import SwiftUI

/// Notification inbox — list, mark-one-read, mark-all-read, unread count.
struct NotificationsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var items: [AppNotification] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var unreadCount = 0
    @State private var isMarkingAll = false
    @State private var actionMessage: String?
    @State private var markingID: String?

    /// Quiet list refresh while the screen is open and the app is active.
    private static let quietRefreshIntervalNanoseconds: UInt64 = 30_000_000_000

    private var localUnreadCount: Int {
        items.filter(\.unread).count
    }

    private var displayedUnread: Int {
        max(unreadCount, localUnreadCount)
    }

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
                    Task { await load(showLoading: true) }
                }
            } else if items.isEmpty {
                BrandEmptyState(
                    title: "No notifications",
                    systemImage: "bell",
                    message: "Outbid alerts, awards, escrow payments, and messages appear here when the market moves."
                )
            } else {
                List {
                    if let actionMessage {
                        Section {
                            Text(actionMessage)
                                .font(.footnote)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    }

                    Section {
                        ForEach(items) { note in
                            Button {
                                Task { await markReadIfNeeded(note) }
                            } label: {
                                notificationRow(note)
                            }
                            .buttonStyle(.plain)
                            .disabled(markingID == note.id)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityHint(
                                note.unread
                                    ? "Marks this notification as read"
                                    : "Already read"
                            )
                        }
                    } header: {
                        Text(sectionHeaderText).brandSectionHeader()
                    } footer: {
                        Text("Tap a row to mark it read. Use Mark all read in the toolbar for the full inbox.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle(navigationTitleText)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if auth.isAuthenticated, !auth.isScaffoldSession, localUnreadCount > 0 || unreadCount > 0 {
                    Button {
                        Task { await markAllRead() }
                    } label: {
                        if isMarkingAll {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        } else {
                            Text("Mark all read")
                        }
                    }
                    .disabled(isMarkingAll || markingID != nil)
                    .accessibilityHint("Marks every notification as read")
                }
            }
        }
        .task { await load(showLoading: true) }
        .task {
            // Quiet refresh every 30s only while signed in and scene is active.
            // Cancels when the view disappears; no Timer.scheduledTimer.
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: Self.quietRefreshIntervalNanoseconds)
                } catch {
                    break
                }
                guard !Task.isCancelled else { break }
                guard scenePhase == .active else { continue }
                guard auth.isAuthenticated, !auth.isScaffoldSession, !needsSignIn else { continue }
                await load(showLoading: false)
            }
        }
        .refreshable { await load(showLoading: true) }
    }

    private var navigationTitleText: String {
        if displayedUnread > 0 {
            return "Notifications (\(displayedUnread))"
        }
        return "Notifications"
    }

    private var sectionHeaderText: String {
        if displayedUnread > 0 {
            return "\(items.count) recent · \(displayedUnread) unread"
        }
        return "\(items.count) recent"
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
                    .multilineTextAlignment(.leading)

                if !note.displayBody.isEmpty {
                    Text(note.displayBody)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineLimit(4)
                        .multilineTextAlignment(.leading)
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
                    if markingID == note.id {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(BrandTheme.accent)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .opacity(note.unread ? 1 : 0.72)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            note.unread
                ? "Unread: \(note.displayTitle). \(note.displayBody)"
                : "\(note.displayTitle). \(note.displayBody)"
        )
    }

    @MainActor
    private func load(showLoading: Bool = true) async {
        if auth.isScaffoldSession || !auth.isAuthenticated {
            items = []
            unreadCount = 0
            needsSignIn = !auth.isAuthenticated && !auth.isScaffoldSession
            return
        }

        if showLoading {
            isLoading = true
            errorMessage = nil
            actionMessage = nil
        }
        needsSignIn = false
        defer {
            if showLoading {
                isLoading = false
            }
        }

        do {
            let response = try await APIClient.shared.fetchNotifications(page: 1, pageSize: 40)
            items = response.notifications
            // Count is best-effort — list success should not fail the screen.
            if let count = try? await APIClient.shared.fetchUnreadNotificationCount() {
                unreadCount = count
            } else {
                unreadCount = items.filter(\.unread).count
            }
        } catch let error as APIClientError where error.isUnauthorized {
            if showLoading {
                items = []
                unreadCount = 0
            }
            needsSignIn = true
        } catch {
            if items.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func markReadIfNeeded(_ note: AppNotification) async {
        guard note.unread else { return }
        guard markingID == nil, !isMarkingAll else { return }

        markingID = note.id
        actionMessage = nil
        defer { markingID = nil }

        // Optimistic UI.
        if let idx = items.firstIndex(where: { $0.id == note.id }) {
            items[idx] = items[idx].markedRead()
        }
        unreadCount = max(0, unreadCount - 1)

        do {
            try await APIClient.shared.markNotificationRead(id: note.id)
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            // Revert optimistic update on auth failure.
            if let idx = items.firstIndex(where: { $0.id == note.id }) {
                var reverted = items[idx]
                reverted.isRead = false
                items[idx] = reverted
            }
            unreadCount += 1
        } catch {
            // Revert optimistic update.
            if let idx = items.firstIndex(where: { $0.id == note.id }) {
                var reverted = items[idx]
                reverted.isRead = false
                items[idx] = reverted
            }
            unreadCount += 1
            actionMessage = error.localizedDescription
        }
    }

    @MainActor
    private func markAllRead() async {
        guard !isMarkingAll else { return }
        isMarkingAll = true
        actionMessage = nil
        defer { isMarkingAll = false }

        do {
            _ = try await APIClient.shared.markAllNotificationsRead()
            items = items.map { $0.unread ? $0.markedRead() : $0 }
            unreadCount = 0
            actionMessage = "All notifications marked as read."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            actionMessage = error.localizedDescription
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
