import SwiftUI

/// Customer multi-property dashboard — FR-19.
/// List / add / edit / delete via `GET|POST|PUT|DELETE /api/v1/properties`.
/// Summary active/upcoming counts via `GET /api/v1/jobs/mine?property_id=`.
struct PropertiesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var properties: [PropertyItem] = []
    @State private var jobCounts: [String: PropertyJobCounts] = [:]
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var showAddSheet = false
    @State private var editingProperty: PropertyItem?
    @State private var deletingID: String?

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to save property addresses for reverse-auction service jobs.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to manage properties."
                )
            } else if isLoading && properties.isEmpty {
                ProgressView("Loading properties…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, properties.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load properties",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if properties.isEmpty {
                BrandEmptyState(
                    title: "No properties yet",
                    systemImage: "house",
                    message: "Save home and site addresses so job posts can reuse them. Swipe to delete when a place is no longer yours.",
                    actionTitle: "Add property"
                ) {
                    showAddSheet = true
                }
            } else {
                listContent
            }
        }
        .navigationTitle("Properties")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddSheet = true
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .frame(minHeight: 44)
                .disabled(!auth.isAuthenticated || auth.isScaffoldSession)
                .accessibilityHint("Add a saved property address")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showAddSheet) {
            AddPropertySheet { created in
                properties.insert(created, at: 0)
                jobCounts[created.id] = PropertyJobCounts()
                statusIsError = false
                statusMessage = "Added “\(created.displayNickname)”."
                showAddSheet = false
            } onCancel: {
                showAddSheet = false
            }
        }
        .sheet(item: $editingProperty) { property in
            EditPropertySheet(property: property) { updated in
                applyUpdated(updated)
                statusIsError = false
                statusMessage = "Updated “\(updated.displayNickname)”."
                editingProperty = nil
            } onCancel: {
                editingProperty = nil
            }
        }
    }

    private var listContent: some View {
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
                ForEach(properties) { property in
                    NavigationLink {
                        PropertyDetailView(property: property) { updated in
                            applyUpdated(updated)
                        }
                    } label: {
                        propertyRow(property)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint("Opens property detail and job history")
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            Task { await delete(property) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button {
                            editingProperty = property
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .tint(BrandTheme.accent)
                    }
                    // DES.7 — non-gesture mirror of the swipe-only edit/delete
                    // (VoiceOver / pointer / full-keyboard).
                    .contextMenu {
                        Button {
                            editingProperty = property
                        } label: {
                            Label("Edit property", systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            Task { await delete(property) }
                        } label: {
                            Label("Delete property", systemImage: "trash")
                        }
                        .disabled(deletingID == property.id)
                    }
                }
                .onDelete { indexSet in
                    Task { await delete(at: indexSet) }
                }
            } header: {
                Text(String(localized: "\(properties.count) properties"))
                    .brandSectionHeader()
            } footer: {
                Text("Tap a property for job history. Active and upcoming counts use jobs linked to that address. PostJob still lets you pick which property a new auction is for.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func propertyRow(_ property: PropertyItem) -> some View {
        let counts = jobCounts[property.id] ?? PropertyJobCounts()
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(property.displayNickname)
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    if property.isPrimary == true {
                        Text("PRIMARY")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.ctaLabelOnGold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(BrandTheme.accent, in: Capsule())
                    }
                }
                ForEach(property.addressLines, id: \.self) { line in
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let notes = property.notesDisplay {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(2)
                }
                HStack(spacing: 10) {
                    countBadge(label: "Active", count: counts.active, emphasize: counts.active > 0)
                    countBadge(label: "Upcoming", count: counts.upcoming, emphasize: counts.upcoming > 0)
                }
                .padding(.top, 2)
            }
            Spacer(minLength: 8)
            if deletingID == property.id {
                ProgressView()
                    .tint(BrandTheme.accent)
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: property, counts: counts))
    }

    private func countBadge(label: String, count: Int, emphasize: Bool) -> some View {
        Text("\(label) \(count)")
            .font(.caption2.weight(.semibold).monospacedDigit())
            .foregroundStyle(emphasize ? BrandTheme.goldBright : BrandTheme.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                (emphasize ? BrandTheme.goldBright.opacity(0.12) : BrandTheme.navy.opacity(0.35)),
                in: Capsule()
            )
    }

    private func accessibilityLabel(for property: PropertyItem, counts: PropertyJobCounts) -> String {
        var parts = [property.displayNickname]
        parts.append(contentsOf: property.addressLines)
        if let notes = property.notesDisplay {
            parts.append(notes)
        }
        parts.append("\(counts.active) active jobs")
        parts.append("\(counts.upcoming) upcoming jobs")
        return parts.joined(separator: ", ")
    }

    private func applyUpdated(_ updated: PropertyItem) {
        if let idx = properties.firstIndex(where: { $0.id == updated.id }) {
            properties[idx] = updated
        }
        // Primary flag is exclusive server-side for many backends — re-clear others locally.
        if updated.isPrimary == true {
            for i in properties.indices where properties[i].id != updated.id {
                if properties[i].isPrimary == true {
                    properties[i].isPrimary = false
                }
            }
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = properties.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            properties = try await APIClient.shared.fetchProperties().properties
            await loadJobCounts(for: properties)
        } catch {
            if properties.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Fetches per-property job lists in parallel (`jobs/mine?property_id=`) and derives active/upcoming counts.
    @MainActor
    private func loadJobCounts(for properties: [PropertyItem]) async {
        guard !properties.isEmpty else {
            jobCounts = [:]
            return
        }

        var next: [String: PropertyJobCounts] = [:]
        await withTaskGroup(of: (String, PropertyJobCounts).self) { group in
            for property in properties {
                group.addTask {
                    do {
                        let response = try await APIClient.shared.fetchJobs(
                            propertyId: property.id,
                            pageSize: 100
                        )
                        return (property.id, PropertyJobCounts.from(jobs: response.jobs))
                    } catch {
                        return (property.id, PropertyJobCounts())
                    }
                }
            }
            for await (id, counts) in group {
                next[id] = counts
            }
        }
        jobCounts = next
    }

    @MainActor
    private func delete(at offsets: IndexSet) async {
        for index in offsets {
            guard properties.indices.contains(index) else { continue }
            await delete(properties[index])
        }
    }

    @MainActor
    private func delete(_ property: PropertyItem) async {
        statusMessage = nil
        statusIsError = false
        deletingID = property.id
        defer { deletingID = nil }

        do {
            try await APIClient.shared.deleteProperty(id: property.id)
            properties.removeAll { $0.id == property.id }
            jobCounts.removeValue(forKey: property.id)
            statusIsError = false
            statusMessage = "Removed “\(property.displayNickname)”."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Add property sheet

private struct AddPropertySheet: View {
    var onCreated: (PropertyItem) -> Void
    var onCancel: () -> Void

    @State private var nickname = ""
    @State private var street = ""
    @State private var city = ""
    @State private var state = ""
    @State private var zip = ""
    @State private var notes = ""
    @State private var isCreating = false
    @State private var errorMessage: String?

    private var canSubmit: Bool {
        !nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !street.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !state.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !zip.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isCreating
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nickname", text: $nickname, prompt: Text("Home, Office…"))
                        .textContentType(.nickname)
                        .textInputAutocapitalization(.words)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Property nickname")

                    TextField("Street", text: $street)
                        .textContentType(.streetAddressLine1)
                        .textInputAutocapitalization(.words)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Street address")

                    TextField("City", text: $city)
                        .textContentType(.addressCity)
                        .textInputAutocapitalization(.words)
                        .frame(minHeight: 44)
                        .accessibilityLabel("City")

                    TextField("State", text: $state)
                        .textContentType(.addressState)
                        .textInputAutocapitalization(.characters)
                        .frame(minHeight: 44)
                        .accessibilityLabel("State")

                    TextField("ZIP", text: $zip)
                        .textContentType(.postalCode)
                        .keyboardType(.numbersAndPunctuation)
                        .frame(minHeight: 44)
                        .accessibilityLabel("ZIP code")
                } header: {
                    Text("Address").brandSectionHeader()
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
                        Task { await create() }
                    } label: {
                        if isCreating {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Save property")
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
            .navigationTitle("Add property")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func create() async {
        errorMessage = nil
        isCreating = true
        defer { isCreating = false }

        let notesTrimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let created = try await APIClient.shared.createProperty(
                nickname: nickname.trimmingCharacters(in: .whitespacesAndNewlines),
                street: street.trimmingCharacters(in: .whitespacesAndNewlines),
                city: city.trimmingCharacters(in: .whitespacesAndNewlines),
                state: state.trimmingCharacters(in: .whitespacesAndNewlines),
                zip: zip.trimmingCharacters(in: .whitespacesAndNewlines),
                notes: notesTrimmed
            )
            onCreated(created)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        PropertiesView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
