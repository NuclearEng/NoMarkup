import SwiftUI

/// Lifetime reverse-auction savings — `GET /api/v1/users/me/savings`.
/// PRD §11: share savings via system ShareLink (text + URL; referral when available).
struct SavingsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var entries: [SavingsEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var referralCode: String?
    @State private var referralShareURL: String?

    private var lifetimeCents: Int64 {
        entries.reduce(0) { $0 + ($1.savingsCents ?? 0) }
    }

    private var lifetimeShare: ShareCardText.SharePayload {
        ShareCardText.lifetimeSavings(
            savingsCents: lifetimeCents,
            referralCode: referralCode,
            shareURLString: referralShareURL
        )
    }

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see how much you’ve saved versus market median on reverse-auction jobs.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to view savings."
                )
            } else if isLoading && entries.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading savings…")
            } else if let errorMessage, entries.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load savings",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if entries.isEmpty {
                BrandEmptyState(
                    title: "No savings yet",
                    systemImage: "chart.line.uptrend.xyaxis",
                    message: "When you award a reverse-auction job below the market median, your savings show up here. Post a job and let providers bid down."
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Savings")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
    }

    private var listContent: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Lifetime savings")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .textCase(.uppercase)
                        .tracking(0.4)
                    Text(MoneyFormat.usd(cents: lifetimeCents))
                        .font(.system(.largeTitle, design: .rounded).weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.savings)
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.25), value: lifetimeCents)
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Lifetime savings \(MoneyFormat.usd(cents: lifetimeCents))")
                    Text("What you paid versus market median on awarded reverse-auction jobs — not platform markup.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if lifetimeCents > 0 {
                        shareLink(for: lifetimeShare, label: "Share savings")
                            .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
                .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(entries) { entry in
                    savingsRow(entry)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("By job").brandSectionHeader()
            } footer: {
                Text("Savings = market median − awarded bid (when positive). Amounts are in USD. Share uses your referral link when available.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func savingsRow(_ entry: SavingsEntry) -> some View {
        let saved = (entry.savingsCents ?? 0) > 0
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.shortJobID)
                    .font(.body.weight(.medium).monospaced())
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(entry.displaySavings)
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.savings)
                    .contentTransition(.numericText())
            }

            HStack(spacing: 12) {
                labeledMini(
                    title: "Awarded",
                    value: entry.displayAwarded,
                    emphasize: saved
                )
                labeledMini(title: "Median", value: entry.displayMarketMedian)
            }

            if let at = entry.createdAtLabel {
                Text(at)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if saved {
                shareLink(
                    for: ShareCardText.jobSavings(
                        savingsCents: entry.savingsCents ?? 0,
                        awardedCents: entry.awardedCents,
                        referralCode: referralCode,
                        shareURLString: referralShareURL
                    ),
                    label: "Share this save"
                )
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    private func shareLink(for payload: ShareCardText.SharePayload, label: String) -> some View {
        ShareLink(
            item: payload.url,
            subject: Text(payload.subject),
            message: Text(payload.message)
        ) {
            Label(label, systemImage: "square.and.arrow.up")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: 44)
        }
        .tint(BrandTheme.accent)
        .accessibilityHint("Opens the system share sheet with savings text and a NoMarkup link")
    }

    private func labeledMini(title: String, value: String, emphasize: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
            Text(value)
                .font(.caption.weight(emphasize ? .semibold : .regular).monospacedDigit())
                .foregroundStyle(emphasize ? BrandTheme.savings : BrandTheme.textPrimary)
                .contentTransition(.numericText())
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = entries.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        async let savingsTask: Result<SavingsResponse, Error> = {
            do {
                return .success(try await APIClient.shared.fetchMySavings())
            } catch {
                return .failure(error)
            }
        }()
        async let referralTask: ReferralCodeInfo? = {
            try? await APIClient.shared.fetchReferralCode()
        }()

        let savingsResult = await savingsTask
        let referral = await referralTask
        if let referral {
            let code = referral.code?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            referralCode = code.isEmpty ? nil : code
            let url = referral.shareUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            referralShareURL = url.isEmpty ? nil : url
        }

        switch savingsResult {
        case .success(let response):
            entries = response.entries
        case .failure(let error as APIClientError) where error.isUnauthorized:
            errorMessage = "Sign in required. Your session is missing or expired."
        case .failure(let error):
            if entries.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        SavingsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
