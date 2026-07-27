import SwiftUI

/// Native create flow for service reverse-auction jobs (`POST /api/v1/jobs`).
/// Pass `preferInstantMatch: true` from the Home “I need help now” CTA (§13 Instant).
struct PostJobView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// When true, opens with Instant match selected (emergency funnel).
    var preferInstantMatch: Bool = false

    @State private var title = ""
    @State private var description = ""
    @State private var startingBidText = ""
    @State private var locationAddress = ""
    @State private var categoryId = ""
    @State private var categoryName = ""
    /// FR-11 market range band after category select (soft-hide when no data).
    @State private var marketRange: MarketRangeResponse?
    @State private var durationHours = 24
    @State private var publish = true
    /// §13 Instant — after publish, POST `/jobs/{id}/instant-match` (requires accept-now price).
    @State private var useInstantMatch = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var createdJob: JobDetail?
    /// Set when Instant match was requested after create (success / soft-fail messaging).
    @State private var instantMatchStatus: InstantMatchCreateResponse?
    @State private var instantMatchSoftError: String?
    @State private var photoURLs: [String] = []
    @State private var isUploadingPhotos = false
    @State private var properties: [PropertyItem] = []
    @State private var selectedPropertyId = ""
    @State private var offerAcceptedText = ""
    @State private var isRecurring = false
    @State private var recurrenceFrequency = "monthly"

    /// Job service allows 0…168 hours; Instant MVP uses a short 2h window.
    private let durationOptions = [2, 24, 48, 72, 168]
    private let recurrenceOptions = ["weekly", "biweekly", "monthly"]

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to post a reverse-auction job. Providers will compete on price (lower wins).",
                    actionTitle: "Close",
                    action: { dismiss() }
                )
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to post jobs.",
                    secondaryActionTitle: "Open on web",
                    secondaryAction: { openWebPostJob() }
                )
            } else if let createdJob {
                successContent(createdJob)
            } else {
                formContent
            }
        }
        .navigationTitle(useInstantMatch ? "Need help now" : "Post a job")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(BrandTheme.accent)
        .onChange(of: categoryId) { _, newValue in
            Task { await refreshMarketRange(categoryId: newValue) }
        }
        .onChange(of: selectedPropertyId) { _, newId in
            applyPropertySelection(id: newId)
        }
        .onChange(of: useInstantMatch) { _, enabled in
            applyInstantMatchDefaults(enabled: enabled)
        }
        .task {
            if preferInstantMatch {
                useInstantMatch = true
                applyInstantMatchDefaults(enabled: true)
            }
            await loadProperties()
        }
    }

    // MARK: - Form

    private var formContent: some View {
        Form {
            Section {
                Text(
                    useInstantMatch
                        ? "Emergency intake: describe the issue, set an accept-now price, and we’ll notify available Instant providers. First to accept wins at that price."
                        : "Describe the work and set a starting budget. Providers bid down in a reverse auction — fair market rates, not lead-gen markup."
                )
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }

            Section {
                Picker("Matching", selection: $useInstantMatch) {
                    Text("Run an auction").tag(false)
                    Text("I need help now").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(minHeight: 44)
                .accessibilityLabel("How to find a provider")
                .accessibilityHint("Auction lets providers compete on price. Instant match notifies available providers immediately.")

                if useInstantMatch {
                    Text(
                        "Instant jobs use a short window and require an accept-now price. Providers see that price; the first verified provider to accept is awarded."
                    )
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Speed").brandSectionHeader()
            }

            Section {
                TextField("Title", text: $title, prompt: Text("e.g. Fix kitchen sink leak"))
                    .textInputAutocapitalization(.sentences)
                    .autocorrectionDisabled(false)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Job title")

                TextField(
                    "Description",
                    text: $description,
                    prompt: Text("What needs doing, access notes, preferred timing…"),
                    axis: .vertical
                )
                .lineLimit(4 ... 10)
                .foregroundStyle(BrandTheme.textPrimary)
                .frame(minHeight: 88)
                .accessibilityLabel("Job description")

                NavigationLink {
                    CategoryPickerView(selectedId: $categoryId, selectedName: $categoryName)
                } label: {
                    HStack {
                        Text("Category")
                            .foregroundStyle(BrandTheme.textPrimary)
                        Spacer(minLength: 8)
                        Text(categoryName.isEmpty ? "Select…" : categoryName)
                            .foregroundStyle(
                                categoryName.isEmpty ? BrandTheme.textSecondary : BrandTheme.goldBright
                            )
                            .lineLimit(1)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Service category")
                .accessibilityValue(categoryName.isEmpty ? "Not selected" : categoryName)
                .accessibilityHint("Opens the category tree picker")

                // FR-11.2 — market range bar immediately after category (hidden when no data).
                if let marketRange, marketRange.isUsable {
                    MarketRangeBar(
                        range: marketRange,
                        serviceLabel: categoryName.isEmpty ? nil : categoryName,
                        audience: .customer,
                        compact: true
                    )
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                    .accessibilityHint("Fair market price range for the selected category")
                }
            } header: {
                Text("Details").brandSectionHeader()
            } footer: {
                Text("Title, description, and category are required. Title max 200 characters.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                DollarAmountField(
                    text: $startingBidText,
                    placeholder: "100.00",
                    accessibilityLabelText: useInstantMatch
                        ? "Starting budget in dollars — upper bound for Instant pricing"
                        : "Starting bid in dollars — reverse auction, providers bid lower"
                )

                if !useInstantMatch {
                    Picker("Auction length", selection: $durationHours) {
                        ForEach(durationOptions.filter { $0 != 2 }, id: \.self) { hours in
                            Text(durationLabel(hours)).tag(hours)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Auction duration")

                    Toggle("Publish immediately", isOn: $publish)
                        .frame(minHeight: 44)
                        .tint(BrandTheme.accent)
                } else {
                    LabeledContent("Window") {
                        Text(durationLabel(durationHours))
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Instant match window \(durationLabel(durationHours))")
                }

                DollarAmountField(
                    text: $offerAcceptedText,
                    placeholder: useInstantMatch ? "Required accept-now price" : "Optional",
                    accessibilityLabelText: useInstantMatch
                        ? "Accept-now price in dollars — required for Instant match"
                        : "Offer accepted price in dollars — optional"
                )

                if !useInstantMatch {
                    Toggle("Recurring job", isOn: $isRecurring)
                        .frame(minHeight: 44)
                        .tint(BrandTheme.accent)

                    if isRecurring {
                        Picker("Frequency", selection: $recurrenceFrequency) {
                            ForEach(recurrenceOptions, id: \.self) { freq in
                                Text(freq.capitalized).tag(freq)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                }
            } header: {
                Text(useInstantMatch ? "Instant price" : "Auction").brandSectionHeader()
            } footer: {
                Text(
                    useInstantMatch
                        ? "Accept-now price is what providers are awarded if they accept. Keep it at or below your starting budget. Instant match cannot run without it."
                        : "Starting bid is the maximum you’re willing to open at. Providers compete by bidding lower. Optional offer-accepted price lets providers lock that amount without auto-award."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                if !properties.isEmpty {
                    Picker("Property", selection: $selectedPropertyId) {
                        Text("None").tag("")
                        ForEach(properties) { prop in
                            Text(prop.displayName).tag(prop.id)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Property for this job")
                    .accessibilityHint("Optional. Links the job to a saved property address.")
                }

                if selectedPropertyId.isEmpty {
                    TextField(
                        "Service address (optional)",
                        text: $locationAddress,
                        prompt: Text("Street, city, or neighborhood")
                    )
                    .textContentType(.fullStreetAddress)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Optional service address")
                } else if let selected = selectedProperty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(selected.displayName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        ForEach(selected.addressLines, id: \.self) { line in
                            Text(line)
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Selected property \(selected.displayName)")
                }
            } header: {
                Text("Location").brandSectionHeader()
            } footer: {
                Text(
                    properties.isEmpty
                        ? "Address is optional. Add properties under Account → Properties to reuse site addresses."
                        : "Choose a saved property or leave None and type an optional address. Exact address is only revealed to the awarded provider after award."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }

            PhotoPickSection(
                context: .job,
                maxCount: ImageUploader.maxPhotosPerForm,
                photoURLs: $photoURLs,
                isUploading: $isUploadingPhotos,
                errorMessage: $errorMessage
            )

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
                    Task { await submit() }
                } label: {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(submitButtonTitle)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canSubmit || isSubmitting)
                .accessibilityHint(
                    useInstantMatch
                        ? "Creates the job and requests Instant match from available providers"
                        : "Creates the reverse-auction job on the server"
                )

                Button {
                    openWebPostJob()
                } label: {
                    Text("Open full form on web")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
            }
        }
        .brandListBackground()
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Success

    @ViewBuilder
    private func successContent(_ job: JobDetail) -> some View {
        VStack(spacing: 20) {
            Image(systemName: useInstantMatch ? "bolt.badge.checkmark.fill" : "checkmark.seal.fill")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(BrandTheme.success)
                .accessibilityHidden(true)

            Text(successHeadline)
                .font(.title3.weight(.semibold))
                .foregroundStyle(BrandTheme.textPrimary)

            Text(successDetail(for: job))
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            if let soft = instantMatchSoftError, !soft.isEmpty {
                Text(soft)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.warning)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let expires = instantMatchStatus?.expiresAt,
               let label = CatalogDateFormat.countdownLabel(iso: expires)
            {
                Text(label.replacingOccurrences(of: "Ends", with: "Offer"))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }

            NavigationLink {
                JobDetailView(jobID: job.id, preview: nil)
            } label: {
                Text("View job")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)

            Button("Done") { dismiss() }
                .brandGhostButton()
        }
        .padding(28)
        .brandCard(padding: 24)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .brandScreenBackground()
    }

    private var successHeadline: String {
        if useInstantMatch {
            if instantMatchStatus != nil {
                return "Instant match sent"
            }
            return "Job posted"
        }
        return publish ? "Job posted" : "Draft saved"
    }

    private func successDetail(for job: JobDetail) -> String {
        if useInstantMatch {
            if instantMatchStatus != nil {
                return "“\(job.displayTitle)” is live. Available Instant providers can accept at your accept-now price. You’ll be notified when someone claims it."
            }
            return "“\(job.displayTitle)” was created as a reverse auction. Instant match could not be started — open the job or try again from web."
        }
        return "“\(job.displayTitle)” is ready as a reverse auction. Providers can bid down from your starting budget."
    }

    private var submitButtonTitle: String {
        if useInstantMatch {
            return "Request Instant match"
        }
        return publish ? "Post job" : "Save draft"
    }

    // MARK: - Validation / submit

    private var canSubmit: Bool {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let c = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasOfferIfInstant: Bool = {
            guard useInstantMatch else { return true }
            return MoneyFormat.cents(fromDollarsText: offerAcceptedText) != nil
        }()
        return !t.isEmpty
            && t.count <= 200
            && !d.isEmpty
            && d.count <= 5000
            && !c.isEmpty
            && MoneyFormat.cents(fromDollarsText: startingBidText) != nil
            && hasOfferIfInstant
            && !isSubmitting
            && !isUploadingPhotos
    }

    private func durationLabel(_ hours: Int) -> String {
        if hours >= 168 {
            return "7 days"
        }
        if hours == 2 {
            return "2 hours"
        }
        if hours == 24 {
            return "24 hours"
        }
        return "\(hours) hours"
    }

    private func applyInstantMatchDefaults(enabled: Bool) {
        if enabled {
            // MVP Instant: short live window + always publish (cannot match a draft).
            durationHours = 2
            publish = true
            isRecurring = false
        } else if durationHours == 2 {
            durationHours = 24
        }
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        instantMatchStatus = nil
        instantMatchSoftError = nil

        guard !auth.isScaffoldSession else {
            errorMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to post jobs."
            return
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            errorMessage = "Enter a title for the job."
            return
        }
        guard trimmedTitle.count <= 200 else {
            errorMessage = "Title must be at most 200 characters."
            return
        }
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDescription.isEmpty else {
            errorMessage = "Enter a description of the work."
            return
        }
        guard trimmedDescription.count <= 5000 else {
            errorMessage = "Description must be at most 5000 characters."
            return
        }
        let trimmedCategory = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCategory.isEmpty else {
            errorMessage = "Choose a service category."
            return
        }
        guard let cents = MoneyFormat.cents(fromDollarsText: startingBidText) else {
            errorMessage = "Enter a valid starting bid in dollars (for example 100.00)."
            return
        }
        var offerCents: Int64?
        let offerTrimmed = offerAcceptedText.trimmingCharacters(in: .whitespacesAndNewlines)
        if useInstantMatch {
            // Server requires offer_accepted_cents before CreateInstantMatch.
            guard !offerTrimmed.isEmpty,
                  let oc = MoneyFormat.cents(fromDollarsText: offerAcceptedText)
            else {
                errorMessage = "Enter an accept-now price for Instant match (for example 250.00)."
                return
            }
            if let err = BidAmountRules.validateOfferAccepted(startingCents: cents, offerCents: oc) {
                errorMessage = err
                return
            }
            offerCents = oc
        } else if !offerTrimmed.isEmpty {
            guard let oc = MoneyFormat.cents(fromDollarsText: offerAcceptedText) else {
                errorMessage = "Enter a valid offer-accepted amount in dollars, or leave it blank."
                return
            }
            if let err = BidAmountRules.validateOfferAccepted(startingCents: cents, offerCents: oc) {
                errorMessage = err
                return
            }
            offerCents = oc
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let propertyId = selectedPropertyId.trimmingCharacters(in: .whitespacesAndNewlines)
        // When a property is linked, server copies its address; skip freeform override.
        let freeformAddress: String? = propertyId.isEmpty
            ? (locationAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : locationAddress.trimmingCharacters(in: .whitespacesAndNewlines))
            : nil

        // Instant always publishes — matching a draft is invalid.
        let shouldPublish = useInstantMatch ? true : publish
        let auctionHours = useInstantMatch ? min(max(durationHours, 2), 2) : durationHours

        do {
            let job = try await APIClient.shared.createJob(
                title: trimmedTitle,
                description: trimmedDescription,
                categoryId: trimmedCategory,
                auctionDurationHours: auctionHours,
                startingBidCents: cents,
                locationAddress: freeformAddress,
                locationLat: nil,
                locationLng: nil,
                publish: shouldPublish,
                scheduleType: "flexible",
                photoUrls: photoURLs,
                propertyId: propertyId.isEmpty ? nil : propertyId,
                offerAcceptedCents: offerCents,
                isRecurring: useInstantMatch ? false : isRecurring,
                recurrenceFrequency: (!useInstantMatch && isRecurring) ? recurrenceFrequency : nil
            )

            if useInstantMatch {
                do {
                    instantMatchStatus = try await APIClient.shared.createInstantMatch(jobId: job.id)
                } catch let error as APIClientError {
                    // Non-fatal — job exists; Instant fan-out failed (matches web JobPostingForm).
                    instantMatchSoftError =
                        "Job created, but Instant match failed: \(error.localizedDescription)"
                } catch {
                    instantMatchSoftError =
                        "Job created, but Instant match failed: \(error.localizedDescription)"
                }
            }

            createdJob = job
        } catch let error as APIClientError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var selectedProperty: PropertyItem? {
        let id = selectedPropertyId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return nil }
        return properties.first { $0.id == id }
    }

    @MainActor
    private func loadProperties() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        do {
            properties = try await APIClient.shared.fetchProperties().properties
            // Default to primary property when present (still optional — user can pick None).
            if selectedPropertyId.isEmpty,
               let primary = properties.first(where: { $0.isPrimary == true })
            {
                selectedPropertyId = primary.id
            }
        } catch {
            properties = []
        }
    }

    private func applyPropertySelection(id: String) {
        // Clear freeform when linking a property so we don't send conflicting location text.
        if !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            locationAddress = ""
        }
    }

    /// FR-11: load market/range, fall back to fair-price (p25/p50/p75). Soft-hide on miss.
    @MainActor
    private func refreshMarketRange(categoryId: String) async {
        let trimmed = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            marketRange = nil
            return
        }
        // (a) Analytics market/range — primary FR-11 source.
        let range = await APIClient.shared.fetchMarketRange(categoryId: trimmed)
        if range.isUsable {
            marketRange = range
            return
        }
        // (b) Fair-price engine (p25 / price / p75 / n_eff) mapped into the same bar shape.
        do {
            let price = try await APIClient.shared.fetchFairPrice(categoryId: trimmed, side: 1)
            marketRange = MarketRangeMath.marketRangeResponse(from: price)
        } catch {
            marketRange = nil
        }
    }

    private func openWebPostJob() {
        openURL(AppConfig.postJobURL)
    }
}

#Preview {
    NavigationStack {
        PostJobView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
