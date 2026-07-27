import SwiftUI

/// Provider verification documents — read-only list.
///
/// API: `GET /api/v1/providers/me/documents` → `{ "documents": [] }`.
struct VerificationDocumentsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var documents: [ProviderVerificationDocument] = []
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var needsSignIn = false
    @State private var hasProviderRole = true

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer.fill",
                    message: "Browse-only mode has no API token. Sign in with a real account to view verification documents.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to view verification document status.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && documents.isEmpty && loadError == nil {
                ProgressView("Loading documents…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let loadError, documents.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load documents",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else if !hasProviderRole {
                BrandEmptyState(
                    title: "Provider role required",
                    systemImage: "wrench.and.screwdriver",
                    message: "Enable the provider role in Profile settings to view verification documents.",
                    actionTitle: nil,
                    action: nil
                )
            } else if documents.isEmpty {
                BrandEmptyState(
                    title: "No documents yet",
                    systemImage: "doc.badge.ellipsis",
                    message: "Uploaded insurance, license, or ID verification files appear here after you submit them on the web provider portal.",
                    actionTitle: nil,
                    action: nil
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Verification docs")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var listContent: some View {
        List {
            Section {
                ForEach(documents) { doc in
                    documentRow(doc)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("\(documents.count) document\(documents.count == 1 ? "" : "s")").brandSectionHeader()
            } footer: {
                Text("Read-only on iOS for now. Upload and resubmit documents from the web provider workspace when required.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func documentRow(_ doc: ProviderVerificationDocument) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(doc.displayType)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(doc.displayStatus)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(statusColor(doc.statusStyle))
            }
            if let reason = doc.rejectionReason?.trimmingCharacters(in: .whitespacesAndNewlines),
               !reason.isEmpty {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                if let count = doc.resubmissionCount, count > 0 {
                    Text("Resubmissions: \(count)")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer()
                if let expires = doc.expiresAt, !expires.isEmpty {
                    Text("Expires \(CatalogDateFormat.friendlyDateTime(expires))")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    private func statusColor(_ style: StatusChipStyle) -> Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.accent
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }

        isLoading = documents.isEmpty
        loadError = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            documents = try await APIClient.shared.fetchMyProviderDocuments()
            hasProviderRole = true
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            documents = []
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            documents = []
        } catch {
            if documents.isEmpty {
                loadError = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        VerificationDocumentsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
