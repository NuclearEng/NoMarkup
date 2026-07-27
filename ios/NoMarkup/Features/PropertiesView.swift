import SwiftUI

/// Customer saved service addresses — `GET|POST|DELETE /api/v1/properties`.
struct PropertiesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var properties: [PropertyItem] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var showAddSheet = false
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
        .toolbarBackground(.visible, for: .navigationBar)
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
                statusIsError = false
                statusMessage = "Added “\(created.displayNickname)”."
                showAddSheet = false
            } onCancel: {
                showAddSheet = false
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
                    propertyRow(property)
                        .listRowBackground(BrandTheme.navyElevated)
                }
                .onDelete { indexSet in
                    Task { await delete(at: indexSet) }
                }
            } header: {
                Text("\(properties.count) propert\(properties.count == 1 ? "y" : "ies")")
                    .brandSectionHeader()
            } footer: {
                Text("Addresses are used when posting reverse-auction jobs. Exact location is protected at rest on the server.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func propertyRow(_ property: PropertyItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(property.displayNickname)
                    .font(.headline)
                    .foregroundStyle(BrandTheme.textPrimary)
                ForEach(property.addressLines, id: \.self) { line in
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let notes = property.notes?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(2)
                }
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
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = properties.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            properties = try await APIClient.shared.fetchProperties().properties
        } catch {
            if properties.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func delete(at offsets: IndexSet) async {
        statusMessage = nil
        statusIsError = false
        for index in offsets {
            guard properties.indices.contains(index) else { continue }
            let property = properties[index]
            deletingID = property.id
            do {
                try await APIClient.shared.deleteProperty(id: property.id)
                properties.removeAll { $0.id == property.id }
            } catch {
                statusIsError = true
                statusMessage = error.localizedDescription
            }
            deletingID = nil
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
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Save property")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(!canSubmit)
                }
            }
            .brandListBackground()
            .navigationTitle("Add property")
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
