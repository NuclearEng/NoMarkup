import SwiftUI

/// Native create flow for goods marketplace listings (`POST /api/v1/listings`).
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
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(BrandTheme.accent)
        .onChange(of: categoryId) { _, newValue in
            Task { await refreshFairPriceHint(categoryId: newValue) }
        }
    }

    // MARK: - Form

    private var formContent: some View {
        Form {
            Section {
                Text("Local pickup only (≈25 mi). Buyers bid up in a forward auction. Escrow holds payment until pickup — no platform markup on the bid.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section {
                TextField("Title", text: $title, prompt: Text("e.g. Mid-century oak dresser"))
                    .textInputAutocapitalization(.sentences)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
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
                .accessibilityLabel("Listing description")
            } header: {
                Text("Item").brandSectionHeader()
            } footer: {
                Text("Title max 120 characters · description max 5000.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            PhotoPickSection(
                context: .listing,
                maxCount: ImageUploader.maxPhotosPerForm,
                photoURLs: $photoURLs,
                isUploading: $isUploadingPhotos,
                errorMessage: $errorMessage
            )

            Section {
                DollarAmountField(
                    text: $startingPriceText,
                    placeholder: "50.00",
                    accessibilityLabelText: "Starting price in dollars"
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
                    .accessibilityLabel("Pickup ZIP code")
                    .accessibilityHint("Required so buyers can search by distance. Must be a ZIP we cover to publish.")
            } header: {
                Text("Price & pickup").brandSectionHeader()
            } footer: {
                Text("A valid covered ZIP is required to publish so the listing appears in radius search.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                Picker("Condition", selection: $condition) {
                    ForEach(ListingConditionOption.allCases) { option in
                        Text(option.displayName).tag(option)
                    }
                }
                .frame(minHeight: 44)

                Picker("Auction length", selection: $durationHours) {
                    ForEach(durationOptions, id: \.self) { hours in
                        Text(durationLabel(hours)).tag(hours)
                    }
                }
                .frame(minHeight: 44)

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
                .accessibilityLabel("Listing category")
                .accessibilityValue(categoryName.isEmpty ? "Not selected" : categoryName)
                .accessibilityHint("Opens the category tree picker")

                Toggle("Publish immediately", isOn: $publish)
                    .frame(minHeight: 44)
                    .tint(BrandTheme.accent)
            } header: {
                Text("Listing options").brandSectionHeader()
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Duration must be 24 hours, 48 hours, or 7 days. Pick a real category from the taxonomy tree.")
                    if let fairPriceHint {
                        Text(fairPriceHint)
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                }
                .foregroundStyle(BrandTheme.textSecondary)
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
                    Task { await submit() }
                } label: {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(publish ? "List item" : "Save draft")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canSubmit || isSubmitting)
                .accessibilityHint("Creates the goods listing on the server")

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
        }
        .brandListBackground()
        .scrollDismissesKeyboard(.interactively)
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

            Text("“\(listing.displayTitle)” is ready. Local buyers can bid up or use Buy Now if you set a price.")
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
            errorMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to sell items."
            return
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            errorMessage = "Enter a title for the listing."
            return
        }
        guard trimmedTitle.count <= 120 else {
            errorMessage = "Title must be at most 120 characters."
            return
        }
        guard description.count <= 5000 else {
            errorMessage = "Description must be at most 5000 characters."
            return
        }
        guard let startCents = MoneyFormat.cents(fromDollarsText: startingPriceText) else {
            errorMessage = "Enter a valid starting price in dollars (for example 50.00)."
            return
        }

        let buyNowTrimmed = buyNowText.trimmingCharacters(in: .whitespacesAndNewlines)
        var buyNowCents: Int64?
        if !buyNowTrimmed.isEmpty {
            guard let cents = MoneyFormat.cents(fromDollarsText: buyNowTrimmed) else {
                errorMessage = "Buy now must be a valid dollar amount, or left blank."
                return
            }
            guard cents >= startCents else {
                errorMessage = "Buy now must be at least the starting price."
                return
            }
            buyNowCents = cents
        }

        let zip = pickupZip.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !zip.isEmpty else {
            errorMessage = "Enter a pickup ZIP code."
            return
        }

        let cat = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cat.isEmpty else {
            errorMessage = "Choose a category from the taxonomy."
            return
        }

        guard durationOptions.contains(durationHours) else {
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
            createdListing = listing
        } catch let error as APIClientError {
            errorMessage = error.localizedDescription
        } catch {
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
