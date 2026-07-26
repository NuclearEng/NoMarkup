import SwiftUI

/// Product home for the services reverse-auction (hero rail) with a goods marketplace strip.
struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.selectedRootTab) private var selectedRootTab

    @State private var healthOK: Bool?
    @State private var isChecking = false
    @State private var jobs: [JobSummary] = []
    @State private var listings: [ListingSummary] = []
    @State private var jobTotal: Int?
    @State private var listingTotal: Int?
    @State private var catalogError: String?
    @State private var isLoadingCatalog = false
    @State private var showPostJobSafari = false
    @State private var showSellSafari = false

    private var signedInLabel: String? {
        guard auth.isAuthenticated else { return nil }
        if auth.isScaffoldSession {
            return "Browsing offline (scaffold)"
        }
        let email = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty {
            return "Signed in as \(email)"
        }
        return "Signed in"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    heroSection
                    howItWorksSection
                    liveAuctionsSection
                    marketplaceStrip
                    gatewayFooter
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .brandScreenBackground()
            .navigationTitle("Home")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationDestination(for: JobSummary.self) { job in
                JobDetailView(jobID: job.id, preview: job)
            }
            .navigationDestination(for: ListingSummary.self) { listing in
                ListingDetailView(listingID: listing.id, preview: listing)
            }
            .task { await refreshHome() }
            .refreshable { await refreshHome() }
            .sheet(isPresented: $showPostJobSafari) {
                NavigationStack {
                    LegalWebView(title: "Post a job (web)", url: AppConfig.postJobURL)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showPostJobSafari = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
            }
            .sheet(isPresented: $showSellSafari) {
                NavigationStack {
                    LegalWebView(title: "Sell an item (web)", url: AppConfig.sellItemURL)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showSellSafari = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
            }
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reverse auction · Home services")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.sectionHeader)
                .textCase(.uppercase)
                .tracking(0.6)

            Text("Providers compete. You save.")
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            (
                Text("Post a job and watch the price go ")
                + Text("down").foregroundColor(BrandTheme.goldBright).fontWeight(.semibold)
                + Text(", not up. Trusted local providers bid against each other — you award the best offer.")
            )
            .font(.body)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)

            if let signedInLabel {
                Label(signedInLabel, systemImage: auth.isScaffoldSession ? "hammer" : "person.crop.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(auth.isScaffoldSession ? BrandTheme.goldBright : BrandTheme.success)
                    .accessibilityLabel(signedInLabel)
            }

            VStack(spacing: 12) {
                Button {
                    selectedRootTab?.wrappedValue = .jobs
                } label: {
                    Text("Browse open jobs")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .brandGoldProminentButton()
                .accessibilityHint("Opens the Jobs tab")

                HStack(spacing: 12) {
                    Button {
                        selectedRootTab?.wrappedValue = .marketplace
                    } label: {
                        Text("Shop goods")
                            .font(.body.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .accessibilityHint("Opens the Marketplace tab")

                    Button {
                        showPostJobSafari = true
                    } label: {
                        Text("Post a job")
                            .font(.body.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .accessibilityHint("Opens post-a-job on the website in Safari")
                    .accessibilityLabel("Post a job on web")
                }

                Button {
                    showSellSafari = true
                } label: {
                    Text("Sell an item (web)")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(BrandTheme.bidActive)
                .accessibilityHint("Opens sell form on the website in Safari until native create ships")
            }
        }
        .brandCard(padding: 20, heroGradient: true)
        .accessibilityElement(children: .contain)
    }

    // MARK: - How it works

    private var howItWorksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader("How reverse auction works", systemImage: "arrow.down.circle")

            HStack(alignment: .top, spacing: 10) {
                HowItWorksStep(
                    number: 1,
                    title: "Post a job",
                    detail: "Describe the work and set a starting budget."
                )
                HowItWorksStep(
                    number: 2,
                    title: "Providers bid down",
                    detail: "Licensed locals compete — price falls."
                )
                HowItWorksStep(
                    number: 3,
                    title: "Award the best",
                    detail: "Pick the lowest trusted bid and get it done."
                )
            }
        }
    }

    // MARK: - Live open auctions

    private var liveAuctionsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                sectionHeader("Live open auctions", systemImage: "bolt.fill")
                Spacer(minLength: 8)
                if let jobTotal, jobTotal > 0 {
                    Text("\(jobTotal) open")
                        .font(.caption.weight(.medium).monospacedDigit())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            if isLoadingCatalog && jobs.isEmpty {
                HStack {
                    Spacer()
                    ProgressView("Loading auctions…")
                        .tint(BrandTheme.accent)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Spacer()
                }
                .frame(minHeight: 120)
                .brandCard(padding: 20)
            } else if let catalogError, jobs.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Label(catalogError, systemImage: "wifi.exclamationmark")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.goldBright)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Try again") {
                        Task { await refreshHome() }
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .frame(minHeight: 44)
                }
                .brandCard(padding: 16)
            } else if jobs.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("No open jobs right now")
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text("Be the first to post — or browse again later. New reverse auctions appear here as customers list work.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        showPostJobSafari = true
                    } label: {
                        Text("Post a job on web")
                            .frame(minHeight: 44)
                    }
                    .brandGoldProminentButton()
                }
                .brandCard(padding: 16)
            } else {
                VStack(spacing: 10) {
                    ForEach(jobs) { job in
                        NavigationLink(value: job) {
                            HomeJobCard(job: job)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens job detail")
                    }
                }

                Button {
                    selectedRootTab?.wrappedValue = .jobs
                } label: {
                    HStack {
                        Text("See all jobs")
                            .font(.body.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(BrandTheme.accent)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the Jobs tab")
            }
        }
    }

    // MARK: - Marketplace strip

    private var marketplaceStrip: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                sectionHeader("Local goods · forward auction", systemImage: "bag.fill")
                Spacer(minLength: 8)
                if let listingTotal, listingTotal > 0 {
                    Text("\(listingTotal)")
                        .font(.caption.weight(.medium).monospacedDigit())
                        .foregroundStyle(BrandTheme.textSecondary)
                        .accessibilityLabel("\(listingTotal) listings")
                }
            }

            Text("Buyers bid up. Pickup within 25 mi.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)

            HStack(spacing: 12) {
                Button {
                    showSellSafari = true
                } label: {
                    Text("Sell an item (web)")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(BrandTheme.bidActive)
                .accessibilityHint("Opens sell form on the website")
            }

            if listings.isEmpty && !isLoadingCatalog {
                Button {
                    selectedRootTab?.wrappedValue = .marketplace
                } label: {
                    HStack {
                        Label("Browse marketplace", systemImage: "arrow.right.circle")
                            .font(.body.weight(.medium))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .brandCard(padding: 16)
                .accessibilityHint("Opens the Marketplace tab")
            } else {
                VStack(spacing: 10) {
                    ForEach(listings.prefix(3)) { listing in
                        NavigationLink(value: listing) {
                            HomeListingCard(listing: listing)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens listing detail")
                    }
                }

                Button {
                    selectedRootTab?.wrappedValue = .marketplace
                } label: {
                    HStack {
                        Text("Browse marketplace")
                            .font(.body.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(BrandTheme.accent)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the Marketplace tab")
            }
        }
    }

    // MARK: - Gateway footer (subtle)

    private var gatewayFooter: some View {
        HStack(spacing: 10) {
            Group {
                if isChecking {
                    ProgressView()
                        .controlSize(.small)
                        .tint(BrandTheme.textSecondary)
                } else if let healthOK {
                    Image(systemName: healthOK ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(healthOK ? BrandTheme.success : BrandTheme.destructive)
                        .accessibilityLabel(healthOK ? "API healthy" : "API unreachable")
                } else {
                    Image(systemName: "circle.dotted")
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.6))
                        .accessibilityLabel("API status unknown")
                }
            }
            .frame(width: 20, height: 20)

            Text("Gateway")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))

            Spacer()

            Button {
                Task { await refreshHome() }
            } label: {
                Text(isChecking ? "Checking…" : "Refresh")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(minHeight: 44)
                    .padding(.horizontal, 4)
            }
            .buttonStyle(.plain)
            .disabled(isChecking)
            .accessibilityLabel("Refresh home and API status")
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .opacity(0.9)
    }

    // MARK: - Shared chrome

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(BrandTheme.sectionHeader)
            .labelStyle(.titleAndIcon)
            .symbolRenderingMode(.hierarchical)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Data

    @MainActor
    private func refreshHome() async {
        isChecking = true
        isLoadingCatalog = jobs.isEmpty && listings.isEmpty
        catalogError = nil
        defer {
            isChecking = false
            isLoadingCatalog = false
        }

        async let healthTask: Void = checkHealth()
        async let catalogTask: Void = loadCatalog()
        _ = await (healthTask, catalogTask)
    }

    @MainActor
    private func checkHealth() async {
        do {
            healthOK = try await APIClient.shared.health()
        } catch {
            healthOK = false
        }
    }

    @MainActor
    private func loadCatalog() async {
        do {
            async let jobsResponse = APIClient.shared.fetchJobs(page: 1, pageSize: 8)
            async let listingsResponse = APIClient.shared.fetchListings(page: 1, pageSize: 3)
            let jobsResult = try await jobsResponse
            let listingsResult = try await listingsResponse
            jobs = Array(jobsResult.jobs.prefix(8))
            listings = Array(listingsResult.listings.prefix(3))
            jobTotal = jobsResult.pagination?.resolvedTotal ?? jobsResult.jobs.count
            listingTotal = listingsResult.pagination?.resolvedTotal ?? listingsResult.listings.count
            catalogError = nil
        } catch {
            if jobs.isEmpty {
                catalogError = "Couldn’t load live auctions. Pull to refresh or try again."
            }
        }
    }
}

// MARK: - How-it-works step

private struct HowItWorksStep: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                Circle()
                    .fill(BrandTheme.gold.opacity(0.18))
                    .frame(width: 32, height: 32)
                Text("\(number)")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
            .accessibilityHidden(true)

            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Text(detail)
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            BrandTheme.navyElevated,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.12), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number): \(title). \(detail)")
    }
}

// MARK: - Job auction card

private struct HomeJobCard: View {
    let job: JobSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(job.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if let price = job.displayPrice {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(price)
                            .font(.body.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                        if let caption = job.priceCaption {
                            Text(caption)
                                .font(.caption2)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                }
            }

            HStack(spacing: 8) {
                if let category = job.categoryName, !category.isEmpty {
                    Text(category)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let status = job.status, !status.isEmpty {
                    StatusChipView(
                        label: StatusChipStyle.displayLabel(status),
                        style: StatusChipStyle.forStatus(status)
                    )
                }
            }

            HStack(spacing: 12) {
                if let location = job.locationLabel {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let bids = job.bidCount {
                    Label("\(bids) bids", systemImage: "tag")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer(minLength: 0)
                if let countdown = job.auctionCountdown {
                    Text(countdown)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(
                            countdown == "Ended"
                                ? BrandTheme.textSecondary
                                : BrandTheme.navy
                        )
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            Capsule().fill(
                                countdown == "Ended"
                                    ? BrandTheme.textSecondary.opacity(0.2)
                                    : BrandTheme.goldBright
                            )
                        )
                        .accessibilityLabel(countdown)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44)
        .background(
            BrandTheme.navyElevated,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.14), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Listing preview card

private struct HomeListingCard: View {
    let listing: ListingSummary

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(listing.displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 8) {
                    if let location = listing.locationLabel {
                        Label(location, systemImage: "mappin.and.ellipse")
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                    }
                    if let bids = listing.bidCount {
                        Text("\(bids) bids")
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(listing.displayPrice)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                Text(listing.priceCaption)
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.7))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44)
        .background(
            BrandTheme.navyElevated,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.12), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
