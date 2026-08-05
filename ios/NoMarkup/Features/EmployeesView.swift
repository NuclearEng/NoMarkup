import SwiftUI

/// Provider team management — list / create / delete employees.
///
/// APIs: `GET|POST /api/v1/providers/me/employees`,
/// `DELETE /api/v1/providers/me/employees/{id}`.
/// Matches BrandTheme + 44pt targets. Roles mirror web: technician, lead,
/// manager, apprentice.
struct EmployeesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var employees: [ProviderEmployee] = []
    @State private var isLoading = false
    @State private var isCreating = false
    @State private var deletingID: String?
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var loadError: String?
    @State private var hasProviderRole = true

    @State private var showCreateSheet = false
    @State private var draftFirstName = ""
    @State private var draftLastName = ""
    @State private var draftEmail = ""
    @State private var draftPhone = ""
    @State private var draftRole = "technician"
    @State private var createError: String?

    private let roleOptions = ["technician", "lead", "manager", "apprentice"]

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.3",
                    message: "Browse-only mode has no API token. Sign in with a real account to manage your team.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to manage employees.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && employees.isEmpty && loadError == nil {
                ProgressView("Loading team…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let loadError, employees.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load team",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else if !hasProviderRole {
                BrandEmptyState(
                    title: "Provider role required",
                    systemImage: "wrench.and.screwdriver",
                    message: "Enable the provider role in Profile settings to manage employees.",
                    actionTitle: nil,
                    action: nil
                )
            } else if employees.isEmpty {
                BrandEmptyState(
                    title: "No team members",
                    systemImage: "person.badge.plus",
                    message: "Add technicians, leads, or apprentices so you can track licenses and background checks.",
                    actionTitle: "Add employee",
                    action: { showCreateSheet = true }
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Team")
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
                    .accessibilityLabel("Add employee")
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
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(employees) { employee in
                    employeeRow(employee)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await deleteEmployee(employee) }
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                            .disabled(deletingID == employee.id)
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { await deleteEmployee(employee) }
                            } label: {
                                Label("Remove employee", systemImage: "trash")
                            }
                            .disabled(deletingID == employee.id)
                        }
                }
            } header: {
                Text(String(localized: "\(employees.count) employees")).brandSectionHeader()
            } footer: {
                Text("Employee PII is encrypted at rest on the server. Removing a teammate is permanent.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    private func employeeRow(_ employee: ProviderEmployee) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(employee.displayName)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text(employee.displayRole)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                if let email = employee.email, !email.isEmpty {
                    Text(email)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if deletingID == employee.id {
                    ProgressView()
                        .tint(BrandTheme.accent)
                } else {
                    Text(employee.displayStatus)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 4)
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityElement(children: .combine)
    }

    private var createSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("First name", text: $draftFirstName)
                        .textContentType(.givenName)
                        .textInputAutocapitalization(.words)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("First name")

                    TextField("Last name", text: $draftLastName)
                        .textContentType(.familyName)
                        .textInputAutocapitalization(.words)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Last name")

                    TextField("Email (optional)", text: $draftEmail)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Email")

                    TextField("Phone (optional)", text: $draftPhone)
                        .textContentType(.telephoneNumber)
                        .keyboardType(.phonePad)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Phone")

                    Picker("Role", selection: $draftRole) {
                        ForEach(roleOptions, id: \.self) { role in
                            Text(role.capitalized).tag(role)
                        }
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Employee").brandSectionHeader()
                } footer: {
                    Text("First name, last name, and role are required.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let createError {
                    Section {
                        Text(createError)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .frame(minHeight: 44)
                    }
                }
            }
            .brandListBackground()
            .navigationTitle("Add employee")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showCreateSheet = false }
                        .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await createEmployee() }
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .frame(minHeight: 44)
                    .disabled(isCreating || !canCreate)
                }
            }
        }
    }

    private var canCreate: Bool {
        !draftFirstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draftLastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draftRole.isEmpty
    }

    private func resetDraft() {
        draftFirstName = ""
        draftLastName = ""
        draftEmail = ""
        draftPhone = ""
        draftRole = "technician"
        createError = nil
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            needsSignIn = true
            return
        }
        isLoading = employees.isEmpty
        loadError = nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            let list = try await APIClient.shared.fetchMyEmployees()
            employees = list
            hasProviderRole = true
            needsSignIn = false
        } catch let error as APIClientError {
            if case .httpStatus(401, _) = error {
                needsSignIn = true
                employees = []
                return
            }
            if case .httpStatus(403, _) = error {
                hasProviderRole = false
                employees = []
                return
            }
            if employees.isEmpty {
                loadError = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            if employees.isEmpty {
                loadError = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func createEmployee() async {
        guard canCreate, !isCreating else { return }
        isCreating = true
        createError = nil
        defer { isCreating = false }

        do {
            let created = try await APIClient.shared.createEmployee(
                firstName: draftFirstName,
                lastName: draftLastName,
                email: draftEmail.isEmpty ? nil : draftEmail,
                phone: draftPhone.isEmpty ? nil : draftPhone,
                role: draftRole
            )
            employees.insert(created, at: 0)
            showCreateSheet = false
            statusMessage = "Added \(created.displayName)."
            errorMessage = nil
        } catch {
            createError = error.localizedDescription
        }
    }

    @MainActor
    private func deleteEmployee(_ employee: ProviderEmployee) async {
        guard deletingID == nil else { return }
        deletingID = employee.id
        errorMessage = nil
        defer { deletingID = nil }

        do {
            try await APIClient.shared.deleteEmployee(id: employee.id)
            employees.removeAll { $0.id == employee.id }
            statusMessage = "Removed \(employee.displayName)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        EmployeesView()
            .environmentObject(AuthViewModel())
    }
}
