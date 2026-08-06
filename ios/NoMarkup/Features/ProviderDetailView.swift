import SwiftUI

/// Public provider profile — `GET /api/v1/providers/{id}`.
/// Signed-in users can block or report via `/api/v1/users/{id}/block|report`.
struct ProviderDetailView: View {
    let providerID: String
    var preview: ProviderSearchResult?

    @EnvironmentObject private var auth: AuthViewModel

    @State private var profile: ProviderProfileDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var isBlocking = false
    @State private var isFollowing = false
    @State private var isTogglingFollow = false
    @State private var showReportSheet = false
    @State private var showBlockConfirm = false

    init(providerID: String, preview: ProviderSearchResult? = nil) {
        self.providerID = providerID
        self.preview = preview
    }

    private var blockTargetID: String {
        if let userId = profile?.userId?.trimmingCharacters(in: .whitespacesAndNewlines), !userId.isEmpty {
            return userId
        }
        return providerID
    }

    private var canMutateSafety: Bool {
        auth.isAuthenticated && !auth.isScaffoldSession
    }

    var body: some View {
        Group {
            if isLoading && profile == nil {
                BrandLoadingScreen(kind: .detail, accessibilityLabel: "Loading provider…")
            } else if let errorMessage, profile == nil {
                BrandEmptyState(
                    title: "Couldn’t load provider",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if let profile {
                profileList(profile)
            } else {
                BrandEmptyState(
                    title: "Provider not found",
                    systemImage: "person.crop.circle.badge.questionmark",
                    message: "This provider profile is unavailable."
                )
            }
        }
        .navigationTitle(navigationTitleText)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showReportSheet) {
            UserReportSheet(userID: blockTargetID) {
                showReportSheet = false
            }
            .environmentObject(auth)
        }
        .confirmationDialog(
            "Block this user?",
            isPresented: $showBlockConfirm,
            titleVisibility: .visible
        ) {
            Button("Block user", role: .destructive) {
                Task { await block() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You won’t see their messages. You can unblock later from Blocked users.")
        }
    }

    private var navigationTitleText: String {
        if let name = profile?.displayLabel.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if let name = preview?.displayLabel.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        return "Provider"
    }

    @ViewBuilder
    private func profileList(_ profile: ProviderProfileDetail) -> some View {
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

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(profile.displayLabel)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    if let business = profile.businessName?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !business.isEmpty {
                        Text(business)
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    if profile.instantAvailable == true {
                        Label("Instant available", systemImage: "bolt.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.teal)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
                .listRowBackground(BrandTheme.navyElevated)
            }

            if let bio = profile.bio?.trimmingCharacters(in: .whitespacesAndNewlines), !bio.isEmpty {
                Section {
                    Text(bio)
                        .font(.body)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("About").brandSectionHeader()
                }
            }

            Section {
                if canMutateSafety {
                    Button {
                        Task { await toggleFollow() }
                    } label: {
                        HStack {
                            if isTogglingFollow {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                            }
                            Label(
                                isFollowing ? "Following" : "Follow",
                                systemImage: isFollowing ? "person.badge.minus" : "person.badge.plus"
                            )
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(isTogglingFollow)
                    .tint(isFollowing ? BrandTheme.textSecondary : BrandTheme.accent)
                    .accessibilityHint(
                        isFollowing
                            ? "Stops following this seller"
                            : "Follows this seller so their auctions appear in your feed"
                    )
                } else {
                    Text("Sign in to follow this seller.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(minHeight: 44)
                }

                if let count = profile.followerCount {
                    LabeledContent("Followers") {
                        Text("\(count)")
                            .foregroundStyle(BrandTheme.textPrimary)
                            .monospacedDigit()
                    }
                    .frame(minHeight: 44)
                }
            } header: {
                Text("Social").brandSectionHeader()
            }
            .listRowBackground(BrandTheme.navyElevated)

            Section {
                NavigationLink {
                    TrustScoreView(userId: blockTargetID, displayName: profile.displayLabel)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "shield.lefthalf.filled")
                            .foregroundStyle(BrandTheme.goldBright)
                            .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Trust score")
                                .font(.body.weight(.medium))
                                .foregroundStyle(BrandTheme.textPrimary)
                            if let trust = profile.trustScore {
                                Text(trustSubtitle(trust))
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            } else {
                                Text("Full breakdown · Feedback, Risk, Volume, Fraud")
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }

                        Spacer(minLength: 8)

                        if let trust = profile.trustScore {
                            VStack(alignment: .trailing, spacing: 2) {
                                if trust.displayOverallPoints != "—" {
                                    Text(trust.displayOverallPoints)
                                        .font(.title3.weight(.bold).monospacedDigit())
                                        .foregroundStyle(BrandTheme.goldBright)
                                }
                                Text(trust.displayTier)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(BrandTheme.goldBrightFill, in: Capsule())
                            }
                        } else {
                            Text("View")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
                }
                .accessibilityHint("Opens full trust score breakdown with four weighted dimensions")
            } header: {
                Text("Trust").brandSectionHeader()
            } footer: {
                Text("Composite score is weighted Feedback 35%, Risk 25%, Volume 20%, Fraud 20%.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)

            Section {
                LabeledContent("Jobs completed") {
                    Text("\(profile.jobsCompleted ?? 0)")
                        .foregroundStyle(BrandTheme.textPrimary)
                        .monospacedDigit()
                }
                .frame(minHeight: 44)

                // FR-5.1 — response / on-time when available.
                if let label = profile.responseTimeLabel, !label.isEmpty {
                    LabeledContent("Avg response", value: label)
                        .frame(minHeight: 44)
                } else if let minutes = profile.avgResponseTimeMinutes, minutes > 0 {
                    LabeledContent("Avg response") {
                        Text(minutes < 60
                            ? "\(Int(minutes.rounded())) min"
                            : String(format: "%.1f hr", minutes / 60))
                            .foregroundStyle(BrandTheme.textPrimary)
                    }
                    .frame(minHeight: 44)
                }
                if let onTime = profile.onTimeRate {
                    LabeledContent("On-time rate") {
                        Text("\(Int((onTime <= 1 ? onTime * 100 : onTime).rounded()))%")
                            .foregroundStyle(BrandTheme.textPrimary)
                            .monospacedDigit()
                    }
                    .frame(minHeight: 44)
                }
                if let radius = profile.serviceRadiusKm, radius > 0 {
                    LabeledContent("Service radius") {
                        Text("\(Int(radius.rounded())) km")
                            .foregroundStyle(BrandTheme.textPrimary)
                            .monospacedDigit()
                    }
                    .frame(minHeight: 44)
                }

                if let summary = profile.reviewSummaryLabel {
                    NavigationLink {
                        UserReviewsView(userId: blockTargetID, displayName: profile.displayLabel)
                    } label: {
                        LabeledContent("Reviews") {
                            Text(summary)
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityHint("Opens full reviews for this provider")
                } else if let rating = profile.averageRating, rating > 0 {
                    NavigationLink {
                        UserReviewsView(userId: blockTargetID, displayName: profile.displayLabel)
                    } label: {
                        LabeledContent("Rating") {
                            Text(String(format: "%.1f", rating))
                                .foregroundStyle(BrandTheme.goldBright)
                                .monospacedDigit()
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityHint("Opens full reviews for this provider")
                } else {
                    NavigationLink {
                        UserReviewsView(userId: blockTargetID, displayName: profile.displayLabel)
                    } label: {
                        Text("View reviews")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(minHeight: 44)
                    }
                    .accessibilityHint("Opens reviews for this provider")
                }

                LabeledContent("Portfolio") {
                    Text(String(localized: "\(profile.portfolioCount) photos"))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .monospacedDigit()
                }
                .frame(minHeight: 44)
            } header: {
                Text("Stats").brandSectionHeader()
            }
            .listRowBackground(BrandTheme.navyElevated)

            // FR-5.3 — global terms visible on public profile.
            if profile.defaultPaymentTiming != nil
                || !(profile.cancellationPolicy ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !(profile.warrantyTerms ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            {
                Section {
                    if let timing = profile.defaultPaymentTiming?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !timing.isEmpty
                    {
                        LabeledContent("Payment timing", value: StatusChipStyle.displayLabel(timing))
                            .frame(minHeight: 44)
                    }
                    if let cancel = profile.cancellationPolicy?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !cancel.isEmpty
                    {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Cancellation")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.textSecondary)
                            Text(cancel)
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                    }
                    if let warranty = profile.warrantyTerms?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !warranty.isEmpty
                    {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Warranty")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.textSecondary)
                            Text(warranty)
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                    }
                } header: {
                    Text("Default terms").brandSectionHeader()
                } footer: {
                    Text("These are the provider’s global terms. Local terms may still be negotiated in chat before award.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            if !profile.categoryNames.isEmpty {
                Section {
                    ForEach(profile.categoryNames, id: \.self) { name in
                        Text(name)
                            .foregroundStyle(BrandTheme.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(minHeight: 44)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text("Categories").brandSectionHeader()
                }
            }

            Section {
                if canMutateSafety {
                    Button(role: .destructive) {
                        showBlockConfirm = true
                    } label: {
                        HStack {
                            if isBlocking {
                                ProgressView()
                                    .tint(BrandTheme.destructive)
                            }
                            Label("Block user", systemImage: "hand.raised.fill")
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(isBlocking)
                    .accessibilityHint("Blocks this user from messaging you")

                    Button {
                        showReportSheet = true
                    } label: {
                        Label("Report user", systemImage: "exclamationmark.bubble")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(minHeight: 44)
                    }
                    .tint(BrandTheme.warning)
                    .accessibilityHint("Submit an abuse report to NoMarkup")
                } else {
                    Text("Sign in to block or report this user.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(minHeight: 44)

                    Button {
                        auth.signOut()
                    } label: {
                        Text("Sign in")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                }
            } header: {
                Text("Safety").brandSectionHeader()
            } footer: {
                Text("Blocking mutes chat. Reports go to platform moderation — false reports may lead to account action.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
        .brandListBackground()
    }

    private func trustSubtitle(_ trust: ProviderTrustSummary) -> String {
        var parts: [String] = []
        if trust.displayOverallPoints != "—" {
            parts.append("\(trust.displayOverallPoints)/100")
        }
        if trust.displayTier != "—" {
            parts.append(trust.displayTier)
        }
        if parts.isEmpty {
            return "Full breakdown · Feedback, Risk, Volume, Fraud"
        }
        return parts.joined(separator: " · ") + " · open breakdown"
    }

    @MainActor
    private func load() async {
        isLoading = profile == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            let loaded = try await APIClient.shared.fetchProvider(id: providerID)
            profile = loaded
            isFollowing = loaded.isFollowing ?? false
        } catch {
            if profile == nil {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func toggleFollow() async {
        statusMessage = nil
        statusIsError = false
        guard canMutateSafety else {
            statusIsError = true
            statusMessage = "Sign in required to follow sellers."
            return
        }

        let previous = isFollowing
        isTogglingFollow = true
        defer { isTogglingFollow = false }

        // Optimistic flip for responsive feedback.
        isFollowing = !previous
        do {
            let response: FollowToggleResponse
            if previous {
                response = try await APIClient.shared.unfollowUser(id: blockTargetID)
            } else {
                response = try await APIClient.shared.followUser(id: blockTargetID)
            }
            isFollowing = response.following ?? !previous
            if let count = response.followerCount {
                profile?.followerCount = count
            } else if let current = profile?.followerCount {
                profile?.followerCount = max(0, current + (isFollowing ? 1 : -1))
            }
            statusIsError = false
            statusMessage = isFollowing ? "Following this seller." : "Unfollowed."
        } catch let error as APIClientError where error.isUnauthorized {
            isFollowing = previous
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            isFollowing = previous
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func block() async {
        statusMessage = nil
        statusIsError = false
        guard canMutateSafety else {
            statusIsError = true
            statusMessage = "Sign in required to block users."
            return
        }

        isBlocking = true
        defer { isBlocking = false }

        do {
            try await APIClient.shared.blockUser(id: blockTargetID)
            statusIsError = false
            statusMessage = "User blocked. You can manage blocks from Account → Blocked users."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - User report sheet

private enum UserReportReason: String, CaseIterable, Identifiable {
    case harassment
    case spam
    case scam
    case inappropriate
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .harassment: return "Harassment"
        case .spam: return "Spam"
        case .scam: return "Scam"
        case .inappropriate: return "Inappropriate"
        case .other: return "Other"
        }
    }
}

private struct UserReportSheet: View {
    let userID: String
    var onDone: () -> Void

    @EnvironmentObject private var auth: AuthViewModel

    @State private var reason: UserReportReason = .spam
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(UserReportReason.allCases) { item in
                            Text(item.displayName).tag(item)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Report reason")
                } header: {
                    Text("Why are you reporting?").brandSectionHeader()
                }

                Section {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Additional details")
                } header: {
                    Text("Details (optional)").brandSectionHeader()
                } footer: {
                    Text("Reports help keep NoMarkup safe. False reports may lead to account action.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isSubmitting || !auth.isAuthenticated || auth.isScaffoldSession)
                }
            }
            .brandListBackground()
            .navigationTitle("Report user")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDone() }
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        statusMessage = nil
        statusIsError = false
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            try await APIClient.shared.reportUser(
                id: userID,
                reason: reason.rawValue,
                description: descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            statusIsError = false
            statusMessage = "Thanks — your report was submitted."
            try? await Task.sleep(nanoseconds: 900_000_000)
            onDone()
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
        ProviderDetailView(providerID: "00000000-0000-0000-0000-000000000001")
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
