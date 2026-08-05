import SwiftUI

/// FR-19.3 — per-property job history drill-in.
/// Loads `GET /api/v1/jobs/mine?property_id=` via `APIClient.fetchJobs(propertyId:)`.
/// History filters pass `category_id` / `date_from` to the server when set (FR-19.3).
///
/// FR-19.2 preferred providers: `GET /api/v1/properties/{id}/preferred-providers`,
/// with contract roll-up fallback.
/// FR-19.2 spend: `GET /api/v1/analytics/customers/me/spending?property_id=` (ownership
/// enforced server-side); soft-fails if unavailable.
struct PropertyDetailView: View {
    @EnvironmentObject private var auth: AuthViewModel

    let property: PropertyItem
    var onUpdated: ((PropertyItem) -> Void)?

    @State private var current: PropertyItem
    @State private var jobs: [JobSummary] = []
    @State private var isLoadingJobs = false
    @State private var jobsError: String?
    /// Property-scoped preferred / top providers from completed contracts.
    @State private var preferredProviders: [PreferredProviderRollup] = []
    /// Property-scoped services spend (payments for jobs linked to this property).
    @State private var spending: CustomerSpendingResponse?
    @State private var spendingError: String?
    @State private var showEditSheet = false
    @State private var statusMessage: String?
    @State private var statusIsError = false
    /// FR-19.3 history filters. Category uses server `category_id` when known;
    /// name is kept for menu labels. Date window maps to `date_from`.
    @State private var historyCategoryId = ""
    @State private var historyCategoryName = ""
    @State private var historyDateRange: HistoryDateRange = .all
    /// Server-filtered history rows when filters are active (keeps active/upcoming unfiltered).
    @State private var serverHistoryJobs: [JobSummary]?

    init(property: PropertyItem, onUpdated: ((PropertyItem) -> Void)? = nil) {
        self.property = property
        self.onUpdated = onUpdated
        _current = State(initialValue: property)
    }

    private var activeJobs: [JobSummary] {
        jobs.filter(\.isActiveWork)
    }

    private var upcomingJobs: [JobSummary] {
        jobs.filter(\.isUpcomingWork)
    }

    private var historyJobs: [JobSummary] {
        jobs.filter { !$0.isActiveWork && !$0.isUpcomingWork }
    }

