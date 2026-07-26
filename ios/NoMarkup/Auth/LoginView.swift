import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @FocusState private var focusedField: Field?

    private enum Field {
        case email
        case password
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    credentialForm
                    primaryActions
                    divider
                    SignInWithAppleButtonView { result in
                        auth.handleSignInWithApple(result: result)
                    }
                    scaffoldBypass
                    footerLegal
                }
                .padding(24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Sign in")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(AppConfig.appDisplayName)
                .font(.largeTitle.weight(.bold))
            Text("Local services marketplace — jobs reverse-auction, goods forward-auction. Native chrome scaffold (not a web wrapper).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var credentialForm: some View {
        VStack(spacing: 12) {
            TextField("Email", text: $auth.email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                .focused($focusedField, equals: .email)
                .submitLabel(.next)
                .onSubmit { focusedField = .password }

            SecureField("Password", text: $auth.password)
                .textContentType(.password)
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit {
                    Task { await auth.login() }
                }
        }
    }

    private var primaryActions: some View {
        VStack(spacing: 12) {
            Button {
                Task { await auth.login() }
            } label: {
                Group {
                    if auth.isLoading {
                        // Dark spinner for contrast on brand-gold filled button.
                        ProgressView()
                            .tint(Color.primary)
                    } else {
                        Text("Sign in")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color("AccentColor"))
            .disabled(auth.isLoading)
            .accessibilityLabel("Sign in with email and password")

            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Error: \(error)")
            }

            if let status = auth.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("API: \(AppConfig.apiBaseURLString)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .textSelection(.enabled)
        }
    }

    private var divider: some View {
        HStack {
            Rectangle().frame(height: 1).foregroundStyle(.quaternary)
            Text("or")
                .font(.caption)
                .foregroundStyle(.secondary)
            Rectangle().frame(height: 1).foregroundStyle(.quaternary)
        }
    }

    private var scaffoldBypass: some View {
        Button("Browse native chrome (scaffold)") {
            auth.enterScaffoldSession()
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 44)
        .font(.subheadline)
        .accessibilityHint("Opens the tab shell without calling the API. For design and layout review only.")
    }

    private var footerLegal: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("By continuing you agree to NoMarkup’s Terms and acknowledge the Privacy Policy.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 16) {
                Link("Privacy", destination: AppConfig.privacyURL)
                Link("Terms", destination: AppConfig.termsURL)
            }
            .font(.caption.weight(.medium))
        }
        .padding(.top, 8)
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthViewModel())
}
