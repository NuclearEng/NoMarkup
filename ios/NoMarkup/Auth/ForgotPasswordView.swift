import SwiftUI

struct ForgotPasswordView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?

    private enum Field {
        case email
        case token
        case newPassword
        case confirmPassword
    }

    @State private var email = ""
    @State private var resetToken = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    /// When true, show the token + new-password form (after request or if user has a link token).
    @State private var showResetForm = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                requestSection
                if showResetForm {
                    resetSection
                } else {
                    Button("I already have a reset token") {
                        showResetForm = true
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(minHeight: 44)
                }
                messages
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .background(BrandTheme.navy.ignoresSafeArea())
        .navigationTitle("Reset password")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .onAppear {
            if email.isEmpty, !auth.email.isEmpty {
                email = auth.email
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Forgot your password?")
                .font(.title2.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
            Text("We’ll email a reset link if an account exists for that address. You can also paste a token from the email and set a new password here.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var requestSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Request reset email")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(BrandTheme.goldBright)

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
                .submitLabel(.go)
                .onSubmit { Task { await requestReset() } }
                .accessibilityLabel("Email for password reset")

            Button {
                Task { await requestReset() }
            } label: {
                Group {
                    if auth.isLoading && !showResetForm {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    } else {
                        Text("Send reset email")
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
            .accessibilityLabel("Send password reset email")
        }
    }

    private var resetSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set new password")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(BrandTheme.goldBright)

            TextField("Reset token", text: $resetToken)
                .textContentType(.oneTimeCode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .token)
                .submitLabel(.next)
                .onSubmit { focusedField = .newPassword }
                .accessibilityLabel("Password reset token")

            SecureField("New password", text: $newPassword)
                .textContentType(.newPassword)
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .newPassword)
                .submitLabel(.next)
                .onSubmit { focusedField = .confirmPassword }
                .accessibilityLabel("New password")

            SecureField("Confirm new password", text: $confirmPassword)
                .textContentType(.newPassword)
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .focused($focusedField, equals: .confirmPassword)
                .submitLabel(.go)
                .onSubmit { Task { await submitNewPassword() } }
                .accessibilityLabel("Confirm new password")

            Text("At least 8 characters with letters and a number or symbol.")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))

            Button {
                Task { await submitNewPassword() }
            } label: {
                Group {
                    if auth.isLoading {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    } else {
                        Text("Update password")
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
            .accessibilityLabel("Update password with reset token")
        }
    }

    private var messages: some View {
        VStack(alignment: .leading, spacing: 12) {
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
                    .foregroundStyle(BrandTheme.success)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button("Back to sign in") {
                dismiss()
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(BrandTheme.goldBright)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
        }
    }

    private var fieldStroke: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
    }

    private func requestReset() async {
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !mail.isEmpty else {
            auth.errorMessage = "Enter your email."
            return
        }
        await auth.requestPasswordReset(email: mail)
        if auth.errorMessage == nil {
            showResetForm = true
        }
    }

    private func submitNewPassword() async {
        let token = resetToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            auth.errorMessage = "Paste the reset token from your email."
            return
        }
        guard newPassword.count >= 8 else {
            auth.errorMessage = "Password must be at least 8 characters."
            return
        }
        guard newPassword == confirmPassword else {
            auth.errorMessage = "Passwords do not match."
            return
        }
        await auth.resetPassword(token: token, newPassword: newPassword)
        if auth.errorMessage == nil {
            // Clear sensitive fields after success.
            newPassword = ""
            confirmPassword = ""
            resetToken = ""
        }
    }
}

#Preview {
    NavigationStack {
        ForgotPasswordView()
            .environmentObject(AuthViewModel())
    }
}