    /// Distinct categories from history (id when present) for filter menu.
    private var historyCategoryOptions: [(id: String, name: String)] {
        var byKey: [String: String] = [:]
        for job in historyJobs {
            let name = job.categoryName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let id = job.categoryId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if name.isEmpty && id.isEmpty { continue }
            let key = id.isEmpty ? "name:\(name.lowercased())" : id
            if byKey[key] == nil {
                byKey[key] = name.isEmpty ? id : name
            }
        }
        return byKey
            .map { (id: $0.key.hasPrefix("name:") ? "" : $0.key, name: $0.value) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var filteredHistoryJobs: [JobSummary] {
        // Server narrows the set when filters are active; client always re-applies
        // so name-only category filters (no UUID) stay correct on API miss.
        let base: [JobSummary]
        if hasActiveHistoryFilters, let serverHistoryJobs {
            base = serverHistoryJobs
        } else {
            base = historyJobs
        }
        return base.filter { job in
            if !historyCategoryId.isEmpty {
                let id = job.categoryId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if id != historyCategoryId { return false }
            } else if !historyCategoryName.isEmpty {
                let name = job.categoryName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if name.caseInsensitiveCompare(historyCategoryName) != .orderedSame {
                    return false
                }
            }
            if let windowStart = historyDateRange.startDate {
                guard let created = job.createdAt.flatMap({ CatalogDateFormat.parseISO($0) }) else {
                    return false
                }
                if created < windowStart { return false }
            }
            return true
        }
    }

    private var hasActiveHistoryFilters: Bool {
        !historyCategoryId.isEmpty || !historyCategoryName.isEmpty || historyDateRange != .all
    }

    var body: some View {
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
                propertyHeader
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Property").brandSectionHeader()
            }

            propertySpendingSection

            if isLoadingJobs && jobs.isEmpty {
                Section {
                    HStack {
                        ProgressView()
                            .tint(BrandTheme.accent)
                        Text("Loading jobs…")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                }
            } else if let jobsError, jobs.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(jobsError)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Try again") {
                            Task { await loadJobs() }
                        }
                        .frame(minHeight: 44)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
            } else if jobs.isEmpty {
                Section {
                    Text("No jobs linked to this property yet. Post a reverse-auction job and pick this address.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Jobs").brandSectionHeader()
                }
            } else {
                preferredProvidersSection

                if !activeJobs.isEmpty {
                    jobSection(title: "Active (\(activeJobs.count))", jobs: activeJobs)
                }
                if !upcomingJobs.isEmpty {
                    jobSection(title: "Upcoming (\(upcomingJobs.count))", jobs: upcomingJobs)
                }
                if !historyJobs.isEmpty {
                    historyFiltersSection
                    if filteredHistoryJobs.isEmpty {
                        Section {
                            Text(hasActiveHistoryFilters
                                 ? "No history jobs match these filters. Clear category or date range to see all completed work."
                                 : "No history jobs for this property.")
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .listRowBackground(BrandTheme.navyElevated)
                                .accessibilityLabel("No matching history jobs")
                        } header: {
                            Text("History").brandSectionHeader()
                        }
                    } else {
                        jobSection(
                            title: hasActiveHistoryFilters
                                ? "History (\(filteredHistoryJobs.count) of \(historyJobs.count))"
                                : "History (\(historyJobs.count))",
                            jobs: filteredHistoryJobs
                        )
                    }
                }
            }
        }
        .brandListBackground()
        .navigationTitle(current.displayNickname)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showEditSheet = true
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Edit nickname, notes, or primary flag")
            }
        }
        .task {
            await loadJobs()
            await loadSpending()
        }
        .refreshable {
            await loadJobs()
            await loadSpending()
        }
        .sheet(isPresented: $showEditSheet) {
            EditPropertySheet(property: current) { updated in
                current = updated
                onUpdated?(updated)
                statusIsError = false
                statusMessage = "Saved “\(updated.displayNickname)”."
                showEditSheet = false
            } onCancel: {
                showEditSheet = false
            }
        }
    }

    private var historyFiltersSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                // Category filter
                Menu {
                    Button {
                        historyCategoryId = ""
                        historyCategoryName = ""
                        Task { await reloadHistoryWithFilters() }
                    } label: {
                        HStack {
                            Text("All categories")
                            if historyCategoryId.isEmpty && historyCategoryName.isEmpty {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    ForEach(historyCategoryOptions, id: \.name) { option in
                        Button {
                            historyCategoryId = option.id
                            historyCategoryName = option.name
                            Task { await reloadHistoryWithFilters() }
                        } label: {
                            HStack {
                                Text(option.name)
                                if (!option.id.isEmpty && historyCategoryId == option.id)
                                    || (option.id.isEmpty && historyCategoryName == option.name) {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack {
                        Label(
                            historyCategoryName.isEmpty ? "All categories" : historyCategoryName,
                            systemImage: "tag"
                        )
                        .foregroundStyle(
                            historyCategoryName.isEmpty ? BrandTheme.textPrimary : BrandTheme.goldBright
                        )
                        .lineLimit(1)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Filter history by category")
                .accessibilityValue(historyCategoryName.isEmpty ? "All categories" : historyCategoryName)

                // Date range filter
                Picker("Date range", selection: $historyDateRange) {
                    ForEach(HistoryDateRange.allCases) { range in
                        Text(range.label).tag(range)
                    }
                }
                .pickerStyle(.segmented)
                .frame(minHeight: 44)
                .accessibilityLabel("Filter history by date range")
                .onChange(of: historyDateRange) { _, _ in
                    Task { await reloadHistoryWithFilters() }
                }

                if hasActiveHistoryFilters {
                    Button {
                        historyCategoryId = ""
                        historyCategoryName = ""
                        historyDateRange = .all
                        serverHistoryJobs = nil
                    } label: {
                        Text("Clear history filters")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .accessibilityHint("Resets category and date range filters")
                }
            }
            .padding(.vertical, 4)
            .listRowBackground(BrandTheme.navyElevated)
        } header: {
            Text("History filters").brandSectionHeader()
        } footer: {
            Text("Filters apply to completed and past jobs only (server `category_id` / `date_from` when available). Active and upcoming lists stay unfiltered.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private var propertyHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(current.displayNickname)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                if current.isPrimary == true {
                    Text("PRIMARY")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(BrandTheme.accent, in: Capsule())
                }
            }

            ForEach(current.addressLines, id: \.self) { line in
                Text(line)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let notes = current.notesDisplay {
                Text(notes)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                    .accessibilityLabel("Notes: \(notes)")
            }

            HStack(spacing: 12) {
                summaryChip(label: "Active", count: activeJobs.count)
                summaryChip(label: "Upcoming", count: upcomingJobs.count)
                summaryChip(label: "Total", count: jobs.count)
            }
            .padding(.top, 4)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func summaryChip(label: String, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(count)")
                .font(.headline.monospacedDigit())
                .foregroundStyle(BrandTheme.goldBright)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary)
        }
        .frame(minWidth: 56, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(count) \(label.lowercased()) jobs")
    }

    @ViewBuilder
    private func jobSection(title: String, jobs: [JobSummary]) -> some View {
        Section {
            ForEach(jobs) { job in
                NavigationLink {
                    JobDetailView(jobID: job.id, preview: job)
                } label: {
                    propertyJobRow(job)
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Opens job detail")
            }
        } header: {
            Text(title).brandSectionHeader()
        }
    }

    private func propertyJobRow(_ job: JobSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(job.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if let price = job.displayPrice {
                    Text(price)
                        .font(.subheadline.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
            }

            HStack(spacing: 8) {
                Text(StatusChipStyle.displayLabel(job.normalizedStatus.isEmpty ? "unknown" : job.normalizedStatus))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(statusForeground(job))
                if let category = job.categoryName?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !category.isEmpty {
                    Text("·")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let created = job.createdAt, !created.isEmpty {
                    Spacer(minLength: 4)
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func statusForeground(_ job: JobSummary) -> Color {
        switch StatusChipStyle.forStatus(job.status) {
        case .success: return BrandTheme.success
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .info: return BrandTheme.accent
        case .neutral: return BrandTheme.textSecondary
        }
    }

    /// FR-19.2 — property-scoped services spend (soft-fail).
    @ViewBuilder
    private var propertySpendingSection: some View {
        if let spending {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Total spend")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(spending.displayTotalSpent)
                            .font(.title3.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    Spacer(minLength: 12)
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("Jobs")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text("\(spending.totalJobs ?? 0)")
                            .font(.title3.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.textPrimary)
                    }
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "Total spend \(spending.displayTotalSpent), \(spending.totalJobs ?? 0) jobs at this property"
                )

                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Avg job")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(spending.displayAverageJobCost)
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.textPrimary)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Savings vs market")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(spending.displayTotalSavings)
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.textPrimary)
                    }
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)

                let cats = Array((spending.categoryBreakdown ?? []).prefix(5))
                if !cats.isEmpty {
                    ForEach(cats) { cat in
                        HStack {
                            Text(cat.displayName)
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Text(cat.displaySpent)
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                            if let count = cat.jobCount {
                                Text("· \(count)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(cat.displayName), \(cat.displaySpent)")
                    }
                }
            } header: {
                Text("Spend · this property").brandSectionHeader()
            } footer: {
                Text("Completed service payments for jobs linked to this address (trailing 12 months).")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        } else if let spendingError {
            Section {
                Text(spendingError)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Spend").brandSectionHeader()
            }
        }
    }

    /// FR-19.2 best-effort — only providers with completed contracts on this property’s jobs.
    @ViewBuilder
    private var preferredProvidersSection: some View {
        if preferredProviders.isEmpty {
            EmptyView()
        } else {
            Section {
                ForEach(preferredProviders.prefix(5)) { provider in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.displayName)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                                .lineLimit(1)
                            Text(provider.countLabel)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Spacer(minLength: 8)
                        if provider.isPreferred {
                            Text("PREFERRED")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(BrandTheme.accent, in: Capsule())
                        } else {
                            Text("\(provider.completedJobCount)/3")
                                .font(.caption2.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        provider.isPreferred
                            ? "\(provider.displayName), preferred, \(provider.countLabel)"
                            : "\(provider.displayName), \(provider.countLabel)"
                    )
                }
            } header: {
                Text("Providers at this property").brandSectionHeader()
            } footer: {
                Text("From completed contracts linked to jobs at this address (server aggregate when available). Preferred = 3+ completed jobs with the same provider.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    /// FR-19.2 property-scoped spend (soft-fail; detail still works without it).
    @MainActor
    private func loadSpending() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        do {
            let end = Date()
            let start = Calendar.current.date(byAdding: .year, value: -1, to: end) ?? end
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"
            spending = try await APIClient.shared.fetchCustomerSpending(
                startDate: formatter.string(from: start),
                endDate: formatter.string(from: end),
                groupBy: "month",
                propertyId: current.id
            )
            spendingError = nil
        } catch {
            if spending == nil {
                spendingError = "Spend summary unavailable right now."
            }
        }
    }

    @MainActor
    private func loadJobs() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingJobs = jobs.isEmpty
        jobsError = nil
        defer { isLoadingJobs = false }

        do {
            // Unfiltered load so active/upcoming sections stay complete.
            let response = try await APIClient.shared.fetchJobs(propertyId: current.id, pageSize: 100)
            jobs = response.jobs
            await loadPreferredProviders(for: response.jobs)
            if hasActiveHistoryFilters {
                await reloadHistoryWithFilters()
            } else {
                serverHistoryJobs = nil
            }
        } catch {
            if jobs.isEmpty {
                jobsError = error.localizedDescription
            }
        }
    }

    /// FR-19.3 — re-fetch history with server filters; client fallback on failure.
    @MainActor
    private func reloadHistoryWithFilters() async {
        guard hasActiveHistoryFilters else {
            serverHistoryJobs = nil
            return
        }
        let categoryId = historyCategoryId.isEmpty ? nil : historyCategoryId
        var dateFrom: String?
        if let start = historyDateRange.startDate {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            dateFrom = formatter.string(from: start)
        }
        do {
            let response = try await APIClient.shared.fetchJobs(
                propertyId: current.id,
                pageSize: 100,
                categoryId: categoryId,
                dateFrom: dateFrom
            )
            // Keep only non-active/non-upcoming for the history section.
            serverHistoryJobs = response.jobs.filter { !$0.isActiveWork && !$0.isUpcomingWork }
        } catch {
            // Soft-fail: filteredHistoryJobs falls back to client-side filter.
            serverHistoryJobs = nil
        }
    }

    /// Soft-fail preferred providers; property job history still works without it.
    @MainActor
    private func loadPreferredProviders(for jobs: [JobSummary]) async {
        // 1) Dedicated property-scoped API.
        do {
            let response = try await APIClient.shared.fetchPreferredProviders(forPropertyId: current.id)
            preferredProviders = PreferredProviderRollup.from(apiProviders: response.providers)
            return
        } catch {
            // Fall through to contract roll-up.
        }

        let jobIds = Set(jobs.map(\.id))
        guard !jobIds.isEmpty else {
            preferredProviders = []
            return
        }
        do {
            let response = try await APIClient.shared.fetchContracts(
                page: 1,
                pageSize: 100,
                status: "completed"
            )
            preferredProviders = PreferredProviderRollup.from(
                contracts: response.contracts,
                jobIds: jobIds
            )
        } catch {
            // Soft-fail: leave previous snapshot or empty.
            if preferredProviders.isEmpty {
                preferredProviders = []
            }
        }
    }
}


// MARK: - FR-19.3 history date window

private enum HistoryDateRange: String, CaseIterable, Identifiable {
    case all
    case days30
    case days90
    case year1

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .days30: return "30d"
        case .days90: return "90d"
        case .year1: return "1y"
        }
    }

    /// Inclusive lower bound for `created_at`; nil means no lower bound.
    var startDate: Date? {
        let days: Int?
        switch self {
        case .all: days = nil
        case .days30: days = 30
        case .days90: days = 90
        case .year1: days = 365
        }
        guard let days else { return nil }
        return Calendar.current.date(byAdding: .day, value: -days, to: Date())
    }
}

// MARK: - Edit property sheet (PUT /properties/{id})

struct EditPropertySheet: View {
    let property: PropertyItem
    var onSaved: (PropertyItem) -> Void
    var onCancel: () -> Void

    @State private var nickname: String
    @State private var notes: String
    @State private var isPrimary: Bool
    @State private var photoURLs: [String]
    @State private var isUploadingPhotos = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        property: PropertyItem,
        onSaved: @escaping (PropertyItem) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.property = property
        self.onSaved = onSaved
        self.onCancel = onCancel
        _nickname = State(initialValue: property.nickname ?? property.displayNickname)
        _notes = State(initialValue: property.notes ?? "")
        _isPrimary = State(initialValue: property.isPrimary == true)
        _photoURLs = State(initialValue: property.photoUrls ?? [])
    }

    private var canSubmit: Bool {
        !nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving && !isUploadingPhotos
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(property.addressLines, id: \.self) { line in
                        Text(line)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                } header: {
                    Text("Address (read-only)").brandSectionHeader()
                } footer: {
                    Text("Street address cannot be changed after create. Add a new property if the location moved.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                Section {
                    TextField("Nickname", text: $nickname, prompt: Text("Home, Office…"))
                        .textContentType(.nickname)
                        .textInputAutocapitalization(.words)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Property nickname")

                    Toggle("Primary property", isOn: $isPrimary)
                        .frame(minHeight: 44)
                        .tint(BrandTheme.accent)
                        .accessibilityHint("Marks this as the default address when posting jobs")
                } header: {
                    Text("Details").brandSectionHeader()
                }

                Section {
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Notes")
                } header: {
                    Text("Notes").brandSectionHeader()
                } footer: {
                    Text("Gate codes, parking tips, or unit details for providers — not shown publicly.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                PhotoPickSection(
                    context: .job,
                    maxCount: 5,
                    photoURLs: $photoURLs,
                    isUploading: $isUploadingPhotos,
                    errorMessage: $errorMessage,
                    sectionTitle: "Photos",
                    footerText: "Optional. Up to 5 exterior/access photos · JPEG/PNG/WebP · 10 MB each."
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
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Save changes")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(!canSubmit)
                }
            }
            .brandListBackground()
            .navigationTitle("Edit property")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        errorMessage = nil
        isSaving = true
        defer { isSaving = false }

        do {
            let updated = try await APIClient.shared.updateProperty(
                id: property.id,
                nickname: nickname.trimmingCharacters(in: .whitespacesAndNewlines),
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
                isPrimary: isPrimary,
                photoURLs: photoURLs
            )
            onSaved(updated)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        PropertyDetailView(
            property: PropertyItem(
                id: "preview-prop",
                userId: nil,
                nickname: "Lake House",
                notes: "Gate code 1234",
                isPrimary: true,
                address: PropertyAddress(
                    street: "1 Shore Rd",
                    city: "Austin",
                    state: "TX",
                    zipCode: "78701",
                    latitude: nil,
                    longitude: nil
                ),
                createdAt: nil
            )
        )
        .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
