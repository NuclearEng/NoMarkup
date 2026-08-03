import SwiftUI

/// Services reverse-auction surface.
/// Browse = public open jobs; Mine = authenticated owner list (`/jobs/mine`).
///
/// DES.12 / MP.1: regular width → `NavigationSplitView` (list + detail);
/// compact → `NavigationStack`. Selection drives the detail pane on iPad.
struct JobsView: View {
    private enum Segment: String, CaseIterable, Identifiable {
        case browse = "Browse"
        case mine = "Mine"
        var id: String { rawValue }
    }

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var segment: Segment = .browse
    @State private var jobs: [JobSummary] = []
    @State private var myJobs: [JobMine] = []
    @State private var pagination: PaginationMeta?
    @State private var myPagination: PaginationMeta?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var searchText = ""
    @State private var loadMoreError: String?
    @State private var selectedJob: JobSummary?
    /// FR-3.8 browse filters (category + optional min starting bid).
    @State private var filterCategoryId = ""
    @State private var filterCategoryName = ""
    @State private var minStartingBidText = ""
    @State private var showBrowseFilters = false

    private var usesSplitView: Bool { horizontalSizeClass == .regular }

    private var minStartingBidCents: Int64? {
        let t = minStartingBidText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        return MoneyFormat.cents(fromDollarsText: t)
    }

    var body: some View {
        Group {
            if usesSplitView {
                NavigationSplitView {
                    listRoot
                } detail: {
                    NavigationStack {
                        if let selectedJob {
                            JobDetailView(jobID: selectedJob.id, preview: selectedJob)
                        } else {
                            ContentUnavailableView(
                                "Select a job",
                                systemImage: "wrench.and.screwdriver",
                                description: Text("Choose a reverse auction from the list.")
                            )
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .brandScreenBackground()
                        }
                    }
                }
            } else {
                NavigationStack {
                    listRoot
                        .navigationDestination(for: JobSummary.self) { job in
                            JobDetailView(jobID: job.id, preview: job)
                        }
                }
            }
        }
    }

