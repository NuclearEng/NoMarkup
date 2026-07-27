import SwiftUI

/// Referral program — `GET /api/v1/me/referrals/code` + `POST /api/v1/me/referrals/redeem`.
struct ReferralsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var referral: ReferralCodeInfo?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false

    @State private var redeemCode = ""
    @State private var isRedeeming = false

    private var canRedeem: Bool {
        !redeemCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isRedeeming
    }

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to share your referral code and redeem a friend’s invite for credit.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to use referrals."
                )
            } else if isLoading && referral == nil {
                ProgressView("Loading referral code…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, referral == nil {
                BrandEmptyState(
                    title: "Couldn’t load referral",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
                listContent
            }
        }
        .navigationTitle("Referrals")
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
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            if let referral {
                Section {
                    LabeledContent("Your code") {
                        Text(referral.displayCode)
                            .font(.body.weight(.semibold).monospaced())
                            .foregroundStyle(BrandTheme.goldBright)
                            .textSelection(.enabled)
                    }
                    .frame(minHeight: 44)

                    LabeledContent("Credit") {
                        Text(MoneyFormat.usd(cents: (referral.creditCents ?? 0)))
                            .font(.body.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.success)
                    }
                    .frame(minHeight: 44)

                    Text((referral.shareMessage ?? ""))
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)

                    shareControls(for: referral)
                } header: {
                    Text("Invite friends").brandSectionHeader()
                } footer: {
                    Text("You and your friend both earn credit when they sign up with your code. No markup on the market — just referral credit.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                TextField("Friend’s code", text: $redeemCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .textContentType(.none)
                    .font(.body.monospaced())
                    .frame(minHeight: 44)
                    .accessibilityLabel("Referral code to redeem")

                Button {
                    Task { await redeem() }
                } label: {
                    if isRedeeming {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Redeem code")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canRedeem)
            } header: {
                Text("Redeem").brandSectionHeader()
            } footer: {
                Text("Enter a code from a friend who invited you. Each account can redeem once.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func shareControls(for referral: ReferralCodeInfo) -> some View {
        let message = (referral.shareMessage ?? "")
        if let url = URL(string: (referral.shareUrl ?? "")), !(referral.shareUrl ?? "").isEmpty {
            ShareLink(
                item: url,
                subject: Text("Join NoMarkup"),
                message: Text(message)
            ) {
                Label("Share invite link", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
            }
            .tint(BrandTheme.accent)
            .accessibilityHint("Opens the system share sheet with your referral link")
        } else {
            ShareLink(item: message) {
                Label("Share invite message", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
            }
            .tint(BrandTheme.accent)
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = referral == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            referral = try await APIClient.shared.fetchReferralCode()
        } catch {
            if referral == nil {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func redeem() async {
        statusMessage = nil
        statusIsError = false
        isRedeeming = true
        defer { isRedeeming = false }

        let code = redeemCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }

        do {
            try await APIClient.shared.redeemReferralCode(code: code)
            statusIsError = false
            statusMessage = "Code redeemed. Credit will appear on your account when the referral activates."
            redeemCode = ""
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
        ReferralsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
