import SwiftUI

/// Lifetime reverse-auction savings — `GET /api/v1/users/me/savings`.
struct SavingsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var entries: [SavingsEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    private var lifetimeCents: Int64 {
        entries.reduce(0) { $0 + ($1.savingsCents ?? 0) }
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
                ProgressView("Loading savings…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
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
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var listContent: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Lifetime savings")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(MoneyFormat.usd(cents: lifetimeCents))
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .foregroundStyle(BrandTheme.savings)
                        .monospacedDigit()
                        .accessibilityLabel("Lifetime savings \(MoneyFormat.usd(cents: lifetimeCents))")
                    Text("What you paid versus market median on awarded reverse-auction jobs — not platform markup.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
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
                Text("Savings = market median − awarded bid (when positive). Amounts are in USD.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func savingsRow(_ entry: SavingsEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.shortJobID)
                    .font(.body.weight(.medium).monospaced())
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(entry.displaySavings)
                    .font(.body.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.savings)
            }

            HStack(spacing: 12) {
                labeledMini(title: "Awarded", value: entry.displayAwarded)
                labeledMini(title: "Median", value: entry.displayMarketMedian)
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

    private func labeledMini(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(BrandTheme.textPrimary)
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = entries.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchMySavings()
            entries = response.entries
        } catch let error as APIClientError where error.isUnauthorized {
            errorMessage = "Sign in required. Your session is missing or expired."
        } catch {
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
