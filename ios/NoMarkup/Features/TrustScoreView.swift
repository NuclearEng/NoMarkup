import SwiftUI

/// Full trust score breakdown — `GET /api/v1/users/{id}/trust-score`.
/// Showcase weights: Feedback 35%, Risk 25%, Volume 20%, Fraud 20%.
/// Composite displayed 0–100 from server 0…1 scores.
struct TrustScoreView: View {
    let userId: String
    var displayName: String?

    @State private var score: UserTrustScore?
    @State private var history: [UserTrustHistorySnapshot] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsAuth = false

    init(userId: String, displayName: String? = nil) {
        self.userId = userId
        self.displayName = displayName
    }

    private var navigationTitleText: String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Trust score" : "Trust · \(name)"
    }

    var body: some View {
        content
            .navigationTitle(navigationTitleText)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .task { await load() }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && score == nil {
            ProgressView("Loading trust score…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if needsAuth, score == nil {
            BrandEmptyState(
                title: "Sign in required",
                systemImage: "person.crop.circle.badge.lock",
                message: "Trust scores are available when you are signed in against a live gateway.",
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if let errorMessage, score == nil {
            BrandEmptyState(
                title: "Couldn’t load trust score",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if let score {
            scoreList(score)
        } else {
            BrandEmptyState(
                title: "No trust score yet",
                systemImage: "shield.lefthalf.filled",
                message: "This user has no computed trust score. Scores update after completed jobs and reviews."
            )
        }
    }

    private func scoreList(_ score: UserTrustScore) -> some View {
        List {
            Section {
                overallHeader(score)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(score.dimensions) { dimension in
                    dimensionRow(dimension)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Breakdown").brandSectionHeader()
            } footer: {
                Text("Weighted composite: Feedback \(TrustScoreWeights.feedbackPercentLabel), Risk \(TrustScoreWeights.riskPercentLabel), Volume \(TrustScoreWeights.volumePercentLabel), Fraud \(TrustScoreWeights.fraudPercentLabel). Higher is better on every bar.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                LabeledContent("Data points") {
                    Text("\(score.dataPoints ?? 0)")
                        .foregroundStyle(BrandTheme.textPrimary)
                        .monospacedDigit()
                }
                .frame(minHeight: 44)

                if let computed = score.computedAtLabel {
                    LabeledContent("Computed") {
                        Text(computed)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .multilineTextAlignment(.trailing)
                    }
                    .frame(minHeight: 44)
                }

                NavigationLink {
                    TrustTiersView()
                } label: {
                    Label("How tiers work", systemImage: "list.bullet.rectangle")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                }
                .accessibilityHint("Opens platform trust tier requirements")
            } header: {
                Text("Details").brandSectionHeader()
            }
            .listRowBackground(BrandTheme.navyElevated)

            if !history.isEmpty {
                Section {
                    ForEach(history) { snapshot in
                        historyRow(snapshot)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text("Recent history").brandSectionHeader()
                } footer: {
                    Text("Snapshots of how this score changed over time.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func overallHeader(_ score: UserTrustScore) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Composite")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(score.displayOverall)
                            .font(.largeTitle.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                        Text("/ 100")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Overall trust score \(score.displayOverall) out of 100")
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 6) {
                    Text(score.displayTier)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.navy)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(BrandTheme.goldBright, in: Capsule())
                        .accessibilityLabel("Tier \(score.displayTier)")

                    if let points = score.dataPoints, points > 0 {
                        Text(String(localized: "\(points) data points"))
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .monospacedDigit()
                    }
                }
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(BrandTheme.surfaceRaised)
                    Capsule()
                        .fill(BrandTheme.goldBright)
                        .frame(width: max(0, geo.size.width * score.normalizedOverall))
                }
            }
            .frame(height: 10)
            .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 44, alignment: .leading)
    }

    @ViewBuilder
    private func dimensionRow(_ dimension: TrustScoreDimension) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: dimension.systemImage)
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(width: 22)
                    .accessibilityHidden(true)

                Text(dimension.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)

                Text(dimension.weightLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(BrandTheme.surfaceRaised, in: Capsule())

                Spacer(minLength: 8)

                Text(dimension.displayPoints)
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                Text("/ 100")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(BrandTheme.surfaceRaised)
                    Capsule()
                        .fill(barColor(for: dimension.id))
                        .frame(width: max(0, geo.size.width * dimension.normalized))
                }
            }
            .frame(height: 8)
            .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(dimension.title), weight \(dimension.weightLabel), score \(dimension.displayPoints) out of 100"
        )
    }

    private func barColor(for dimensionId: String) -> Color {
        switch dimensionId {
        case "feedback":
            return BrandTheme.goldBright
        case "risk":
            return BrandTheme.teal
        case "volume":
            return BrandTheme.bidActive
        case "fraud":
            return BrandTheme.success
        default:
            return BrandTheme.gold
        }
    }

    @ViewBuilder
    private func historyRow(_ snapshot: UserTrustHistorySnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(snapshot.displayReason)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(snapshot.displayOverall)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
            Text(snapshot.recordedAtLabel)
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(snapshot.displayReason), score \(snapshot.displayOverall), \(snapshot.recordedAtLabel)")
    }

    @MainActor
    private func load() async {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "User id is missing."
            needsAuth = false
            return
        }

        isLoading = score == nil
        errorMessage = nil
        needsAuth = false
        defer { isLoading = false }

        do {
            let loaded = try await APIClient.shared.fetchUserTrustScore(userId: trimmed)
            score = loaded
        } catch let error as APIClientError where error.isUnauthorized {
            if score == nil {
                needsAuth = true
                errorMessage = nil
            }
            return
        } catch {
            if score == nil {
                errorMessage = error.localizedDescription
            }
            return
        }

        // History is best-effort — never fail the main score UI.
        do {
            let historyResponse = try await APIClient.shared.fetchUserTrustHistory(
                userId: trimmed,
                page: 1,
                pageSize: 10
            )
            history = historyResponse.snapshots
        } catch is CancellationError {
            // Pull-to-refresh / navigation cancel — keep prior history.
        } catch {
            // Soft-fail history only: score section already rendered.
            // Clear stale rows when a new load failed so we don't show wrong user data.
            history = []
        }
    }
}

#Preview {
    NavigationStack {
        TrustScoreView(
            userId: "00000000-0000-0000-0000-000000000001",
            displayName: "Sample Provider"
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
