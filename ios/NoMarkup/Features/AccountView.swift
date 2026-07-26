import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var exportMessage: String?
    @State private var exportIsError = false
    @State private var isExporting = false

    var body: some View {
        NavigationStack {
            List {
                Section("Session") {
                    if auth.isScaffoldSession {
                        Label("Scaffold session", systemImage: "hammer.fill")
                            .foregroundStyle(.orange)
                    } else if auth.isAuthenticated {
                        Label("Signed in", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                    }
                    if !auth.email.isEmpty {
                        LabeledContent("Email", value: auth.email)
                    }
                    Button("Sign out", role: .destructive) {
                        auth.signOut()
                    }
                    .frame(minHeight: 44)
                }

                Section("Legal & support") {
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
                }

                Section("Orders & payments") {
                    NavigationLink {
                        MyOrdersView()
                    } label: {
                        Label("Orders", systemImage: "bag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View marketplace orders and pay pending ones with Apple Pay")

                    Text("Physical goods and services use Apple Pay / Stripe (not App Store IAP).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Your data") {
                    Button {
                        Task { await exportData() }
                    } label: {
                        HStack {
                            Label("Export Data", systemImage: "square.and.arrow.up")
                            Spacer()
                            if isExporting {
                                ProgressView()
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(auth.isScaffoldSession || isExporting)
                    .accessibilityHint("Downloads your account data export from the API.")

                    if let exportMessage {
                        Text(exportMessage)
                            .font(.footnote)
                            .foregroundStyle(exportIsError ? .red : .secondary)
                    }

                    NavigationLink {
                        AccountDeletionView()
                    } label: {
                        Label("Delete Account", systemImage: "trash")
                            .foregroundStyle(.red)
                    }
                    .frame(minHeight: 44)
                }

                Section("Subscriptions") {
                    Label(
                        "Digital subscriptions (StoreKit) — not in this build",
                        systemImage: "bag.badge.minus"
                    )
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Digital subscriptions via StoreKit are not in this build")
                }

                Section("About") {
                    LabeledContent("Version", value: "\(AppConfig.shortVersion) (\(AppConfig.buildNumber))")
                    LabeledContent("API", value: AppConfig.apiBaseURLString)
                    LabeledContent(
                        "Stripe key",
                        value: AppConfig.stripePublishableKey.isEmpty ? "not set" : "configured"
                    )
                    Text("Rail A: Apple Pay via Stripe. StoreKit / IAP intentionally omitted (digital free-tier only).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Account")
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
}
