import SwiftUI

/// FR-19.3 — per-property job history drill-in.
/// Loads `GET /api/v1/jobs/mine?property_id=` via `APIClient.fetchJobs(propertyId:)`.
struct PropertyDetailView: View {
    @EnvironmentObject private var auth: AuthViewModel

    let property: PropertyItem
    var onUpdated: ((PropertyItem) -> Void)?

    @State private var current: PropertyItem
    @State private var jobs: [JobSummary] = []
    @State private var isLoadingJobs = false
    @State private var jobsError: String?
    @State private var showEditSheet = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

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
                if !activeJobs.isEmpty {
                    jobSection(title: "Active (\(activeJobs.count))", jobs: activeJobs)
                }
                if !upcomingJobs.isEmpty {
                    jobSection(title: "Upcoming (\(upcomingJobs.count))", jobs: upcomingJobs)
                }
                if !historyJobs.isEmpty {
                    jobSection(title: "History (\(historyJobs.count))", jobs: historyJobs)
                }
            }
        }
        .brandListBackground()
        .navigationTitle(current.displayNickname)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
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
        .task { await loadJobs() }
        .refreshable { await loadJobs() }
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

    private var propertyHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(current.displayNickname)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                if current.isPrimary == true {
                    Text("PRIMARY")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.navy)
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

    @MainActor
    private func loadJobs() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingJobs = jobs.isEmpty
        jobsError = nil
        defer { isLoadingJobs = false }

        do {
            let response = try await APIClient.shared.fetchJobs(propertyId: current.id, pageSize: 100)
            jobs = response.jobs
        } catch {
            if jobs.isEmpty {
                jobsError = error.localizedDescription
            }
        }
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
    }

    private var canSubmit: Bool {
        !nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving
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
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Save changes")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(!canSubmit)
                }
            }
            .brandListBackground()
            .navigationTitle("Edit property")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
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
                isPrimary: isPrimary
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
