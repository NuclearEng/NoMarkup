import SwiftUI

/// Email resend + phone OTP verification (PRD FR-1.8 / FR-1.9).
/// Server still enforces gates on post/bid/transact; this surfaces the flows.
struct VerificationCenterView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var emailForResend = ""
    @State private var emailToken = ""
    @State private var phone = ""
    @State private var otpCode = ""
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var isBusy = false

    var body: some View {
        Form {
            Section {
                Text("Verify email and phone before posting jobs or transacting. Codes are delivered by the user service (SMS in environments with SMS configured).")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                TextField("Email", text: $emailForResend)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .listRowBackground(BrandTheme.navyElevated)
                Button {
                    Task { await resendEmail() }
                } label: {
                    if isBusy {
                        ProgressView().tint(BrandTheme.accent)
                    } else {
                        Text("Resend verification email")
                    }
                }
                .disabled(isBusy || emailForResend.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)

                TextField("Email verification token (from link)", text: $emailToken)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .listRowBackground(BrandTheme.navyElevated)
                Button("Submit email token") {
                    Task { await verifyEmailToken() }
                }
                .disabled(isBusy || emailToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Email").brandSectionHeader()
            } footer: {
                Text("Resend always returns a generic success (anti-enumeration). Paste the token from the email link if deep-link open is unavailable.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                TextField("Phone (E.164 preferred)", text: $phone)
                    .textContentType(.telephoneNumber)
                    .keyboardType(.phonePad)
                    .listRowBackground(BrandTheme.navyElevated)
                Button("Send SMS code") {
                    Task { await sendOTP() }
                }
                .disabled(isBusy || phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !auth.isAuthenticated)
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)

                TextField("OTP code", text: $otpCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .listRowBackground(BrandTheme.navyElevated)
                Button("Verify phone") {
                    Task { await verifyOTP() }
                }
                .disabled(isBusy || otpCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !auth.isAuthenticated)
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Phone").brandSectionHeader()
            } footer: {
                Text("Phone OTP requires a signed-in session. SMS delivery depends on gateway/user-service config.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
        }
        .brandListBackground()
        .navigationTitle("Verify account")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task {
            if emailForResend.isEmpty {
                let e = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
                if !e.isEmpty { emailForResend = e }
            }
        }
    }

    @MainActor
    private func resendEmail() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await APIClient.shared.resendEmailVerification(email: emailForResend)
            statusIsError = false
            statusMessage = "If an account exists for that email, a verification link was sent."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func verifyEmailToken() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await APIClient.shared.verifyEmail(token: emailToken)
            statusIsError = false
            statusMessage = "Email verified."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func sendOTP() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await APIClient.shared.sendPhoneOTP(phone: phone)
            statusIsError = false
            statusMessage = "OTP send requested. Check your phone when SMS is configured."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func verifyOTP() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await APIClient.shared.verifyPhone(otpCode: otpCode)
            statusIsError = false
            statusMessage = "Phone verified."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}
