import SwiftUI

/// Native create flow for service reverse-auction jobs (`POST /api/v1/jobs`).
struct PostJobView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var title = ""
    @State private var description = ""
    @State private var startingBidText = ""
    @State private var locationAddress = ""
    @State private var categoryId = ""
    @State private var categories: [ServiceCategorySummary] = []
    @State private var durationHours = 24
    @State private var publish = true
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var createdJob: JobDetail?
    @State private var photoURLs: [String] = []
    @State private var isUploadingPhotos = false

    /// Job service allows 0…168 hours; common presets for the picker.
    private let durationOptions = [24, 48, 72, 168]

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
        .navigationTitle("Post a job")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(BrandTheme.accent)
        .task {
            await loadCategoriesIfNeeded()
        }
    }

    // MARK: - Form

    private var formContent: some View {
        Form {
            Section {
                Text("Describe the work and set a starting budget. Providers bid down in a reverse auction — fair market rates, not lead-gen markup.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
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

                if categories.isEmpty {
                    TextField("Category ID", text: $categoryId, prompt: Text("UUID from taxonomy"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Category UUID")
                } else {
                    Picker("Category", selection: $categoryId) {
                        Text("Select…").tag("")
                        ForEach(categories) { cat in
                            Text(cat.displayName).tag(cat.id)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Service category")
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
                    accessibilityLabelText: "Starting bid in dollars — reverse auction, providers bid lower"
                )

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
            } header: {
                Text("Auction").brandSectionHeader()
            } footer: {
                Text("Starting bid is the maximum you’re willing to open at. Providers compete by bidding lower.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                TextField(
                    "Service address (optional)",
                    text: $locationAddress,
                    prompt: Text("Street, city, or neighborhood")
                )
                .textContentType(.fullStreetAddress)
                .foregroundStyle(BrandTheme.textPrimary)
                .frame(minHeight: 44)
                .accessibilityLabel("Optional service address")
            } header: {
                Text("Location").brandSectionHeader()
            } footer: {
                Text("Address is optional. Exact coordinates can be refined on web.")
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
                        Text(publish ? "Post job" : "Save draft")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canSubmit || isSubmitting)
                .accessibilityHint("Creates the reverse-auction job on the server")

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
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(BrandTheme.success)
                .accessibilityHidden(true)

            Text(publish ? "Job posted" : "Draft saved")
                .font(.title3.weight(.semibold))
                .foregroundStyle(BrandTheme.textPrimary)

            Text("“\(job.displayTitle)” is ready as a reverse auction. Providers can bid down from your starting budget.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

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

    // MARK: - Validation / submit

    private var canSubmit: Bool {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let c = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        return !t.isEmpty
            && t.count <= 200
            && !d.isEmpty
            && d.count <= 5000
            && !c.isEmpty
            && MoneyFormat.cents(fromDollarsText: startingBidText) != nil
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

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let job = try await APIClient.shared.createJob(
                title: trimmedTitle,
                description: trimmedDescription,
                categoryId: trimmedCategory,
                auctionDurationHours: durationHours,
                startingBidCents: cents,
                locationAddress: locationAddress.isEmpty ? nil : locationAddress,
                locationLat: nil,
                locationLng: nil,
                publish: publish,
                scheduleType: "flexible",
                photoUrls: photoURLs
            )
            createdJob = job
        } catch let error as APIClientError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadCategoriesIfNeeded() async {
        guard categories.isEmpty else { return }
        do {
            let list = try await APIClient.shared.fetchServiceCategories(level: 1)
            // Prefer active categories when the flag is present.
            let active = list.filter { $0.active != false }
            categories = active.isEmpty ? list : active
            if categoryId.isEmpty, let first = categories.first {
                categoryId = first.id
            }
        } catch {
            // Free-text category UUID field remains available when taxonomy is offline.
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
