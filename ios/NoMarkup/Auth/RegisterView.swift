import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?

    private enum Field {
        case displayName
        case email
        case password
        case confirmPassword
    }

    @State private var displayName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    /// FR-1.2 — Customer / Provider / Both (not customer-only + optional toggle).
    private enum SignupRole: String, CaseIterable, Identifiable {
        case customer = "Customer"
        case provider = "Provider"
        case both = "Both"
        var id: String { rawValue }
    }

    @State private var signupRole: SignupRole = .customer

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                formFields
                rolePicker
                actions
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .background(BrandTheme.navy.ignoresSafeArea())
        .navigationTitle("Create account")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .onChange(of: auth.isAuthenticated) { _, signedIn in
            if signedIn && !auth.isScaffoldSession {
                dismiss()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Join NoMarkup")
                .font(.title2.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
            Text("Create a free account to post jobs, bid on goods, and message with escrow protection.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var formFields: some View {
        VStack(spacing: 12) {
            TextField("Display name", text: $displayName)
                .textContentType(.name)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .displayName)
                .submitLabel(.next)
                .onSubmit { focusedField = .email }
                .accessibilityLabel("Display name")

            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .email)
                .submitLabel(.next)
                .onSubmit { focusedField = .password }
                .accessibilityLabel("Email")

            SecureField("Password", text: $password)
                .textContentType(.newPassword)
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .password)
                .submitLabel(.next)
                .onSubmit { focusedField = .confirmPassword }
                .accessibilityLabel("Password")

            SecureField("Confirm password", text: $confirmPassword)
                .textContentType(.newPassword)
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .confirmPassword)
                .submitLabel(.go)
                .onSubmit { Task { await submit() } }
                .accessibilityLabel("Confirm password")

            Text("At least 8 characters with letters and a number or symbol.")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
        }
    }

    private var rolePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("I want to…")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(BrandTheme.textPrimary)
            Picker("Account type", selection: $signupRole) {
                ForEach(SignupRole.allCases) { role in
                    Text(role.rawValue).tag(role)
                }
            }
            .pickerStyle(.segmented)
            .frame(minHeight: 44)
            .accessibilityLabel("Account type")
            .accessibilityHint("Customer posts jobs and buys goods. Provider bids and sells. Both enables both roles.")

            Text(roleHelpCopy)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
        .overlay(fieldStroke)
    }

    private var roleHelpCopy: String {
        switch signupRole {
        case .customer:
            return "Post reverse-auction jobs, shop the marketplace, and pay through escrow. You can enable provider later in Profile."
        case .provider:
            return "Bid on service jobs and sell goods. You can enable customer later if you need to hire help."
        case .both:
            return "Full dual-role account: hire providers and offer services or goods yourself."
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                Task { await submit() }
            } label: {
                Group {
                    if auth.isLoading {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    } else {
                        Text("Create account")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .disabled(auth.isLoading)
            .accessibilityLabel("Create account")

            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Error: \(error)")
            }

            if let status = auth.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button("Already have an account? Sign in") {
                dismiss()
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(BrandTheme.goldBright)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .accessibilityLabel("Back to sign in")
        }
    }

    private var fieldStroke: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
    }

    private func submit() async {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            auth.errorMessage = "Enter a display name."
            return
        }
        guard !mail.isEmpty else {
            auth.errorMessage = "Enter your email."
            return
        }
        guard password.count >= 8 else {
            auth.errorMessage = "Password must be at least 8 characters."
            return
        }
        guard password == confirmPassword else {
            auth.errorMessage = "Passwords do not match."
            return
        }

        let roles: [String]
        switch signupRole {
        case .customer:
            roles = ["customer"]
        case .provider:
            roles = ["provider"]
        case .both:
            roles = ["customer", "provider"]
        }

        // Mirror credentials into the shared auth fields so login state stays consistent.
        auth.email = mail
        await auth.register(
            email: mail,
            password: password,
            displayName: name,
            roles: roles
        )
    }
}

#Preview {
    NavigationStack {
        RegisterView()
            .environmentObject(AuthViewModel())
    }
}
