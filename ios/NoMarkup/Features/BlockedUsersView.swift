import SwiftUI

/// Blocked users list — `GET /api/v1/me/blocks` + unblock via `DELETE /api/v1/users/{id}/block`.
struct BlockedUsersView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var blocks: [BlockedUser] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var unblockingID: String?

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to view and manage users you’ve blocked.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to manage blocks."
                )
            } else if isLoading && blocks.isEmpty {
                BrandLoadingScreen(kind: .catalog, rows: 4, accessibilityLabel: "Loading blocked users…")
            } else if let errorMessage, blocks.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load blocks",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if blocks.isEmpty {
                BrandEmptyState(
                    title: "No blocked users",
                    systemImage: "hand.raised.slash",
                    message: "When you block someone from a provider profile or chat, they appear here. Unblock anytime."
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Blocked users")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
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
                ForEach(blocks) { block in
                    blockRow(block)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("\(blocks.count) blocked").brandSectionHeader()
            } footer: {
                Text("Blocked users can’t message you. Unblocking restores chat if you share a channel again.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func blockRow(_ block: BlockedUser) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(block.displayLabel)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                if let reason = block.reason?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !reason.isEmpty {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(2)
                }
                if let at = block.blockedAtLabel {
                    Text(at)
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            Spacer(minLength: 8)
            Button {
                Task { await unblock(block) }
            } label: {
                if unblockingID == block.id {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .frame(minWidth: 72, minHeight: 44)
                } else {
                    Text("Unblock")
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 72, minHeight: 44)
                }
            }
            .buttonStyle(.bordered)
            .tint(BrandTheme.accent)
            .disabled(unblockingID != nil)
            .accessibilityLabel("Unblock \(block.displayLabel)")
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = blocks.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            blocks = try await APIClient.shared.fetchBlocks().blocks
        } catch {
            if blocks.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func unblock(_ block: BlockedUser) async {
        statusMessage = nil
        statusIsError = false
        unblockingID = block.id
        defer { unblockingID = nil }

        do {
            try await APIClient.shared.unblockUser(id: block.blockedId)
            blocks.removeAll { $0.id == block.id }
            statusIsError = false
            statusMessage = "Unblocked \(block.displayLabel)."
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
        BlockedUsersView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
