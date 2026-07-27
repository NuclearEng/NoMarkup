import SwiftUI

/// Provider workspace lite — own profile, instant availability, streaks, licenses.
/// Not full Business OS (no employees / tax / expenses / working capital).
///
/// APIs: `GET|PATCH /providers/me`, `PUT …/availability`, `GET …/streaks`, `GET …/licenses`.
struct ProviderWorkspaceView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var profile: ProviderMeProfile?
    @State private var streaks: [ProviderStreak] = []
    @State private var licenses: [ProviderLicense] = []
    @State private var hasProviderRole = false
    @State private var roleChecked = false

    @State private var businessName = ""
    @State private var bio = ""
    @State private var instantAvailable = false

    @State private var isLoading = false
    @State private var isSaving = false
    @State private var isTogglingInstant = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var loadError: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer.fill",
                    message: "Browse-only mode has no API token. Sign in with a real account to manage your provider workspace.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to edit your business profile, availability, streaks, and licenses.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && !roleChecked {
                ProgressView("Loading provider workspace…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if roleChecked && !hasProviderRole {
                BrandEmptyState(
                    title: "Provider role required",
                    systemImage: "wrench.and.screwdriver",
                    message: "Enable the provider role in Profile settings to bid on jobs and manage your provider workspace.",
                    actionTitle: nil,
                    action: nil
                )
                .safeAreaInset(edge: .bottom) {
                    NavigationLink {
                        ProfileSettingsView()
                    } label: {
                        Text("Open Profile settings")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                    .accessibilityHint("Enable the provider role so you can use this workspace")
                }
            } else if let loadError, profile == nil {
                BrandEmptyState(
                    title: "Couldn’t load workspace",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else if profile != nil {
                formContent
            } else {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            }
        }
        .navigationTitle("Provider workspace")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var formContent: some View {
        Form {
            Section {
                TextField("Business name", text: $businessName, prompt: Text("Public business name"))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled(false)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Business name")

                TextField("Bio", text: $bio, prompt: Text("Short public bio"), axis: .vertical)
                    .lineLimit(3 ... 8)
                    .textInputAutocapitalization(.sentences)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Bio")
            } header: {
                Text("Public profile").brandSectionHeader()
            } footer: {
                Text("Customers see business name and bio on your provider profile and bid cards.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                Toggle(isOn: Binding(
                    get: { instantAvailable },
                    set: { newValue in
                        Task { await setInstantAvailable(newValue) }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Available now")
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text("Show as ready for instant-match job offers.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .tint(BrandTheme.accent)
                .frame(minHeight: 44)
                .disabled(isTogglingInstant || isSaving)
                .accessibilityHint("Toggles instant availability for job offers")

                if let enabled = profile?.instantEnabled {
                    LabeledContent("Instant program") {
                        Text(enabled ? "Enabled" : "Not enabled")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                }
            } header: {
                Text("Availability").brandSectionHeader()
            }

            if let cats = profile?.serviceCategories, !cats.isEmpty {
                Section {
                    ForEach(cats, id: \.idValue) { cat in
                        Text(cat.displayName)
                            .foregroundStyle(BrandTheme.textPrimary)
                            .frame(minHeight: 44)
                    }
                } header: {
                    Text("Categories").brandSectionHeader()
                } footer: {
                    Text("Category membership is managed here as read-only. Full taxonomy edit remains on web for now.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            Section {
                if streaks.isEmpty {
                    Text("No win streaks yet. Streaks build when you win reverse-auction jobs.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(minHeight: 44)
                } else {
                    ForEach(streaks) { streak in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(streak.displayCategory)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                if let rank = streak.categoryRank {
                                    Text("Category rank #\(rank)")
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(streak.currentStreak ?? 0) current")
                                    .font(.subheadline.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(BrandTheme.goldBright)
                                Text("best \(streak.longestStreak ?? 0) · \(streak.totalWins ?? 0) wins")
                                    .font(.caption2)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        .frame(minHeight: 44)
                        .accessibilityElement(children: .combine)
                    }
                }
            } header: {
                Text("Streaks").brandSectionHeader()
            }

            Section {
                if licenses.isEmpty {
                    Text("No professional licenses on file.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(minHeight: 44)
                } else {
                    ForEach(licenses) { license in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(license.displayType)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Spacer()
                                Text(license.displayStatus)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(statusColor(license.statusStyle))
                            }
                            HStack {
                                Text(license.maskedNumber)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                                Spacer()
                                Text(license.displayJurisdiction)
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        .frame(minHeight: 44)
                        .accessibilityElement(children: .combine)
                    }
                }
            } header: {
                Text("Licenses").brandSectionHeader()
            } footer: {
                Text("Licenses are reviewed by the platform. Submit new credentials from the web legal vertical when available.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                NavigationLink {
                    QuoteTemplatesView()
                } label: {
                    Label("Quote templates", systemImage: "doc.text")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Reusable bid wording and default amounts")

                NavigationLink {
                    VerificationDocumentsView()
                } label: {
                    Label("Verification documents", systemImage: "checkmark.shield")
                }
                .frame(minHeight: 44)
                .accessibilityHint("View insurance and ID verification status")

                NavigationLink {
                    CalendarExportView()
                } label: {
                    Label("Calendar export", systemImage: "calendar")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Download an iCal file of contracts and jobs")

                NavigationLink {
                    SalesExportView()
                } label: {
                    Label("Sales export (CSV)", systemImage: "tablecells")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Download completed marketplace sales as CSV")
            } header: {
                Text("Tools").brandSectionHeader()
            } footer: {
                Text("Exports and templates help run your provider practice without the full web Business OS.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let profile {
                Section {
                    if let jobs = profile.jobsCompleted {
                        LabeledContent("Jobs completed", value: "\(jobs)")
                            .frame(minHeight: 44)
                    }
                    if let complete = profile.profileCompleteness {
                        LabeledContent("Profile completeness") {
                            Text("\(Int((complete * 100).rounded()))%")
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        .frame(minHeight: 44)
                    }
                    if let stripe = profile.stripeOnboardingComplete {
                        LabeledContent("Stripe onboarding") {
                            Text(stripe ? "Complete" : "Incomplete")
                                .foregroundStyle(stripe ? BrandTheme.success : BrandTheme.warning)
                        }
                        .frame(minHeight: 44)
                    }
                    if let member = profile.memberSince, !member.isEmpty {
                        LabeledContent("Member since", value: CatalogDateFormat.friendlyDateTime(member))
                            .frame(minHeight: 44)
                    }
                    if let timing = profile.defaultPaymentTiming, !timing.isEmpty {
                        LabeledContent("Default payment", value: StatusChipStyle.displayLabel(timing))
                            .frame(minHeight: 44)
                    }
                } header: {
                    Text("Stats").brandSectionHeader()
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                Button {
                    Task { await saveProfile() }
                } label: {
                    HStack {
                        if isSaving {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(isSaving ? "Saving…" : "Save profile")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canSave || isSaving || isTogglingInstant)
                .accessibilityHint("Saves business name and bio to the server")
            } footer: {
                Text("Provider workspace is a lite surface — employees, tax, expenses, and working capital stay on web Business OS.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
        .scrollDismissesKeyboard(.interactively)
        .overlay {
            if isLoading && profile != nil {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .padding(12)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
    }

    private var canSave: Bool {
        guard profile != nil, !isSaving else { return false }
        let name = businessName.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = bio.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count <= 120, body.count <= 2000 else { return false }
        let originalName = profile?.businessName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let originalBio = profile?.bio?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name != originalName || body != originalBio
    }

    private func statusColor(_ style: StatusChipStyle) -> Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.accent
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    // MARK: - Load / mutate

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }

        isLoading = profile == nil
        loadError = nil
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let me = try await APIClient.shared.fetchMe()
            hasProviderRole = me.hasProviderRole
            roleChecked = true

            guard me.hasProviderRole else {
                profile = nil
                streaks = []
                licenses = []
                return
            }

            async let profileTask = APIClient.shared.fetchMyProviderProfile()
            async let streaksTask = APIClient.shared.fetchMyProviderStreaks()
            async let licensesTask = APIClient.shared.fetchMyProviderLicenses()

            let loaded = try await profileTask
            profile = loaded
            applyProfileToForm(loaded)

            // Streaks / licenses degrade soft — profile is the primary surface.
            do {
                let streakBundle = try await streaksTask
                streaks = streakBundle.items
            } catch {
                streaks = []
            }
            do {
                licenses = try await licensesTask
            } catch {
                licenses = []
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            profile = nil
            roleChecked = false
        } catch let error as APIClientError where error.isForbidden {
            // JWT may lag role grants; still surface enable messaging.
            hasProviderRole = false
            roleChecked = true
            profile = nil
        } catch {
            if profile == nil {
                loadError = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
            roleChecked = true
        }
    }

    @MainActor
    private func applyProfileToForm(_ p: ProviderMeProfile) {
        businessName = p.businessName ?? ""
        bio = p.bio ?? ""
        instantAvailable = p.isInstantAvailable
    }

    @MainActor
    private func saveProfile() async {
        errorMessage = nil
        statusMessage = nil

        let name = businessName.trimmingCharacters(in: .whitespacesAndNewlines)
        let bodyText = bio.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count <= 120 else {
            errorMessage = "Business name must be at most 120 characters."
            return
        }
        guard bodyText.count <= 2000 else {
            errorMessage = "Bio must be at most 2000 characters."
            return
        }

        isSaving = true
        defer { isSaving = false }

        do {
            let updated = try await APIClient.shared.updateMyProviderProfile(
                businessName: name,
                bio: bodyText
            )
            profile = updated
            applyProfileToForm(updated)
            statusMessage = "Profile saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            errorMessage = "Provider role required. Enable it in Profile settings."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func setInstantAvailable(_ value: Bool) async {
        errorMessage = nil
        statusMessage = nil
        let previous = instantAvailable
        instantAvailable = value
        isTogglingInstant = true
        defer { isTogglingInstant = false }

        do {
            // Turning available-now on also enables the instant program flag.
            let enabled = value || (profile?.isInstantEnabled ?? false)
            let response = try await APIClient.shared.setMyProviderAvailability(
                enabled: enabled || value,
                availableNow: value
            )
            if var p = profile {
                p.instantEnabled = response.instantEnabled ?? (enabled || value)
                p.instantAvailable = response.instantAvailable ?? value
                profile = p
            }
            instantAvailable = response.instantAvailable ?? value
            statusMessage = value ? "You’re marked available now." : "Available now turned off."
        } catch let error as APIClientError where error.isUnauthorized {
            instantAvailable = previous
            needsSignIn = true
        } catch {
            instantAvailable = previous
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        ProviderWorkspaceView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
