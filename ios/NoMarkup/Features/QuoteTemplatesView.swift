import SwiftUI

/// Provider reusable quote templates — list / create / delete.
///
/// APIs: `GET|POST /api/v1/providers/me/quote-templates`,
/// `DELETE /api/v1/providers/me/quote-templates/{id}`.
struct QuoteTemplatesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var templates: [QuoteTemplate] = []
    @State private var isLoading = false
    @State private var isCreating = false
    @State private var deletingID: String?
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var loadError: String?
    @State private var hasProviderRole = true

    @State private var showCreateSheet = false
    @State private var draftName = ""
    @State private var draftBody = ""
    @State private var draftAmountText = ""
    @State private var createError: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer.fill",
                    message: "Browse-only mode has no API token. Sign in with a real account to manage quote templates.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to create and reuse bid quote templates.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && templates.isEmpty && loadError == nil {
                BrandLoadingScreen(kind: .catalog, rows: 3, accessibilityLabel: "Loading templates…")
            } else if let loadError, templates.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load templates",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else if !hasProviderRole {
                BrandEmptyState(
                    title: "Provider role required",
                    systemImage: "wrench.and.screwdriver",
                    message: "Enable the provider role in Profile settings to manage quote templates.",
                    actionTitle: nil,
                    action: nil
                )
                .safeAreaInset(edge: .bottom) {
                    NavigationLink {
                        ProfileSettingsView()
                    } label: {
                        Text("Open Profile settings")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                    .accessibilityHint("Enable the provider role so you can manage quote templates")
                }
            } else if templates.isEmpty {
                BrandEmptyState(
                    title: "No quote templates",
                    systemImage: "doc.text",
                    message: "Save reusable bid wording and default amounts so you don’t retype the same quote on every job.",
                    actionTitle: "Create template",
                    action: { showCreateSheet = true }
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Quote templates")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .toolbar {
            if auth.isAuthenticated, !auth.isScaffoldSession, hasProviderRole {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        resetDraft()
                        showCreateSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .accessibilityLabel("Create quote template")
                    .disabled(isCreating)
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showCreateSheet) {
            createSheet
        }
    }

    private var listContent: some View {
        List {
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            Section {
                ForEach(templates) { template in
                    templateRow(template)
                        .listRowBackground(BrandTheme.navyElevated)
                        // DES.7 — swipe delete plus long-press context menu (VoiceOver / pointer / full-keyboard).
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { await deleteTemplate(template) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            .disabled(deletingID == template.id)
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { await deleteTemplate(template) }
                            } label: {
                                Label("Delete template", systemImage: "trash")
                            }
                            .disabled(deletingID == template.id)
                        }
                }
            } header: {
                Text(String(localized: "\(templates.count) templates")).brandSectionHeader()
            } footer: {
                Text("Templates are private to your account. Apply them when placing service bids on the web or job detail flows.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func templateRow(_ template: QuoteTemplate) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(template.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if deletingID == template.id {
                    ProgressView()
                        .tint(BrandTheme.accent)
                }
            }
            Text(template.displayBodyPreview)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .lineLimit(3)
            HStack(spacing: 12) {
                if let amount = template.displayDefaultAmount {
                    Text(amount)
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if let hours = template.defaultDurationHours {
                    Text("\(hours)h default")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer()
                Text(template.displayUseCount)
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    private var createSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $draftName, prompt: Text("e.g. Drain unclog standard"))
                        .textInputAutocapitalization(.sentences)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Template name")

                    TextField("Body", text: $draftBody, prompt: Text("Quote wording customers see"), axis: .vertical)
                        .lineLimit(4 ... 10)
                        .textInputAutocapitalization(.sentences)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Template body")
                } header: {
                    Text("Template").brandSectionHeader()
                } footer: {
                    Text("Name and body are required. Body max 4000 characters.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                Section {
                    DollarAmountField(
                        text: $draftAmountText,
                        placeholder: "Optional default amount",
                        accessibilityLabelText: "Optional default bid amount in dollars",
                        showParsedPreview: true
                    )
                } header: {
                    Text("Default amount (optional)").brandSectionHeader()
                } footer: {
                    Text("Leave blank if the amount varies by job. Dollars only — for example 150.00.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let createError {
                    Section {
                        Text(createError)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .brandListBackground()
            .navigationTitle("New template")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showCreateSheet = false
                    }
                    .disabled(isCreating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await createTemplate() }
                    } label: {
                        if isCreating {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(!canCreate || isCreating)
                }
            }
        }
        .tint(BrandTheme.accent)
    }

    private var canCreate: Bool {
        let name = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = draftBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !body.isEmpty, body.count <= 4000 else { return false }
        let amountTrimmed = draftAmountText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !amountTrimmed.isEmpty {
            return MoneyFormat.cents(fromDollarsText: amountTrimmed) != nil
        }
        return true
    }

    private func resetDraft() {
        draftName = ""
        draftBody = ""
        draftAmountText = ""
        createError = nil
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }

        isLoading = templates.isEmpty
        loadError = nil
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let list = try await APIClient.shared.fetchMyQuoteTemplates()
            templates = list
            hasProviderRole = true
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            templates = []
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            templates = []
            loadError = nil
        } catch {
            if templates.isEmpty {
                loadError = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func createTemplate() async {
        createError = nil
        let name = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = draftBody.trimmingCharacters(in: .whitespacesAndNewlines)
        let amountTrimmed = draftAmountText.trimmingCharacters(in: .whitespacesAndNewlines)
        var amountCents: Int64?
        if !amountTrimmed.isEmpty {
            guard let cents = MoneyFormat.cents(fromDollarsText: amountTrimmed) else {
                createError = "Enter a valid dollar amount (example 150.00)."
                return
            }
            amountCents = cents
        }

        isCreating = true
        defer { isCreating = false }

        do {
            let created = try await APIClient.shared.createQuoteTemplate(
                name: name,
                body: body,
                defaultAmountCents: amountCents,
                defaultDurationHours: nil
            )
            templates.insert(created, at: 0)
            statusMessage = "Template saved."
            errorMessage = nil
            showCreateSheet = false
            resetDraft()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            showCreateSheet = false
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            createError = "Provider role required."
        } catch {
            createError = error.localizedDescription
        }
    }

    @MainActor
    private func deleteTemplate(_ template: QuoteTemplate) async {
        errorMessage = nil
        statusMessage = nil
        deletingID = template.id
        defer { deletingID = nil }

        do {
            try await APIClient.shared.deleteQuoteTemplate(id: template.id)
            templates.removeAll { $0.id == template.id }
            statusMessage = "Template deleted."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        QuoteTemplatesView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
