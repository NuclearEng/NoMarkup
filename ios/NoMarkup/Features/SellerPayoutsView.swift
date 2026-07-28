import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Stripe Connect status + onboarding for provider/seller payouts.
struct SellerPayoutsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var status: StripeAccountStatus?
    @State private var hasProviderRole = false
    @State private var isLoading = false
    @State private var isCreating = false
    @State private var isOpeningOnboarding = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var onboardingSafariURL: URL?

    private let returnRefreshURL = "https://no-markup.com"

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "banknote",
                    message: "Browse-only mode has no API credentials. Sign in as a provider to manage payouts.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in with a provider account to connect Stripe and receive payouts.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && status == nil && errorMessage == nil {
                ProgressView("Loading Stripe status…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else {
                formContent
            }
        }
        .navigationTitle("Seller payouts")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: Binding(
            get: { onboardingSafariURL != nil },
            set: { if !$0 { onboardingSafariURL = nil } }
        )) {
            if let onboardingSafariURL {
                NavigationStack {
                    LegalWebView(title: "Stripe onboarding", url: onboardingSafariURL)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") {
                                    self.onboardingSafariURL = nil
                                    Task { await load() }
                                }
                                .frame(minHeight: 44)
                            }
                        }
                }
            }
        }
    }

    private var formContent: some View {
        Form {
            Section {
                Text(
                    "Payouts require the provider role. Enable it in Profile settings if you only have a customer role. Stripe Connect Express holds escrow and pays out after completion."
                )
                .font(.footnote)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

                LabeledContent("Provider role") {
                    Text(hasProviderRole ? "Enabled" : "Not enabled")
                        .foregroundStyle(hasProviderRole ? BrandTheme.success : BrandTheme.warning)
                }
                .frame(minHeight: 44)
            } header: {
                Text("Eligibility").brandSectionHeader()
            }

            if hasProviderRole {
                Section {
                    statusRow(
                        title: "Charges enabled",
                        enabled: status?.hasChargesEnabled == true
                    )
                    statusRow(
                        title: "Payouts enabled",
                        enabled: status?.hasPayoutsEnabled == true
                    )
                    statusRow(
                        title: "Details submitted",
                        enabled: status?.hasDetailsSubmitted == true
                    )

                    if let requirements = status?.requirements, !requirements.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Outstanding requirements")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.warning)
                            ForEach(requirements, id: \.self) { item in
                                Text("• \(item)")
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Stripe Connect").brandSectionHeader()
                } footer: {
                    if status?.isFullyOnboarded == true {
                        Text("Your Stripe account can charge and receive payouts.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    } else {
                        Text("Complete Stripe onboarding so escrow can pay out to your bank.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }

                Section {
                    if status == nil || status?.hasDetailsSubmitted != true {
                        Button {
                            Task { await createAccountIfNeeded() }
                        } label: {
                            HStack {
                                if isCreating {
                                    ProgressView()
                                        .tint(BrandTheme.ctaLabelOnGold)
                                }
                                Text(isCreating ? "Creating…" : "Create Stripe account")
                                    .frame(maxWidth: .infinity)
                            }
                            .frame(minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.accent)
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .disabled(isCreating || isOpeningOnboarding)
                        .accessibilityHint("Creates a Stripe Express account for payouts if you do not have one yet")
                    }

                    Button {
                        Task { await openOnboarding() }
                    } label: {
                        HStack {
                            if isOpeningOnboarding {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                            }
                            Label(
                                isOpeningOnboarding ? "Opening…" : "Open onboarding",
                                systemImage: "safari"
                            )
                            .frame(maxWidth: .infinity)
                        }
                        .frame(minHeight: 48)
                    }
                    .disabled(isCreating || isOpeningOnboarding)
                    .accessibilityHint("Opens Stripe Connect onboarding in Safari")
                }
            } else {
                Section {
                    NavigationLink {
                        ProfileSettingsView()
                    } label: {
                        Label("Enable provider role in Profile", systemImage: "person.badge.shield.checkmark")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Opens profile settings where you can enable the provider role")
                } header: {
                    Text("Next step").brandSectionHeader()
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let errorMessage {
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
    private func statusRow(title: String, enabled: Bool) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(BrandTheme.textPrimary)
            Spacer()
            Label(
                enabled ? "Yes" : "No",
                systemImage: enabled ? "checkmark.circle.fill" : "xmark.circle"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(enabled ? BrandTheme.success : BrandTheme.textSecondary)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(enabled ? "yes" : "no")")
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let me = try await APIClient.shared.fetchMe()
            hasProviderRole = me.hasProviderRole
            if hasProviderRole {
                do {
                    status = try await APIClient.shared.fetchStripeAccountStatus()
                } catch let error as APIClientError where error.isForbidden {
                    // Provider role may lag; show empty status with create CTA.
                    status = nil
                    errorMessage = "Stripe status unavailable. Create or finish onboarding below."
                } catch let error as APIClientError where error.isUnauthorized {
                    throw error
                } catch {
                    // Soft-fail status so create/onboard actions remain usable.
                    status = nil
                    errorMessage = error.localizedDescription
                }
            } else {
                status = nil
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func createAccountIfNeeded() async {
        errorMessage = nil
        statusMessage = nil
        isCreating = true
        defer { isCreating = false }

        do {
            let created = try await APIClient.shared.createStripeAccount()
            if let id = created.resolvedAccountId {
                statusMessage = "Stripe account ready (\(shortID(id))). Open onboarding to finish."
            } else {
                statusMessage = "Stripe account created. Open onboarding to finish."
            }
            status = try? await APIClient.shared.fetchStripeAccountStatus()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func openOnboarding() async {
        errorMessage = nil
        statusMessage = nil
        isOpeningOnboarding = true
        defer { isOpeningOnboarding = false }

        do {
            let link = try await APIClient.shared.fetchStripeOnboardingLink(
                returnURL: returnRefreshURL,
                refreshURL: returnRefreshURL
            )
            guard let url = link.resolvedURL else {
                errorMessage = "Onboarding link was empty. Try creating a Stripe account first."
                return
            }
            #if canImport(UIKit)
            // Prefer in-app Safari for continuity; fall back to system open.
            onboardingSafariURL = url
            #else
            onboardingSafariURL = url
            #endif
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(10)) + "…"
    }
}

#Preview {
    NavigationStack {
        SellerPayoutsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
