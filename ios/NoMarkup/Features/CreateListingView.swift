import SwiftUI

/// Native create flow for goods marketplace listings (`POST /api/v1/listings`).
/// Multi-step wizard mirrors `PostJobView` + `BrandWizardStepChrome`.
struct CreateListingView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var title = ""
    @State private var description = ""
    @State private var startingPriceText = ""
    @State private var buyNowText = ""
    @State private var pickupZip = ""
    @State private var categoryId = ""
    @State private var categoryName = ""
    @State private var fairPriceHint: String?
    @State private var condition: ListingConditionOption = .good
    @State private var durationHours = 48
    @State private var publish = true
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var createdListing: ListingDetail?
    @State private var photoURLs: [String] = []
    @State private var isUploadingPhotos = false

    /// Multi-step wizard — progressive disclosure (unicorn funnel parity with PostJob).
    private enum WizardStep: Int, CaseIterable, Identifiable {
        case basics = 0
        case pricing = 1
        case photos = 2
        case review = 3
        var id: Int { rawValue }

        var title: String {
            switch self {
            case .basics: return "Basics"
            case .pricing: return "Pricing"
            case .photos: return "Photos"
            case .review: return "Review"
            }
        }

        static var labels: [String] { allCases.map(\.title) }
    }

    @State private var wizardStep: WizardStep = .basics

    /// Gateway CHECK: 24h, 48h, or 7d only.
    private let durationOptions = [24, 48, 168]

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to list a local goods item. Buyers bid up; pickup within 25 mi.",
                    actionTitle: "Close",
                    action: { dismiss() }
                )
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to sell items.",
                    secondaryActionTitle: "Open on web",
                    secondaryAction: { openWebSell() }
                )
            } else if let createdListing {
                successContent(createdListing)
            } else {
                formContent
            }
        }
        .navigationTitle("Sell an item")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .tint(BrandTheme.accent)
        .onChange(of: categoryId) { _, newValue in
            Task { await refreshFairPriceHint(categoryId: newValue) }
        }
        .onChange(of: pickupZip) { _, _ in
            Task { await refreshFairPriceHint(categoryId: categoryId) }
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
                .accessibilityIdentifier("createListing.wizardChrome")

            Form {
                switch wizardStep {
                case .basics:
                    basicsStepSections
                case .pricing:
                    pricingStepSections
                case .photos:
                    photosStepSections
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

                Section {
                    wizardNavigationButtons
                }
            }
            .brandListBackground()
            .scrollDismissesKeyboard(.interactively)
        }
        .background(BrandTheme.navy.ignoresSafeArea())
    }

    // MARK: Step 1 — Basics

    @ViewBuilder
    private var basicsStepSections: some View {
        Section {
            Text(
                "Local pickup only (≈25 mi). Buyers bid up in a forward auction. Escrow holds payment until pickup — no platform markup on the winning bid."
            )
            .font(.subheadline)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        } header: {
            Text("How it works").brandSectionHeader()
        }

        Section {
            TextField("Title", text: $title, prompt: Text("e.g. Mid-century oak dresser"))
                .textInputAutocapitalization(.sentences)
                .foregroundStyle(BrandTheme.textPrimary)
                .frame(minHeight: 44)
                .accessibilityIdentifier("createListing.title")
                .accessibilityLabel("Listing title")

            TextField(
                "Description",
                text: $description,
                prompt: Text("Condition details, dimensions, pickup notes…"),
                axis: .vertical
            )
            .lineLimit(4 ... 12)
            .foregroundStyle(BrandTheme.textPrimary)
            .frame(minHeight: 88)
            .accessibilityIdentifier("createListing.description")
            .accessibilityLabel("Listing description")
        } header: {
            Text("Item").brandSectionHeader()
        } footer: {
            Text("Title max 120 characters · description max 5000.")
                .foregroundStyle(BrandTheme.textSecondary)
        }

        Section {
            Picker("Condition", selection: $condition) {
                ForEach(ListingConditionOption.allCases) { option in
                    Text(option.displayName).tag(option)
                }
            }
            .frame(minHeight: 44)
            .accessibilityIdentifier("createListing.condition")

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
            .accessibilityIdentifier("createListing.category")
            .accessibilityLabel("Listing category")
            .accessibilityValue(categoryName.isEmpty ? "Not selected" : categoryName)
            .accessibilityHint("Opens the category tree picker")
        } header: {
            Text("Classification").brandSectionHeader()
        } footer: {
            Text("Pick a real category from the taxonomy tree so buyers can find the item.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    // MARK: Step 2 — Pricing

    @ViewBuilder
    private var pricingStepSections: some View {
        Section {
            DollarAmountField(
                text: $startingPriceText,
                placeholder: "50.00",
                accessibilityLabelText: "Starting price in dollars — forward auction floor"
            )

            DollarAmountField(
                text: $buyNowText,
                placeholder: "Optional buy now",
                accessibilityLabelText: "Optional buy now price in dollars"
            )

            TextField("Pickup ZIP", text: $pickupZip, prompt: Text("98101"))
                .keyboardType(.numberPad)
                .textContentType(.postalCode)
                .foregroundStyle(BrandTheme.textPrimary)
                .frame(minHeight: 44)
                .accessibilityIdentifier("createListing.pickupZip")
                .accessibilityLabel("Pickup ZIP code")
                .accessibilityHint("Required so buyers can search by distance. Must be a ZIP we cover to publish.")

            Picker("Auction length", selection: $durationHours) {
                ForEach(durationOptions, id: \.self) { hours in
                    Text(durationLabel(hours)).tag(hours)
                }
            }
            .frame(minHeight: 44)
            .accessibilityLabel("Auction duration")

            Toggle("Publish immediately", isOn: $publish)
                .frame(minHeight: 44)
                .tint(BrandTheme.accent)
                .accessibilityIdentifier("createListing.publish")
        } header: {
            Text("Price & pickup").brandSectionHeader()
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text(
                    "Starting price is the bid floor — buyers bid up. Duration must be 24 hours, 48 hours, or 7 days. A valid covered ZIP is required to publish so the listing appears in local radius search."
                )
                if let fairPriceHint {
                    Text(fairPriceHint)
                        .foregroundStyle(BrandTheme.goldBright)
                }
            }
            .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    // MARK: Step 3 — Photos

    @ViewBuilder
    private var photosStepSections: some View {
        Section {
            Text(
                "Clear photos sell faster. First image is the cover — show condition, scale, and any wear honestly."
            )
            .font(.subheadline)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        } header: {
            Text("Photos").brandSectionHeader()
        }

        PhotoPickSection(
            context: .listing,
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
            reviewRow(label: "Title", value: title.trimmingCharacters(in: .whitespacesAndNewlines))
            reviewRow(
                label: "Description",
                value: description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "—"
                    : String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
                        + (description.count > 120 ? "…" : "")
            )
            reviewRow(label: "Condition", value: condition.displayName)
            reviewRow(label: "Category", value: categoryName.isEmpty ? "—" : categoryName)
            if let cents = MoneyFormat.cents(fromDollarsText: startingPriceText) {
                HStack {
                    Text("Starting price")
                        .foregroundStyle(BrandTheme.textSecondary)
                    Spacer()
                    Text(MoneyFormat.usd(cents: cents))
                        .font(.body.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                .frame(minHeight: 44)
            }
            if let buy = MoneyFormat.cents(fromDollarsText: buyNowText), buy > 0 {
                HStack {
                    Text("Buy now")
                        .foregroundStyle(BrandTheme.textSecondary)
                    Spacer()
                    Text(MoneyFormat.usd(cents: buy))
                        .font(.body.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.success)
                }
                .frame(minHeight: 44)
            }
            reviewRow(label: "Pickup ZIP", value: pickupZip.trimmingCharacters(in: .whitespacesAndNewlines))
            reviewRow(label: "Duration", value: durationLabel(durationHours))
            reviewRow(label: "Publish", value: publish ? "Immediately" : "Save as draft")
            if !photoURLs.isEmpty {
                reviewRow(label: "Photos", value: "\(photoURLs.count) attached")
            } else {
                reviewRow(label: "Photos", value: "None")
            }
        } header: {
            Text("Review").brandSectionHeader()
        } footer: {
            Text(
                "Buyers bid up from your start price. Escrow holds payment until local pickup — no platform markup on the winning bid."
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
            .accessibilityIdentifier("createListing.back")
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
            .accessibilityIdentifier("createListing.continue")
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
                            .accessibilityLabel("Listing…")
                    }
                    Text(isSubmitting ? "Listing…" : (publish ? "List item" : "Save draft"))
                        .frame(maxWidth: .infinity)
                }
                .frame(minHeight: 48)
            }
            .glassProminentBrandCTA()
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .disabled(!canSubmit || isSubmitting)
            .accessibilityIdentifier("createListing.submit")
            .accessibilityHint("Creates the goods listing on the server")
        }

        Button {
            openWebSell()
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
            let cat = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return "Enter a title for the listing." }
            if t.count > 120 { return "Title must be at most 120 characters." }
            if description.count > 5000 { return "Description must be at most 5000 characters." }
            if cat.isEmpty { return "Choose a category from the taxonomy." }
            return nil
        case .pricing:
            guard MoneyFormat.cents(fromDollarsText: startingPriceText) != nil else {
                return "Enter a valid starting price in dollars (for example 50.00)."
            }
            let buyNowTrimmed = buyNowText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !buyNowTrimmed.isEmpty {
                guard let buy = MoneyFormat.cents(fromDollarsText: buyNowTrimmed) else {
                    return "Buy now must be a valid dollar amount, or left blank."
                }
                if let start = MoneyFormat.cents(fromDollarsText: startingPriceText), buy < start {
                    return "Buy now must be at least the starting price."
                }
            }
            let zip = pickupZip.trimmingCharacters(in: .whitespacesAndNewlines)
            if zip.isEmpty { return "Enter a pickup ZIP code." }
            if !durationOptions.contains(durationHours) {
                return "Auction duration must be 24, 48, or 168 hours."
            }
            return nil
        case .photos:
            if isUploadingPhotos { return "Wait for photo uploads to finish." }
            return nil
        case .review:
            return nil
        }
    }

    // MARK: - Success

    @ViewBuilder
    private func successContent(_ listing: ListingDetail) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.seal.fill")
                .font(.largeTitle.weight(.medium))
                .foregroundStyle(BrandTheme.success)
                .accessibilityHidden(true)

            Text(publish ? "Listing live" : "Draft saved")
                .font(.title3.weight(.semibold))
                .foregroundStyle(BrandTheme.textPrimary)
                .multilineTextAlignment(.center)

            Text(successDetail(for: listing))
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            NavigationLink {
                ListingDetailView(listingID: listing.id, preview: nil)
            } label: {
                Text("View listing")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
            }
            .glassProminentBrandCTA()
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .accessibilityHint("Opens the listing you just created")

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

    private func successDetail(for listing: ListingDetail) -> String {
        if publish {
            return "“\(listing.displayTitle)” is live for local buyers (≈25 mi). They bid up from your start price; escrow holds payment until pickup."
        }
        return "“\(listing.displayTitle)” is saved as a draft. Publish when you’re ready for local buyers to bid up."
    }

    // MARK: - Validation / submit

    private var canSubmit: Bool {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let zip = pickupZip.trimmingCharacters(in: .whitespacesAndNewlines)
        let cat = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        return !t.isEmpty
            && t.count <= 120
            && !zip.isEmpty
            && !cat.isEmpty
            && MoneyFormat.cents(fromDollarsText: startingPriceText) != nil
            && !isSubmitting
            && !isUploadingPhotos
    }

    private func durationLabel(_ hours: Int) -> String {
        if hours >= 168 {
            return "7 days"
        }
        if hours == 24 {
            return "24 hours"
        }
        return "\(hours) hours"
    }

    @MainActor
    private func submit() async {
        errorMessage = nil

        guard !auth.isScaffoldSession else {
            BrandHaptics.error()
            errorMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to sell items."
            return
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Enter a title for the listing."
            return
        }
        guard trimmedTitle.count <= 120 else {
            BrandHaptics.warning()
            errorMessage = "Title must be at most 120 characters."
            return
        }
        guard description.count <= 5000 else {
            BrandHaptics.warning()
            errorMessage = "Description must be at most 5000 characters."
            return
        }
        guard let startCents = MoneyFormat.cents(fromDollarsText: startingPriceText) else {
            BrandHaptics.warning()
            errorMessage = "Enter a valid starting price in dollars (for example 50.00)."
            return
        }

        let buyNowTrimmed = buyNowText.trimmingCharacters(in: .whitespacesAndNewlines)
        var buyNowCents: Int64?
        if !buyNowTrimmed.isEmpty {
            guard let cents = MoneyFormat.cents(fromDollarsText: buyNowTrimmed) else {
                BrandHaptics.warning()
                errorMessage = "Buy now must be a valid dollar amount, or left blank."
                return
            }
            guard cents >= startCents else {
                BrandHaptics.warning()
                errorMessage = "Buy now must be at least the starting price."
                return
            }
            buyNowCents = cents
        }

        let zip = pickupZip.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !zip.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Enter a pickup ZIP code."
            return
        }

        let cat = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cat.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Choose a category from the taxonomy."
            return
        }

        guard durationOptions.contains(durationHours) else {
            BrandHaptics.warning()
            errorMessage = "Auction duration must be 24, 48, or 168 hours."
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let listing = try await APIClient.shared.createListing(
                categoryId: cat,
                title: trimmedTitle,
                description: description,
                photoUrls: photoURLs,
                pickupZip: zip,
                startingPriceCents: startCents,
                buyNowPriceCents: buyNowCents,
                condition: condition.rawValue,
                auctionDurationHours: durationHours,
                publish: publish
            )
            BrandHaptics.success()
            createdListing = listing
        } catch let error as APIClientError {
            BrandHaptics.error()
            errorMessage = error.localizedDescription
        } catch {
            BrandHaptics.error()
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func refreshFairPriceHint(categoryId: String) async {
        let trimmed = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            fairPriceHint = nil
            return
        }
        let zip = pickupZip.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            // side=2 → goods marketplace.
            let price = try await APIClient.shared.fetchFairPrice(
                categoryId: trimmed,
                zip: zip.isEmpty ? nil : zip,
                side: 2
            )
            fairPriceHint = price.hintCaption
        } catch {
            fairPriceHint = nil
        }
    }

    private func openWebSell() {
        openURL(AppConfig.sellItemURL)
    }
}

// MARK: - Condition picker

/// StockX-style condition enum matching gateway `allowedListingConditions`.
enum ListingConditionOption: String, CaseIterable, Identifiable, Hashable {
    case new
    case likeNew = "like_new"
    case veryGood = "very_good"
    case good
    case acceptable
    case forParts = "for_parts"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .new: return "New"
        case .likeNew: return "Like new"
        case .veryGood: return "Very good"
        case .good: return "Good"
        case .acceptable: return "Acceptable"
        case .forParts: return "For parts"
        }
    }
}

#Preview {
    NavigationStack {
        CreateListingView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
