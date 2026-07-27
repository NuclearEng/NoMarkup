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
                ProgressView("Loading provider…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
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
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
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
                LabeledContent("Jobs completed") {
                    Text("\(profile.jobsCompleted ?? 0)")
                        .foregroundStyle(BrandTheme.textPrimary)
                        .monospacedDigit()
                }
                .frame(minHeight: 44)

                if let summary = profile.reviewSummaryLabel {
                    LabeledContent("Reviews") {
                        Text(summary)
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    .frame(minHeight: 44)
                } else if let rating = profile.averageRating, rating > 0 {
                    LabeledContent("Rating") {
                        Text(String(format: "%.1f", rating))
                            .foregroundStyle(BrandTheme.goldBright)
                            .monospacedDigit()
                    }
                    .frame(minHeight: 44)
                }

                LabeledContent("Portfolio") {
                    Text("\(profile.portfolioCount) photo\(profile.portfolioCount == 1 ? "" : "s")")
                        .foregroundStyle(BrandTheme.textPrimary)
                        .monospacedDigit()
                }
                .frame(minHeight: 44)
            } header: {
                Text("Stats").brandSectionHeader()
            }
            .listRowBackground(BrandTheme.navyElevated)

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

    @MainActor
    private func load() async {
        isLoading = profile == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            profile = try await APIClient.shared.fetchProvider(id: providerID)
        } catch {
            if profile == nil {
                errorMessage = error.localizedDescription
            }
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
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(isSubmitting || !auth.isAuthenticated || auth.isScaffoldSession)
                }
            }
            .brandListBackground()
            .navigationTitle("Report user")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
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
