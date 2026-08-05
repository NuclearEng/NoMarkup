import SwiftUI

/// Saved marketplace search alerts — `GET|POST|DELETE /api/v1/me/saved-searches`.
struct SavedSearchesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var searches: [SavedSearch] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var deletingID: String?

    @State private var newName = ""
    @State private var newQuery = ""
    @State private var alertFrequency = "daily"
    @State private var isCreating = false

    private let frequencies = ["instant", "daily", "weekly", "off"]

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to save marketplace searches and get alert emails when new matches appear.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to manage saved searches."
                )
            } else if isLoading && searches.isEmpty {
                ProgressView("Loading saved searches…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, searches.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load saved searches",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
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
                        TextField("Name", text: $newName)
                            .textContentType(.none)
                            .autocorrectionDisabled()
                            .frame(minHeight: 44)
                            .accessibilityLabel("Saved search name")

                        TextField("Search keywords", text: $newQuery)
                            .textContentType(.none)
                            .autocorrectionDisabled()
                            .frame(minHeight: 44)
                            .accessibilityLabel("Search query keywords")

                        Picker("Alert frequency", selection: $alertFrequency) {
                            ForEach(frequencies, id: \.self) { freq in
                                Text(freq.capitalized).tag(freq)
                            }
                        }
                        .frame(minHeight: 44)

                        Button {
                            Task { await create() }
                        } label: {
                            if isCreating {
                                ProgressView()
                                    .tint(BrandTheme.ctaLabelOnGold)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            } else {
                                Text("Save search")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.accent)
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .disabled(
                            isCreating
                                || newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                    } header: {
                        Text("New saved search").brandSectionHeader()
                    } footer: {
                        Text("We’ll match new local listings against your keywords and alert you on the schedule you pick.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }

                    Section {
                        if searches.isEmpty {
                            Text("No saved searches yet.")
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .frame(minHeight: 44)
                                .listRowBackground(BrandTheme.navyElevated)
                        } else {
                            ForEach(searches) { search in
                                searchRow(search)
                                    .listRowBackground(BrandTheme.navyElevated)
                                    // DES.7 — swipe/Edit delete plus long-press context menu
                                    // (VoiceOver / pointer / full-keyboard).
                                    .contextMenu {
                                        Button(role: .destructive) {
                                            Task { await delete(search) }
                                        } label: {
                                            Label("Delete saved search", systemImage: "trash")
                                        }
                                        .disabled(deletingID == search.id)
                                    }
                            }
                            .onDelete { indexSet in
                                Task { await delete(at: indexSet) }
                            }
                        }
                    } header: {
                        Text("Yours").brandSectionHeader()
                    }
                }
                .brandListBackground()
                // DES.7 — non-gesture delete affordance: Edit mode exposes per-row
                // delete buttons for the `.onDelete` rows above.
                .toolbar {
                    if !searches.isEmpty {
                        ToolbarItem(placement: .topBarTrailing) {
                            EditButton()
                                .frame(minHeight: 44)
                        }
                    }
                }
            }
        }
        .navigationTitle("Saved searches")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func searchRow(_ search: SavedSearch) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(search.displayName)
                    .font(.headline)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(search.query?.displayQuery ?? "All listings")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .lineLimit(2)
                Text("Alerts · \(search.displayFrequency)")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.bidActive.opacity(0.9))
            }
            Spacer(minLength: 8)
            if deletingID == search.id {
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
        isLoading = searches.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            searches = try await APIClient.shared.fetchSavedSearches()
        } catch {
            if searches.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func create() async {
        statusMessage = nil
        statusIsError = false
        isCreating = true
        defer { isCreating = false }

        do {
            let created = try await APIClient.shared.createSavedSearch(
                name: newName,
                query: newQuery,
                alertFrequency: alertFrequency
            )
            searches.insert(created, at: 0)
            newName = ""
            newQuery = ""
            statusIsError = false
            statusMessage = "Saved “\(created.displayName)”."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(at offsets: IndexSet) async {
        for index in offsets {
            guard searches.indices.contains(index) else { continue }
            await delete(searches[index])
        }
    }

    @MainActor
    private func delete(_ search: SavedSearch) async {
        statusMessage = nil
        statusIsError = false
        deletingID = search.id
        defer { deletingID = nil }

        do {
            try await APIClient.shared.deleteSavedSearch(id: search.id)
            searches.removeAll { $0.id == search.id }
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        SavedSearchesView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