    private var listRoot: some View {
        content
            .navigationTitle("Jobs")
            .searchable(text: $searchText, prompt: segment == .browse ? "Search jobs" : "Search is browse-only")
            .onSubmit(of: .search) {
                guard segment == .browse else { return }
                Task { await load(reset: true) }
            }
            .refreshable { await load(reset: true) }
            .task(id: segment) { await load(reset: true) }
            .onChange(of: segment) { _, _ in
                selectedJob = nil
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Jobs section", selection: $segment) {
                        ForEach(Segment.allCases) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(minWidth: 180)
                    .accessibilityLabel("Jobs section")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        if segment == .browse {
                            Button {
                                showBrowseFilters.toggle()
                            } label: {
                                Label(
                                    "Filters",
                                    systemImage: hasActiveBrowseFilters
                                        ? "line.3.horizontal.decrease.circle.fill"
                                        : "line.3.horizontal.decrease.circle"
                                )
                            }
                            .frame(minHeight: 44)
                            .accessibilityHint("Filter browse by category and minimum starting bid")
                        }
                        NavigationLink {
                            JobsMapView()
                        } label: {
                            Label("Map", systemImage: "map")
                        }
                        .frame(minHeight: 44)
                        .accessibilityHint("Shows open jobs on a map")
                    }
                }
            }
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                if segment == .browse, showBrowseFilters {
                    browseFiltersBar
                }
            }
    }

    private var hasActiveBrowseFilters: Bool {
        !filterCategoryId.isEmpty || minStartingBidCents != nil
    }

    private var browseFiltersBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                CategoryPickerView(selectedId: $filterCategoryId, selectedName: $filterCategoryName)
            } label: {
                HStack {
                    Text("Category")
                        .foregroundStyle(BrandTheme.textPrimary)
                    Spacer()
                    Text(filterCategoryName.isEmpty ? "Any" : filterCategoryName)
                        .foregroundStyle(filterCategoryName.isEmpty ? BrandTheme.textSecondary : BrandTheme.goldBright)
                        .lineLimit(1)
                }
                .frame(minHeight: 44)
            }
            .accessibilityLabel("Filter by category")

            HStack {
                Text("Min starting bid ($)")
                    .foregroundStyle(BrandTheme.textPrimary)
                TextField("Any", text: $minStartingBidText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(minHeight: 44)
            }

            HStack {
                Button("Apply") {
                    Task { await load(reset: true) }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .frame(minHeight: 44)

                Button("Clear") {
                    filterCategoryId = ""
                    filterCategoryName = ""
                    minStartingBidText = ""
                    Task { await load(reset: true) }
                }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(BrandTheme.navyElevated)
    }

    @ViewBuilder
    private var content: some View {
        switch segment {
        case .browse:
            browseContent
        case .mine:
            mineContent
        }
    }

    // MARK: - Browse (public)

    @ViewBuilder
    private var browseContent: some View {
        if isLoading && jobs.isEmpty {
            ProgressView("Loading jobs…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, jobs.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load jobs",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if jobs.isEmpty {
            BrandEmptyState(
                title: "No open reverse auctions",
                systemImage: "wrench.and.screwdriver",
                message: "When customers post work, qualified providers compete here on price. Pull to refresh or clear search."
            )
        } else {
            List {
                Section {
                    Text("Customers post jobs. Providers compete on price (descending reverse auction). Fair market rates — not lead-gen markup.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(jobs) { job in
                        jobRowLink(job)
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(jobs.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("Open jobs").brandSectionHeader()
                    }
                }

                if pagination?.resolvedHasNext == true {
                    Section {
                        loadMoreFooter(
                            isLoadingMore: isLoadingMore,
                            error: loadMoreError
                        ) {
                            Task { await load(reset: false) }
                        }
                    }
                }

                Section {
                    Text(LocationPurposeCopy.systemWhenInUseUsageDescription)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                    Text(LocationPurposeCopy.marketPickerPrePrompt)
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Location").brandSectionHeader()
                }
            }
            .brandListBackground()
        }
    }

    // MARK: - Mine (auth)

    @ViewBuilder
    private var mineContent: some View {
        if auth.isScaffoldSession {
            BrandEmptyState(
                title: "Sign in for My Jobs",
                systemImage: "person.crop.circle.badge.exclamationmark",
                message: "Browse-only mode has no API token. Sign out and sign in with a real account to load jobs you posted.",
                actionTitle: "Sign out to log in"
            ) {
                auth.signOut()
            }
        } else if needsSignIn {
            BrandEmptyState(
                title: "Sign in required",
                systemImage: "lock.circle",
                message: "Your session expired or is missing. Sign in again to see jobs you posted.",
                actionTitle: "Sign in"
            ) {
                auth.signOut()
            }
        } else if isLoading && myJobs.isEmpty {
            ProgressView("Loading your jobs…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, myJobs.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load your jobs",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if myJobs.isEmpty {
            BrandEmptyState(
                title: "No jobs yet",
                systemImage: "tray",
                message: "Jobs you post as a customer show up here. Providers bid down until the market sets the price. Pull to refresh after posting on the website."
            )
        } else {
            List {
                Section {
                    Text("Jobs you posted (including drafts if the mine feed includes them). Open a row for detail; publish drafts from Account → Job drafts.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(myJobs) { job in
                        jobRowLink(job)
                    }
                } header: {
                    if let total = myPagination?.resolvedTotal, total > 0 {
                        Text("\(myJobs.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("My jobs").brandSectionHeader()
                    }
                }

                if myPagination?.resolvedHasNext == true {
                    Section {
                        loadMoreFooter(
                            isLoadingMore: isLoadingMore,
                            error: loadMoreError
                        ) {
                            Task { await load(reset: false) }
                        }
                    }
                }
            }
            .brandListBackground()
        }
    }

    @ViewBuilder
    private func jobRowLink(_ job: JobSummary) -> some View {
        if usesSplitView {
            Button {
                selectedJob = job
            } label: {
                JobRowView(job: job)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(minHeight: 44)
            .listRowBackground(
                selectedJob?.id == job.id ? BrandTheme.surfaceRaised : BrandTheme.navyElevated
            )
            .accessibilityHint("Shows job detail in the side panel")
        } else {
            NavigationLink(value: job) {
                JobRowView(job: job)
            }
            .frame(minHeight: 44)
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityHint("Opens job detail")
        }
    }

    @ViewBuilder
    private func loadMoreFooter(
        isLoadingMore: Bool,
        error: String?,
        action: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error, !error.isEmpty {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: action) {
                if isLoadingMore {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Text("Load more")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .buttonStyle(.bordered)
            .tint(BrandTheme.accent)
            .disabled(isLoadingMore)
            .accessibilityLabel("Load more jobs")
            .accessibilityHint("Fetches the next page and appends to the list")
        }
        .listRowBackground(BrandTheme.navyElevated)
    }

    @MainActor
    private func load(reset: Bool) async {
        if reset {
            isLoading = true
            loadMoreError = nil
        } else {
            guard !isLoadingMore else { return }
            let hasNext: Bool = {
                switch segment {
                case .browse: return pagination?.resolvedHasNext == true
                case .mine: return myPagination?.resolvedHasNext == true
                }
            }()
            guard hasNext else { return }
            isLoadingMore = true
            loadMoreError = nil
        }
        errorMessage = nil
        needsSignIn = false
        defer {
            isLoading = false
            isLoadingMore = false
        }

        let pageSize = 40

        switch segment {
        case .browse:
            let nextPage = reset ? 1 : (pagination?.resolvedPage ?? 1) + 1
            do {
                let categoryIds: [String]? = filterCategoryId.isEmpty
                    ? nil
                    : [filterCategoryId]
                let response = try await APIClient.shared.fetchJobs(
                    page: nextPage,
                    pageSize: pageSize,
                    q: searchText,
                    categoryIds: categoryIds,
                    latitude: AppConfig.browseLatitude,
                    longitude: AppConfig.browseLongitude
                )
                var loaded = response.jobs
                // Client-side min starting bid (gateway may not expose price filter).
                if let minCents = minStartingBidCents {
                    loaded = loaded.filter { ($0.startingBidCents ?? 0) >= minCents }
                }
                if reset {
                    jobs = loaded
                } else {
                    let existing = Set(jobs.map(\.id))
                    jobs.append(contentsOf: loaded.filter { !existing.contains($0.id) })
                }
                pagination = response.pagination
            } catch {
                if reset, jobs.isEmpty {
                    errorMessage = error.localizedDescription
                } else if !reset {
                    loadMoreError = error.localizedDescription
                }
            }
        case .mine:
            if auth.isScaffoldSession {
                myJobs = []
                myPagination = nil
                return
            }
            let nextPage = reset ? 1 : (myPagination?.resolvedPage ?? 1) + 1
            do {
                let response = try await APIClient.shared.fetchMyJobs(page: nextPage, pageSize: pageSize)
                if reset {
                    myJobs = response.jobs
                } else {
                    let existing = Set(myJobs.map(\.id))
                    myJobs.append(contentsOf: response.jobs.filter { !existing.contains($0.id) })
                }
                myPagination = response.pagination
            } catch let error as APIClientError where error.isUnauthorized {
                if reset {
                    myJobs = []
                    myPagination = nil
                    needsSignIn = true
                } else {
                    loadMoreError = error.localizedDescription
                }
            } catch {
                if reset, myJobs.isEmpty {
                    errorMessage = error.localizedDescription
                } else if !reset {
                    loadMoreError = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Row

private struct JobRowView: View {
    let job: JobSummary

    private var isDraft: Bool {
        (job.status ?? "").lowercased() == "draft"
    }

    private var isLive: Bool {
        switch (job.status ?? "").lowercased() {
        case "active", "open", "bidding", "live":
            return true
        default:
            return false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isDraft {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.warning)
                    Text("DRAFT")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.warning)
                    Text("· not published")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Draft, not published")
            } else if isLive {
                HStack(spacing: 6) {
                    Circle()
                        .fill(BrandTheme.success)
                        .frame(width: 6, height: 6)
                    Text("LIVE REVERSE AUCTION")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.success)
                    if let countdown = job.auctionCountdown {
                        Text("· \(countdown)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(job.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
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
                if !isDraft {
                    Text("Bid down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if let status = job.status, !status.isEmpty {
                    StatusChipView(
                        label: StatusChipStyle.displayLabel(status),
                        style: StatusChipStyle.forStatus(status)
                    )
                }
                if let category = job.categoryName, !category.isEmpty {
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 12) {
                if let location = job.locationLabel {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                // FR-10.7: distance when browse is geo-scoped (AppConfig lat/lng).
                if let distance = job.distanceLabel {
                    Label(distance, systemImage: "location")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let bids = job.bidCount {
                    Label("\(bids) bids", systemImage: "hammer")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let countdown = job.auctionCountdown {
                    Label(countdown, systemImage: "clock")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// Compact status pill used on catalog rows.
struct StatusChipView: View {
    let label: String
    let style: StatusChipStyle

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .accessibilityLabel("Status \(label)")
    }

    private var foreground: Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.bidActive
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    private var background: Color {
        foreground.opacity(0.14)
    }
}

#Preview {
    JobsView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
