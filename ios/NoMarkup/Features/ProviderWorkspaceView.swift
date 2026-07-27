import SwiftUI

/// Provider workspace lite — own profile, instant availability, streaks, licenses.
/// Not full Business OS (no employees / tax / expenses / working capital).
///
/// APIs: `GET|PATCH /providers/me`, `PUT …/availability` (instant + weekly windows),
/// `GET …/streaks`, `GET …/licenses`.
///
/// Security: gateway `RequireProvider` on `/providers/me/*`; UI also gates on
/// `hasProviderRole` so customers never hit the write path from this surface.
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
    /// Local weekly Instant windows (`day` = mon…sun, times = HH:MM).
    /// Residual: GET `/providers/me` does not return `instant_schedule`, so this
    /// cannot be hydrated from the server after cold start / reinstall.
    @State private var scheduleDays: [ProviderScheduleDayDraft] = ProviderScheduleDayDraft.blankWeek()
    @State private var paymentTiming = "completion"
    @State private var cancellationPolicy = ""
    @State private var warrantyTerms = ""
    @State private var portfolioURLs: [String] = []
    @State private var isUploadingPortfolio = false
    @State private var isSavingTerms = false
    @State private var isSavingPortfolio = false
    @State private var isSavingSchedule = false

    @State private var isLoading = false
    @State private var isSaving = false
    @State private var isTogglingInstant = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var loadError: String?

    private let paymentTimingOptions = ["upfront", "completion", "milestone", "split"]

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
                .disabled(isTogglingInstant || isSaving || isSavingSchedule)
                .accessibilityHint("Toggles instant availability for job offers")

                if let enabled = profile?.instantEnabled {
                    LabeledContent("Instant program") {
                        Text(enabled ? "Enabled" : "Not enabled")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                }

                NavigationLink {
                    ProviderInstantOffersView()
                } label: {
                    Label("Instant offers inbox", systemImage: "bolt.badge.clock")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Accept or decline emergency Instant match requests")
            } header: {
                Text("Availability").brandSectionHeader()
            } footer: {
                Text("Turn Available now on to receive Instant jobs. Open the inbox to accept or decline live offers.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                ForEach($scheduleDays) { $day in
                    VStack(alignment: .leading, spacing: 8) {
                        Toggle(isOn: $day.isEnabled) {
                            Text(day.label)
                                .foregroundStyle(BrandTheme.textPrimary)
                        }
                        .tint(BrandTheme.accent)
                        .frame(minHeight: 44)
                        .accessibilityLabel("\(day.label) available")
                        .disabled(isSavingSchedule || isTogglingInstant)

                        if day.isEnabled {
                            HStack(spacing: 12) {
                                DatePicker(
                                    "Start",
                                    selection: $day.startTime,
                                    displayedComponents: .hourAndMinute
                                )
                                .labelsHidden()
                                .frame(minHeight: 44)
                                .accessibilityLabel("\(day.label) start time")

                                Text("to")
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)

                                DatePicker(
                                    "End",
                                    selection: $day.endTime,
                                    displayedComponents: .hourAndMinute
                                )
                                .labelsHidden()
                                .frame(minHeight: 44)
                                .accessibilityLabel("\(day.label) end time")
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                Button {
                    Task { await saveSchedule() }
                } label: {
                    HStack {
                        if isSavingSchedule {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        }
                        Text(isSavingSchedule ? "Saving schedule…" : "Save weekly schedule")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(isSavingSchedule || isTogglingInstant || isSaving)
                .accessibilityHint("Uploads weekly Instant availability windows to the server")
            } header: {
                Text("Weekly schedule").brandSectionHeader()
            } footer: {
                Text("Optional day windows (local time, HH:MM) sent with Instant availability. Available now still works without a schedule. Saved windows are not returned by the API yet — re-enter them after reinstall.")
                    .foregroundStyle(BrandTheme.textSecondary)
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
                .accessibilityHint("View status and upload insurance, license, or ID documents")

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

            Section {
                Picker("Default payment timing", selection: $paymentTiming) {
                    ForEach(paymentTimingOptions, id: \.self) { opt in
                        Text(opt.replacingOccurrences(of: "_", with: " ").capitalized).tag(opt)
                    }
                }
                .frame(minHeight: 44)
                TextField("Cancellation policy", text: $cancellationPolicy, axis: .vertical)
                    .lineLimit(2 ... 5)
                    .frame(minHeight: 44)
                TextField("Warranty terms", text: $warrantyTerms, axis: .vertical)
                    .lineLimit(2 ... 5)
                    .frame(minHeight: 44)
                Button {
                    Task { await saveTerms() }
                } label: {
                    if isSavingTerms {
                        ProgressView().tint(BrandTheme.accent)
                    } else {
                        Text("Save default terms")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .disabled(isSavingTerms || isUploadingPortfolio)
            } header: {
                Text("Default contract terms").brandSectionHeader()
            } footer: {
                Text("Applied to new awards unless overridden per contract. PRD FR-5.2.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            PhotoPickSection(
                context: .job,
                maxCount: 20,
                photoURLs: $portfolioURLs,
                isUploading: $isUploadingPortfolio,
                errorMessage: $errorMessage
            )
            Section {
                Button {
                    Task { await savePortfolio() }
                } label: {
                    if isSavingPortfolio {
                        ProgressView().tint(BrandTheme.accent)
                    } else {
                        Text("Save portfolio (\(portfolioURLs.count)/20)")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .disabled(isSavingPortfolio || isUploadingPortfolio)
            } header: {
                Text("Portfolio").brandSectionHeader()
            } footer: {
                Text("Up to 20 past-work photos. Saves replace the full portfolio set on the server (PRD FR-5.5).")
                    .foregroundStyle(BrandTheme.textSecondary)
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
        if let timing = p.defaultPaymentTiming?.trimmingCharacters(in: .whitespacesAndNewlines),
           !timing.isEmpty
        {
            paymentTiming = timing.lowercased()
        }
        cancellationPolicy = p.cancellationPolicy ?? ""
        warrantyTerms = p.warrantyTerms ?? ""
        portfolioURLs = (p.portfolio ?? []).compactMap { img in
            let u = (img.imageUrl ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return u.isEmpty ? nil : u
        }
    }

    @MainActor
    private func saveTerms() async {
        errorMessage = nil
        statusMessage = nil
        isSavingTerms = true
        defer { isSavingTerms = false }
        do {
            let updated = try await APIClient.shared.setMyProviderTerms(
                paymentTiming: paymentTiming,
                cancellationPolicy: cancellationPolicy,
                warrantyTerms: warrantyTerms
            )
            profile = updated
            applyProfileToForm(updated)
            statusMessage = "Default terms saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func savePortfolio() async {
        errorMessage = nil
        statusMessage = nil
        isSavingPortfolio = true
        defer { isSavingPortfolio = false }
        let images: [ProviderPortfolioImageUpload] = portfolioURLs.enumerated().map { index, url in
            ProviderPortfolioImageUpload(
                imageUrl: url,
                caption: "",
                sortOrder: Int32(index)
            )
        }
        do {
            let updated = try await APIClient.shared.updateMyProviderPortfolio(images: images)
            profile = updated
            applyProfileToForm(updated)
            statusMessage = "Portfolio saved (\(images.count) image\(images.count == 1 ? "" : "s"))."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
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

        // Always re-send the local schedule: PUT replaces `instant_schedule`
        // and an empty body wipes any previously saved windows server-side.
        let windows: [ProviderAvailabilityWindow]
        do {
            windows = try buildScheduleWindows()
        } catch {
            instantAvailable = previous
            errorMessage = error.localizedDescription
            return
        }

        do {
            // Turning available-now on also enables the instant program flag.
            let enabled = value || (profile?.isInstantEnabled ?? false)
            let response = try await APIClient.shared.setMyProviderAvailability(
                enabled: enabled || value,
                availableNow: value,
                schedule: windows
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
        } catch let error as APIClientError where error.isForbidden {
            instantAvailable = previous
            hasProviderRole = false
            errorMessage = "Provider role required. Enable it in Profile settings."
        } catch {
            instantAvailable = previous
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func saveSchedule() async {
        errorMessage = nil
        statusMessage = nil

        let windows: [ProviderAvailabilityWindow]
        do {
            windows = try buildScheduleWindows()
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        isSavingSchedule = true
        defer { isSavingSchedule = false }

        // Keep current available-now; enable the Instant program when either
        // the provider is live now or they have any weekly windows configured.
        let enabled = instantAvailable
            || !windows.isEmpty
            || (profile?.isInstantEnabled ?? false)

        do {
            let response = try await APIClient.shared.setMyProviderAvailability(
                enabled: enabled,
                availableNow: instantAvailable,
                schedule: windows
            )
            if var p = profile {
                p.instantEnabled = response.instantEnabled ?? enabled
                p.instantAvailable = response.instantAvailable ?? instantAvailable
                profile = p
            }
            instantAvailable = response.instantAvailable ?? instantAvailable
            let dayCount = windows.count
            statusMessage = dayCount == 0
                ? "Weekly schedule cleared."
                : "Weekly schedule saved (\(dayCount) day\(dayCount == 1 ? "" : "s"))."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            errorMessage = "Provider role required. Enable it in Profile settings."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Builds API windows from enabled day rows; validates start < end.
    private func buildScheduleWindows() throws -> [ProviderAvailabilityWindow] {
        var windows: [ProviderAvailabilityWindow] = []
        for day in scheduleDays where day.isEnabled {
            let start = ProviderScheduleDayDraft.formatTime(day.startTime)
            let end = ProviderScheduleDayDraft.formatTime(day.endTime)
            guard start < end else {
                throw ProviderScheduleValidationError.invalidRange(day: day.label)
            }
            windows.append(
                ProviderAvailabilityWindow(day: day.dayCode, startTime: start, endTime: end)
            )
        }
        return windows
    }
}

// MARK: - Weekly schedule draft (local UI state)

/// One weekday row for the Instant schedule editor.
/// Wire codes match proto `AvailabilityWindow.day` (`mon`…`sun`).
struct ProviderScheduleDayDraft: Identifiable, Hashable, Sendable {
    let dayCode: String
    let label: String
    var isEnabled: Bool
    var startTime: Date
    var endTime: Date

    var id: String { dayCode }

    static func blankWeek() -> [ProviderScheduleDayDraft] {
        let defaults = Self.defaultStartEnd()
        return [
            ("mon", "Monday"),
            ("tue", "Tuesday"),
            ("wed", "Wednesday"),
            ("thu", "Thursday"),
            ("fri", "Friday"),
            ("sat", "Saturday"),
            ("sun", "Sunday"),
        ].map { code, label in
            ProviderScheduleDayDraft(
                dayCode: code,
                label: label,
                isEnabled: false,
                startTime: defaults.start,
                endTime: defaults.end
            )
        }
    }

    static func formatTime(_ date: Date) -> String {
        timeFormatter.string(from: date)
    }

    private static func defaultStartEnd() -> (start: Date, end: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let now = Date()
        let start = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: now) ?? now
        let end = calendar.date(bySettingHour: 17, minute: 0, second: 0, of: now) ?? now
        return (start, end)
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        f.timeZone = .current
        return f
    }()
}

private enum ProviderScheduleValidationError: LocalizedError {
    case invalidRange(day: String)

    var errorDescription: String? {
        switch self {
        case .invalidRange(let day):
            return "\(day): end time must be after start time."
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
