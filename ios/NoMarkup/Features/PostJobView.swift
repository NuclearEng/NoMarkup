import SwiftUI

/// Native create flow for service reverse-auction jobs (`POST /api/v1/jobs`).
/// Pass `preferInstantMatch: true` from the Home “I need help now” CTA (§13 Instant).
struct PostJobView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// When true, opens with Instant match selected (emergency funnel).
    var preferInstantMatch: Bool = false
    /// FR-18.7 residual: prefill recurring when customer reposts remaining visits.
    var prefillRecurring: Bool = false
    var prefillFrequency: String? = nil
    var prefillTitle: String? = nil
    /// FR-18.7 deepen: optional property / category / starting bid from cancelled schedule's job.
    var prefillPropertyId: String? = nil
    var prefillCategoryId: String? = nil
    var prefillCategoryName: String? = nil
    var prefillStartingBidCents: Int64? = nil

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
    /// FR-3.1 schedule preference (wire: flexible | specific_date | date_range).
    @State private var scheduleType = "flexible"
    @State private var preferredDate = Date().addingTimeInterval(86_400)
    @State private var rangeStart = Date().addingTimeInterval(86_400)
    @State private var rangeEnd = Date().addingTimeInterval(86_400 * 3)

    /// Multi-step wizard (unicorn funnel) — keeps one Form surface, progressive disclosure.
    private enum WizardStep: Int, CaseIterable, Identifiable {
        case basics = 0
        case pricing = 1
        case location = 2
        case review = 3
        var id: Int { rawValue }

        var title: String {
            switch self {
            case .basics: return "Basics"
            case .pricing: return "Pricing"
            case .location: return "Location"
            case .review: return "Review"
            }
        }

        static var labels: [String] { allCases.map(\.title) }
    }

    @State private var wizardStep: WizardStep = .basics

    /// Job service allows 0…168 hours; Instant MVP uses a short 2h window.
    private let durationOptions = [2, 12, 24, 48, 72, 168]
    private let recurrenceOptions = ["weekly", "biweekly", "monthly"]
    private let scheduleTypeOptions: [(id: String, label: String)] = [
        ("flexible", "Flexible"),
        ("specific_date", "Specific date"),
        ("date_range", "Date range"),
    ]

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
        .brandNavigationBarChrome()
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
            // FR-18.7: customer repost remaining schedule after recurring cancel.
            if prefillRecurring {
                isRecurring = true
                let freq = (prefillFrequency ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if recurrenceOptions.contains(freq) {
                    recurrenceFrequency = freq
                }
            }
            if let t = prefillTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
                title = String(t.prefix(200))
            }
            if prefillRecurring, description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                description =
                    "Repost of remaining visits after a cancelled recurring schedule. Update details and schedule as needed."
            }
            if let cat = prefillCategoryId?.trimmingCharacters(in: .whitespacesAndNewlines), !cat.isEmpty {
                categoryId = cat
                if let name = prefillCategoryName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
                    categoryName = name
                }
            }
            if let bid = prefillStartingBidCents, bid > 0 {
                // Dollar text for DollarAmountField (no trailing zeros on whole dollars).
                let dollars = Decimal(bid) / 100
                var rounded = Decimal()
                var tmp = dollars
                NSDecimalRound(&rounded, &tmp, 2, .plain)
                startingBidText = NSDecimalNumber(decimal: rounded).stringValue
            }
            await loadProperties()
            // Apply property after properties load so picker selection sticks.
            if let prop = prefillPropertyId?.trimmingCharacters(in: .whitespacesAndNewlines), !prop.isEmpty {
                if properties.contains(where: { $0.id == prop }) {
                    selectedPropertyId = prop
                    applyPropertySelection(id: prop)
                }
            }
        }
    }

    // MARK: - Form (4-step wizard)

    private var formContent: some View {
        VStack(spacing: 0) {
            BrandWizardStepChrome(steps: WizardStep.labels, currentIndex: wizardStep.rawValue)
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 6)
                .background(BrandTheme.navy)
                .accessibilityIdentifier("postJob.wizardChrome")

            Form {
                switch wizardStep {
                case .basics:
                    basicsStepSections
                case .pricing:
                    pricingStepSections
                case .location:
                    locationStepSections
                case .review:
                    reviewStepSections
                }

                if let errorMessage {
                    Section {
                        Label {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(BrandTheme.destructive)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(BrandTheme.destructive)
                                .accessibilityHidden(true)
                        }
                        .accessibilityElement(children: .combine)
                    } header: {
                        Text("Fix to continue").brandSectionHeader()
                    }
                }
            }
            .brandListBackground()
            .scrollDismissesKeyboard(.interactively)
        }
        .background(BrandTheme.navy.ignoresSafeArea())
        // Pin Continue / Submit above the iOS 26 floating tab capsule (SIM-UI 2026-08-22).
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                wizardNavigationButtons
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 112)
            .frame(maxWidth: .infinity)
            .background(BrandTheme.navy)
        }
    }

    // MARK: Step 1 — Basics

    @ViewBuilder
    private var basicsStepSections: some View {
        Section {
            Text(
                useInstantMatch
                    ? "Emergency intake: describe the issue, set an accept-now price on the next step, and we’ll notify available Instant providers. First to accept wins — no middleman markup."
                    : "Describe the work. Providers will compete by bidding down in a reverse auction. The market sets the price — not the markup."
            )
            .font(.subheadline)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        } header: {
            Text("How it works").brandSectionHeader()
        }

        Section {
            Picker("Matching", selection: $useInstantMatch) {
                Text("Run an auction").tag(false)
                Text("I need help now").tag(true)
            }
            .pickerStyle(.segmented)
            .frame(minHeight: 44)
            .accessibilityIdentifier("postJob.matching")
            .accessibilityLabel("How to find a provider")
            .accessibilityHint("Auction lets providers compete on price. Instant match notifies available providers immediately.")

            if useInstantMatch {
                Text(
                    "Instant jobs use a short window and require an accept-now price. Providers see that price; the first verified provider to accept is awarded."
                )
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                Text(
                    "Honest pricing: Instant often lands around 1.5–2× a typical reverse-auction result for similar work. Set an accept-now price you’re willing to pay for immediate help — not a hard formula, a common range."
                )
                .font(.caption)
                .foregroundStyle(BrandTheme.goldBright)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Instant premium pricing transparency")
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
                .accessibilityIdentifier("postJob.title")
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
            .accessibilityIdentifier("postJob.description")
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
            .accessibilityIdentifier("postJob.category")
            .accessibilityLabel("Service category")
            .accessibilityValue(categoryName.isEmpty ? "Not selected" : categoryName)
            .accessibilityHint("Opens the category tree picker")

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
    }

    // MARK: Step 2 — Pricing

    @ViewBuilder
    private var pricingStepSections: some View {
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

                Picker("Schedule", selection: $scheduleType) {
                    ForEach(scheduleTypeOptions, id: \.id) { opt in
                        Text(opt.label).tag(opt.id)
                    }
                }
                .frame(minHeight: 44)
                .accessibilityLabel("Preferred schedule type")
                .accessibilityHint("Flexible, a specific date, or a date range for the work")

                if scheduleType == "specific_date" {
                    DatePicker(
                        "Preferred date",
                        selection: $preferredDate,
                        in: Date()...,
                        displayedComponents: [.date]
                    )
                    .frame(minHeight: 44)
                    .accessibilityLabel("Preferred service date")
                } else if scheduleType == "date_range" {
                    DatePicker(
                        "Earliest",
                        selection: $rangeStart,
                        in: Date()...,
                        displayedComponents: [.date]
                    )
                    .frame(minHeight: 44)
                    DatePicker(
                        "Latest",
                        selection: $rangeEnd,
                        in: rangeStart...,
                        displayedComponents: [.date]
                    )
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
    }

    // MARK: Step 3 — Location + photos

    @ViewBuilder
    private var locationStepSections: some View {
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
    }

    // MARK: Step 4 — Review

    @ViewBuilder
    private var reviewStepSections: some View {
        Section {
            reviewRow(label: "Mode", value: useInstantMatch ? "Instant match" : "Reverse auction")
            reviewRow(label: "Title", value: title.trimmingCharacters(in: .whitespacesAndNewlines))
            reviewRow(
                label: "Category",
                value: categoryName.isEmpty ? "—" : categoryName
            )
            if let cents = MoneyFormat.cents(fromDollarsText: startingBidText) {
                HStack {
                    Text("Starting budget")
                        .foregroundStyle(BrandTheme.textSecondary)
                    Spacer()
                    Text(MoneyFormat.usd(cents: cents))
                        .font(.body.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                .frame(minHeight: 44)
            }
            if useInstantMatch, let oc = MoneyFormat.cents(fromDollarsText: offerAcceptedText) {
                HStack {
                    Text("Accept-now")
                        .foregroundStyle(BrandTheme.textSecondary)
                    Spacer()
                    Text(MoneyFormat.usd(cents: oc))
                        .font(.body.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.success)
                }
                .frame(minHeight: 44)
            }
            if !useInstantMatch {
                reviewRow(label: "Duration", value: durationLabel(durationHours))
                reviewRow(label: "Publish", value: publish ? "Immediately" : "Save as draft")
            }
            if !locationAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                reviewRow(label: "Address", value: locationAddress)
            } else if let selected = selectedProperty {
                reviewRow(label: "Property", value: selected.displayName)
            }
            if !photoURLs.isEmpty {
                reviewRow(label: "Photos", value: "\(photoURLs.count) attached")
            }
        } header: {
            Text("Review").brandSectionHeader()
        } footer: {
            Text(
                useInstantMatch
                    ? "Confirm your accept-now price. Available Instant providers will be notified."
                    : "Providers will bid down from your starting budget. The market sets the price."
            )
            .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private func reviewRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer(minLength: 12)
            Text(value.isEmpty ? "—" : value)
                .foregroundStyle(BrandTheme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    // MARK: Wizard nav

    @ViewBuilder
    private var wizardNavigationButtons: some View {
        if wizardStep != .basics {
            Button {
                BrandHaptics.selection()
                errorMessage = nil
                withAnimation(.easeOut(duration: 0.2)) {
                    wizardStep = WizardStep(rawValue: max(0, wizardStep.rawValue - 1)) ?? .basics
                }
            } label: {
                Text("Back")
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .brandGhostButton()
            .disabled(isSubmitting)
            .accessibilityIdentifier("postJob.back")
        }

        if wizardStep != .review {
            Button {
                advanceWizard()
            } label: {
                Text("Continue")
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .brandPrimaryButton()
            .disabled(isUploadingPhotos)
            .accessibilityIdentifier("postJob.continue")
            .accessibilityHint("Validates this step and continues")
        } else {
            Button {
                BrandHaptics.medium()
                Task { await submit() }
            } label: {
                HStack(spacing: 10) {
                    if isSubmitting {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .accessibilityLabel("Posting…")
                    }
                    Text(isSubmitting ? "Posting…" : submitButtonTitle)
                        .frame(maxWidth: .infinity)
                }
                .frame(minHeight: 48)
            }
            .glassProminentBrandCTA()
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .disabled(!canSubmit || isSubmitting)
            .accessibilityIdentifier("postJob.submit")
            .accessibilityHint(
                useInstantMatch
                    ? "Creates the job and requests Instant match from available providers"
                    : "Creates the reverse-auction job on the server"
            )
        }

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

    private func advanceWizard() {
        errorMessage = nil
        if let message = validationMessage(for: wizardStep) {
            BrandHaptics.warning()
            errorMessage = message
            return
        }
        BrandHaptics.selection()
        let next = min(WizardStep.allCases.count - 1, wizardStep.rawValue + 1)
        withAnimation(.easeOut(duration: 0.2)) {
            wizardStep = WizardStep(rawValue: next) ?? .review
        }
    }

    /// Per-step gates before Continue (final submit still re-validates fully).
    private func validationMessage(for step: WizardStep) -> String? {
        switch step {
        case .basics:
            let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
            let c = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return "Enter a title for the job." }
            if t.count > 200 { return "Title must be at most 200 characters." }
            if d.isEmpty { return "Enter a description of the work." }
            if d.count > 5000 { return "Description must be at most 5000 characters." }
            if c.isEmpty { return "Choose a service category." }
            return nil
        case .pricing:
            guard MoneyFormat.cents(fromDollarsText: startingBidText) != nil else {
                return "Enter a valid starting bid in dollars (for example 100.00)."
            }
            if useInstantMatch {
                guard MoneyFormat.cents(fromDollarsText: offerAcceptedText) != nil else {
                    return "Enter an accept-now price for Instant match (for example 250.00)."
                }
            }
            return nil
        case .location:
            if isUploadingPhotos { return "Wait for photo uploads to finish." }
            return nil
        case .review:
            return nil
        }
    }

    // MARK: - Success

    @ViewBuilder
    private func successContent(_ job: JobDetail) -> some View {
        VStack(spacing: 20) {
            Image(systemName: useInstantMatch ? "bolt.badge.checkmark.fill" : "checkmark.seal.fill")
                .font(.largeTitle.weight(.medium))
                .foregroundStyle(BrandTheme.success)
                .accessibilityHidden(true)

            Text(successHeadline)
                .font(.title3.weight(.semibold))
                .foregroundStyle(BrandTheme.textPrimary)
                .multilineTextAlignment(.center)

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
            .glassProminentBrandCTA()
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .accessibilityHint("Opens the job you just posted")

            Button("Done") { dismiss() }
                .brandGhostButton()
        }
        .padding(28)
        .brandCard(padding: 24)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .brandScreenBackground()
        .accessibilityElement(children: .contain)
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
        if publish {
            return "“\(job.displayTitle)” is live. Providers will bid down from your starting budget — the market sets the price, not a middleman."
        }
        return "“\(job.displayTitle)” is saved as a draft. Publish when you’re ready for providers to compete on price."
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
            BrandHaptics.error()
            errorMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to post jobs."
            return
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Enter a title for the job."
            return
        }
        guard trimmedTitle.count <= 200 else {
            BrandHaptics.warning()
            errorMessage = "Title must be at most 200 characters."
            return
        }
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDescription.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Enter a description of the work."
            return
        }
        guard trimmedDescription.count <= 5000 else {
            BrandHaptics.warning()
            errorMessage = "Description must be at most 5000 characters."
            return
        }
        let trimmedCategory = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCategory.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Choose a service category."
            return
        }
        guard let cents = MoneyFormat.cents(fromDollarsText: startingBidText) else {
            BrandHaptics.warning()
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
                BrandHaptics.warning()
                errorMessage = "Enter an accept-now price for Instant match (for example 250.00)."
                return
            }
            if let err = BidAmountRules.validateOfferAccepted(startingCents: cents, offerCents: oc) {
                BrandHaptics.warning()
                errorMessage = err
                return
            }
            offerCents = oc
        } else if !offerTrimmed.isEmpty {
            guard let oc = MoneyFormat.cents(fromDollarsText: offerAcceptedText) else {
                BrandHaptics.warning()
                errorMessage = "Enter a valid offer-accepted amount in dollars, or leave it blank."
                return
            }
            if let err = BidAmountRules.validateOfferAccepted(startingCents: cents, offerCents: oc) {
                BrandHaptics.warning()
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
            let wireSchedule = useInstantMatch ? "flexible" : scheduleType
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
                scheduleType: wireSchedule,
                scheduledDate: (!useInstantMatch && scheduleType == "specific_date")
                    ? preferredDate : nil,
                scheduleRangeStart: (!useInstantMatch && scheduleType == "date_range")
                    ? rangeStart : nil,
                scheduleRangeEnd: (!useInstantMatch && scheduleType == "date_range")
                    ? rangeEnd : nil,
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

            // Primary create succeeded — success haptic even if Instant soft-failed (warning below).
            if instantMatchSoftError != nil {
                BrandHaptics.warning()
            } else {
                BrandHaptics.success()
            }
            createdJob = job
        } catch let error as APIClientError {
            BrandHaptics.error()
            errorMessage = error.localizedDescription
        } catch {
            BrandHaptics.error()
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
