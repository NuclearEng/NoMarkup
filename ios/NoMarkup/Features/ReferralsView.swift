import SwiftUI

/// Referral program — code + redeem + history (`GET /me/referrals/code`, `/me/referrals`, redeem).
struct ReferralsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var referral: ReferralCodeInfo?
    @State private var history: [ReferralHistoryEntry] = []
    @State private var creditBalanceCents: Int64?
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

                    LabeledContent("Per-invite credit") {
                        Text(MoneyFormat.usd(cents: (referral.creditCents ?? 0)))
                            .font(.body.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.success)
                    }
                    .frame(minHeight: 44)

                    if let creditBalanceCents {
                        LabeledContent("Credit balance") {
                            Text(MoneyFormat.usd(cents: creditBalanceCents))
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.savings)
                        }
                        .frame(minHeight: 44)
                    }

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
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Redeem code")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(!canRedeem)
            } header: {
                Text("Redeem").brandSectionHeader()
            } footer: {
                Text("Enter a code from a friend who invited you. Each account can redeem once.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)

            Section {
                if history.isEmpty {
                    Text("No successful referrals yet. Share your code to start earning credit.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(history) { entry in
                        historyRow(entry)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            } header: {
                Text("Your referrals").brandSectionHeader()
            } footer: {
                Text("Status and credit for people who signed up with your code.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func historyRow(_ entry: ReferralHistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.displayStatus)
                    .font(.body.weight(.medium))
                    .foregroundStyle(statusColor(entry.status))
                Spacer(minLength: 8)
                Text(entry.displayCredit)
                    .font(.body.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
            if let referred = entry.referredId?.trimmingCharacters(in: .whitespacesAndNewlines),
               !referred.isEmpty
            {
                Text(shortID(referred))
                    .font(.caption.monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            if let at = entry.createdAtLabel {
                Text(at)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    private func statusColor(_ status: String?) -> Color {
        let s = (status ?? "").lowercased()
        if s.contains("credit") || s == "completed" || s == "activated" {
            return BrandTheme.success
        }
        if s.contains("pending") || s.contains("wait") {
            return BrandTheme.warning
        }
        if s.contains("cancel") || s.contains("expire") || s.contains("void") {
            return BrandTheme.destructive
        }
        return BrandTheme.textPrimary
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(8)) + "…"
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

        // Code endpoint (share URL / message) + list (history / balance) in parallel-ish sequence.
        var codeInfo: ReferralCodeInfo?
        var codeError: Error?
        do {
            codeInfo = try await APIClient.shared.fetchReferralCode()
        } catch {
            codeError = error
        }

        do {
            let list = try await APIClient.shared.listReferrals()
            history = list.referrals
            creditBalanceCents = list.creditBalanceCents
            if let codeInfo {
                referral = codeInfo
            } else {
                referral = ReferralCodeInfo(
                    code: list.code,
                    creditCents: nil,
                    shareUrl: nil,
                    shareMessage: nil
                )
            }
        } catch {
            history = []
            if let codeInfo {
                referral = codeInfo
            } else if referral == nil {
                errorMessage = (codeError ?? error).localizedDescription
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
            await load()
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
