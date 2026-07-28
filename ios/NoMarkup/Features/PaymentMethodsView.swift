import SwiftUI

/// Manage saved payment methods (cards). Adding a card is via Stripe checkout on orders.
struct PaymentMethodsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var methods: [PaymentMethodRow] = []
    @State private var isLoading = false
    @State private var deletingID: String?
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var pendingDelete: PaymentMethodRow?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "creditcard",
                    message: "Browse-only mode has no API credentials. Sign in to manage payment methods.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in to view and remove saved cards.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && methods.isEmpty {
                ProgressView("Loading payment methods…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, methods.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load methods",
                    systemImage: "wifi.exclamationmark",
                    message: errorMessage,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Payment methods")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(
            "Remove this card?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { method in
            Button("Remove \(method.displayBrand) •••• \(method.displayLastFour)", role: .destructive) {
                Task {
                    let ok = await BiometricGate.authenticateIfRequired(
                        reason: "Confirm removing a saved payment method with \(BiometricGate.biometryDisplayName)."
                    )
                    guard ok else {
                        pendingDelete = nil
                        errorMessage = "Authentication canceled — card was not removed."
                        return
                    }
                    await delete(method)
                }
            }
            Button("Cancel", role: .cancel) {
                pendingDelete = nil
            }
        } message: { method in
            Text("Removes \(method.displayBrand) ending in \(method.displayLastFour) from your account. You can add a card again during checkout.")
        }
    }

    private var listContent: some View {
        List {
            Section {
                Text("Add a card during order checkout (Stripe). This screen is manage-only — remove outdated cards here.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if methods.isEmpty {
                Section {
                    Text("No saved payment methods")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                } header: {
                    Text("Cards").brandSectionHeader()
                }
            } else {
                Section {
                    ForEach(methods) { method in
                        methodRow(method)
                    }
                } header: {
                    Text("Cards").brandSectionHeader()
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                }
            }

            if let errorMessage, !methods.isEmpty {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func methodRow(_ method: PaymentMethodRow) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "creditcard.fill")
                .foregroundStyle(BrandTheme.goldBright)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("\(method.displayBrand) •••• \(method.displayLastFour)")
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandTheme.textPrimary)
                    if method.isDefault == true {
                        Text("Default")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.ctaLabelOnGold)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(BrandTheme.gold, in: Capsule())
                            .accessibilityLabel("Default payment method")
                    }
                }
                if let exp = method.displayExp {
                    Text("Expires \(exp)")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            Spacer(minLength: 8)

            if deletingID == method.id {
                ProgressView()
                    .tint(BrandTheme.destructive)
            } else {
                Button(role: .destructive) {
                    pendingDelete = method
                } label: {
                    Image(systemName: "trash")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Remove \(method.displayBrand) ending in \(method.displayLastFour)")
            }
        }
        .frame(minHeight: 44)
        .listRowBackground(BrandTheme.navyElevated)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            methods = try await APIClient.shared.fetchPaymentMethods().methods
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            methods = []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ method: PaymentMethodRow) async {
        errorMessage = nil
        statusMessage = nil
        deletingID = method.id
        defer {
            deletingID = nil
            pendingDelete = nil
        }

        do {
            try await APIClient.shared.deletePaymentMethod(id: method.id)
            methods.removeAll { $0.id == method.id }
            statusMessage = "Payment method removed."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        PaymentMethodsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
