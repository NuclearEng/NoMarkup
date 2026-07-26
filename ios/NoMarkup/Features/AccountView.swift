import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var exportMessage: String?
    @State private var exportIsError = false
    @State private var isExporting = false
    @State private var sessionEmail: String?
    @State private var sessionUserID: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if auth.isScaffoldSession {
                        Label("Scaffold session", systemImage: "hammer.fill")
                            .foregroundStyle(.orange)
                        Text("Browse chrome only — API mutations and chat send stay disabled until you sign in with a real account.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    } else if auth.isAuthenticated {
                        Label("Signed in", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(BrandTheme.success)
                        if let sessionUserID, !sessionUserID.isEmpty {
                            LabeledContent("User") {
                                Text(shortID(sessionUserID))
                                    .font(.caption.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .textSelection(.enabled)
                            }
                        }
                    } else {
                        Label("Not signed in", systemImage: "person.crop.circle.badge.questionmark")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }

                    if let email = displayEmail {
                        LabeledContent("Email", value: email)
                    }

                    Button("Sign out", role: .destructive) {
                        auth.signOut()
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Session").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        MyOrdersView()
                    } label: {
                        Label("Orders", systemImage: "bag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View marketplace orders and pay pending ones with Apple Pay")

                    Text("Physical goods and services use Apple Pay / Stripe (not App Store IAP).")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Orders & payments").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        LegalWebView(title: "Privacy Policy", url: AppConfig.privacyURL)
                    } label: {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                    .frame(minHeight: 44)
                    NavigationLink {
                        LegalWebView(title: "Terms of Service", url: AppConfig.termsURL)
                    } label: {
                        Label("Terms of Service", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    NavigationLink {
                        LegalWebView(title: "Community Guidelines", url: AppConfig.communityGuidelinesURL)
                    } label: {
                        Label("Community Guidelines", systemImage: "person.3")
                    }
                    .frame(minHeight: 44)
                    NavigationLink {
                        LegalWebView(title: "Support", url: AppConfig.supportURL)
                    } label: {
                        Label("Support", systemImage: "lifepreserver")
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Legal & support").brandSectionHeader()
                }

                Section {
                    Button {
                        Task { await exportData() }
                    } label: {
                        HStack {
                            Label("Export Data", systemImage: "square.and.arrow.up")
                            Spacer()
                            if isExporting {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(auth.isScaffoldSession || isExporting)
                    .accessibilityHint("Downloads your account data export from the API.")

                    if let exportMessage {
                        Text(exportMessage)
                            .font(.footnote)
                            .foregroundStyle(exportIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                    }

                    NavigationLink {
                        AccountDeletionView()
                    } label: {
                        Label("Delete Account", systemImage: "trash")
                            .foregroundStyle(BrandTheme.destructive)
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Your data").brandSectionHeader()
                }

                Section {
                    Label(
                        "Digital subscriptions (StoreKit) — not in this build",
                        systemImage: "bag.badge.minus"
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Digital subscriptions via StoreKit are not in this build")
                } header: {
                    Text("Subscriptions").brandSectionHeader()
                }

                Section {
                    LabeledContent("Version", value: "\(AppConfig.shortVersion) (\(AppConfig.buildNumber))")
                    LabeledContent("API", value: AppConfig.apiBaseURLString)
                    LabeledContent(
                        "Stripe key",
                        value: AppConfig.stripePublishableKey.isEmpty ? "not set" : "configured"
                    )
                    Text("Rail A: Apple Pay via Stripe. StoreKit / IAP intentionally omitted (digital free-tier only).")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("About").brandSectionHeader()
                }
            }
            .brandListBackground()
            .navigationTitle("Account")
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .task { await refreshSessionHints() }
            .onChange(of: auth.isAuthenticated) { _, _ in
                Task { await refreshSessionHints() }
            }
            .onChange(of: auth.isScaffoldSession) { _, _ in
                Task { await refreshSessionHints() }
            }
        }
    }

    private var displayEmail: String? {
        let fromAuth = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !fromAuth.isEmpty { return fromAuth }
        if let sessionEmail, !sessionEmail.isEmpty { return sessionEmail }
        return nil
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(8)) + "…"
    }

    @MainActor
    private func refreshSessionHints() async {
        if auth.isScaffoldSession || !auth.isAuthenticated {
            sessionEmail = nil
            sessionUserID = nil
            return
        }
        sessionUserID = await APIClient.shared.currentUserID()
        // Email may already be on AuthViewModel after password login; JWT may carry it too.
        if auth.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if let token = try? KeychainTokenStore().read(.accessToken) {
                sessionEmail = JWTPayload.email(from: token)
            }
        }
    }

    private func exportData() async {
        exportMessage = nil
        exportIsError = false
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await APIClient.shared.exportMyData()
            // Share sheet would be ideal; for scaffold, confirm bytes received.
            exportIsError = false
            exportMessage = "Export ready (\(data.count) bytes). Share-sheet wiring is a follow-up."
        } catch {
            exportIsError = true
            exportMessage = error.localizedDescription
        }
    }
}

#Preview {
    AccountView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
