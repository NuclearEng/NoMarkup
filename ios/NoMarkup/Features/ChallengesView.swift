import SwiftUI

/// Provider challenges / seasonal events — list active + join.
///
/// APIs: `GET /api/v1/challenges`, `POST /api/v1/challenges/{id}/join`.
/// Authenticated provider surface under Account / Provider workspace.
struct ChallengesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var challenges: [ProviderChallenge] = []
    @State private var isLoading = false
    @State private var joiningID: String?
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var loadError: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "flag.checkered",
                    message: "Browse-only mode has no API token. Sign in as a provider to join challenges.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to view and join challenges.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && challenges.isEmpty && loadError == nil {
                ProgressView("Loading challenges…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let loadError, challenges.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load challenges",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else if challenges.isEmpty {
                BrandEmptyState(
                    title: "No active challenges",
                    systemImage: "flag",
                    message: "Complete challenges to earn rewards when the platform runs seasonal events.",
                    actionTitle: "Refresh",
                    action: { Task { await load() } }
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Challenges")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
    }

    private var listContent: some View {
        List {
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(challenges) { challenge in
                    challengeRow(challenge)
                }
            } header: {
                Text("Active").brandSectionHeader()
            } footer: {
                Text("Join a challenge to track progress toward badges, fee discounts, and profile highlights.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    private func challengeRow(_ challenge: ProviderChallenge) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(challenge.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if challenge.isSeasonal == true {
                    Text(challenge.seasonName?.isEmpty == false ? (challenge.seasonName ?? "Seasonal") : "Seasonal")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.goldBright)
                }
            }

            if let description = challenge.description, !description.isEmpty {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(4)
            }

            HStack(spacing: 12) {
                Label(challenge.displayType, systemImage: "target")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                if let remaining = challenge.timeRemainingLabel {
                    Label(remaining, systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.goldBright)
                }
            }

            if challenge.joined == true, let progress = challenge.myProgress {
                VStack(alignment: .leading, spacing: 4) {
                    ProgressView(value: min(max(progress.fractionComplete, 0), 1))
                        .tint(BrandTheme.accent)
                    Text(progress.progressCaption(target: challenge.targetValue ?? 0))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            } else {
                Button {
                    Task { await join(challenge) }
                } label: {
                    HStack {
                        if joiningID == challenge.id {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(joiningID == challenge.id ? "Joining…" : "Join challenge")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(joiningID != nil)
                .accessibilityLabel("Join \(challenge.displayTitle)")
            }

            if let reward = challenge.rewardLabel {
                Text(reward)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
            }
        }
        .padding(.vertical, 6)
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            needsSignIn = true
            return
        }
        isLoading = challenges.isEmpty
        loadError = nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            challenges = try await APIClient.shared.fetchActiveChallenges()
            needsSignIn = false
        } catch let error as APIClientError {
            if case .httpStatus(401, _) = error {
                needsSignIn = true
                challenges = []
                return
            }
            if challenges.isEmpty {
                loadError = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            if challenges.isEmpty {
                loadError = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func join(_ challenge: ProviderChallenge) async {
        guard joiningID == nil else { return }
        joiningID = challenge.id
        errorMessage = nil
        defer { joiningID = nil }

        do {
            try await APIClient.shared.joinChallenge(id: challenge.id)
            statusMessage = "Joined \(challenge.displayTitle)."
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        ChallengesView()
            .environmentObject(AuthViewModel())
    }
}
