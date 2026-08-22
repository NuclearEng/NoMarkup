import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var featureFlags: FeatureFlags
    @StateObject private var passkeyAuth = PasskeyAuth()
    @FocusState private var focusedField: Field?

    private enum Field {
        case email
        case password
        case mfaCode
    }

    /// XCUITest / sim role launches: hide SIWA / passkey / Google / Facebook so the
    /// Simulator "Sign in to your Apple Account" sheet cannot cover the email form.
    /// Production and regular DEBUG dogfood still show every provider.
    private var hideExternalAuth: Bool {
        #if DEBUG
        LaunchTestAuth.isUITestLaunch
        #else
        false
        #endif
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    if auth.needsMFA {
                        mfaForm
                    } else {
                        credentialForm
                        primaryActions
                        authLinks
                        divider
                        // IOS-SEC.3: passkey entry is hidden entirely until the server
                        // `passkeys` flag is on — never a dead-end "coming soon" button.
                        if !hideExternalAuth, PasskeyAuth.isEnabled(in: featureFlags) {
                            passkeyButton
                        }
                        if !hideExternalAuth {
                            SignInWithAppleButtonView { result, nonce in
                                auth.handleSignInWithApple(result: result, nonce: nonce)
                            }
                            .disabled(auth.isBusy || passkeyAuth.isBusy)
                            .opacity(auth.isBusy || passkeyAuth.isBusy ? 0.55 : 1)
                            .allowsHitTesting(!auth.isBusy && !passkeyAuth.isBusy)
                            if AppConfig.isGoogleSignInConfigured {
                                GoogleSignInButton(isBusy: auth.isBusy || passkeyAuth.isBusy) {
                                    guard !auth.isBusy, !passkeyAuth.isBusy else { return }
                                    Task { await auth.signInWithGoogle() }
                                }
                            }
                            if AppConfig.isFacebookSignInConfigured {
                                FacebookSignInButton(isBusy: auth.isBusy || passkeyAuth.isBusy) {
                                    guard !auth.isBusy, !passkeyAuth.isBusy else { return }
                                    Task { await auth.signInWithFacebook() }
                                }
                            }
                        }
                        #if DEBUG
                        scaffoldBypass
                        #endif
                    }
                    footerLegal
                }
                .padding(24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .background(BrandTheme.navy.ignoresSafeArea())
            .navigationTitle(auth.needsMFA ? "Two-factor" : "Sign in")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .brandNavigationBarChrome()
            .navigationDestination(for: AuthRoute.self) { route in
                switch route {
                case .register:
                    RegisterView()
                case .forgotPassword:
                    ForgotPasswordView()
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                NoMarkupIcon(showWordmark: false, size: 56)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    (
                        Text("No")
                            .foregroundColor(BrandTheme.textPrimary)
                        + Text("Markup")
                            .foregroundColor(BrandTheme.goldBright)
                    )
                    .font(.largeTitle.weight(.heavy))
                    .accessibilityLabel("NoMarkup")
                }
            }

            if auth.needsMFA {
                Text("Two-factor authentication")
                    .font(.system(.title3, design: .serif).weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text("Enter the 6-digit code from your authenticator app to finish signing in.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                (
                    Text("The Market Sets The Price.\n")
                        .foregroundColor(BrandTheme.textPrimary)
                    + Text("Not The Markup.")
                        .foregroundColor(BrandTheme.goldBright)
                        .italic()
                )
                .font(.system(.title3, design: .serif).weight(.regular))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("The Market Sets The Price. Not The Markup.")

                Text("Reverse-auction services. Local goods with escrow. Fair market rates — everyone wins except the middleman.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
                .accessibilityIdentifier("login.email")
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
                )
                .focused($focusedField, equals: .email)
                .submitLabel(.next)
                .onSubmit { focusedField = .password }
                .disabled(auth.isBusy)

            SecureField("Password", text: $auth.password)
                .textContentType(.password)
                .accessibilityIdentifier("login.password")
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
                )
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit {
                    guard !auth.isBusy else { return }
                    Task { await auth.login() }
                }
                .disabled(auth.isBusy)
        }
    }

    private var mfaForm: some View {
        VStack(spacing: 12) {
            TextField("Authenticator code", text: $auth.mfaCode)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
                )
                .focused($focusedField, equals: .mfaCode)
                .submitLabel(.go)
                .onSubmit {
                    guard !auth.isBusy else { return }
                    Task { await auth.verifyMFA() }
                }
                .disabled(auth.isBusy)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") {
                            focusedField = nil
                            guard !auth.isBusy else { return }
                            Task { await auth.verifyMFA() }
                        }
                        .fontWeight(.semibold)
                        .disabled(auth.isBusy)
                    }
                }
                .accessibilityLabel("Authenticator code")
                .accessibilityIdentifier("login.mfaCode")

            Button {
                guard !auth.isBusy else { return }
                BrandHaptics.medium()
                Task { await auth.verifyMFA() }
            } label: {
                Group {
                    if auth.isBusy {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    } else {
                        Text("Verify and sign in")
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .brandPrimaryButton()
            .disabled(auth.isBusy)
            .accessibilityLabel("Verify authenticator code and sign in")
            .accessibilityIdentifier("login.mfaSubmit")

            Button("Back to sign in") {
                auth.cancelMFA()
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(BrandTheme.goldBright)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .disabled(auth.isBusy)
            .accessibilityIdentifier("login.mfaBack")

            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Error: \(error)")
                    .accessibilityIdentifier("login.mfaError")
            }

            if let status = auth.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("login.mfaStatus")
            }
        }
    }

    private var primaryActions: some View {
        VStack(spacing: 12) {
            Button {
                guard !auth.isBusy else { return }
                BrandHaptics.medium()
                Task { await auth.login() }
            } label: {
                Group {
                    if auth.isBusy {
                        // Dark spinner for contrast on brand-gold filled button.
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    } else {
                        Text("Sign in")
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .brandPrimaryButton()
            .disabled(auth.isBusy)
            .accessibilityIdentifier("login.submit")
            .accessibilityLabel("Sign in with email and password")

            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Error: \(error)")
                    .accessibilityIdentifier("login.error")
            }

            if let status = auth.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("login.status")
            }

            // Host only — never full base URL (avoids leaking path/query/credentials in UI).
            Text("API: \(AppConfig.apiBaseHostDisplay)")
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))
                .textSelection(.enabled)
                .accessibilityHidden(true)
        }
    }

    private var authLinks: some View {
        HStack(spacing: 16) {
            NavigationLink(value: AuthRoute.register) {
                Text("Create account")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(minHeight: 44)
            }
            .accessibilityLabel("Create account")
            .accessibilityIdentifier("login.register")
            .disabled(auth.isBusy)

            Spacer(minLength: 8)

            NavigationLink(value: AuthRoute.forgotPassword) {
                Text("Forgot password?")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(minHeight: 44)
            }
            .accessibilityLabel("Forgot password")
            .accessibilityIdentifier("login.forgotPassword")
            .disabled(auth.isBusy)
        }
    }

    private var divider: some View {
        HStack {
            Rectangle().frame(height: 1).foregroundStyle(BrandTheme.gold.opacity(0.2))
            Text("or")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
            Rectangle().frame(height: 1).foregroundStyle(BrandTheme.gold.opacity(0.2))
        }
    }

    /// Passkey entry (IOS-SEC.2). Rendered only when the server `passkeys` flag is on.
    private var passkeyButton: some View {
        VStack(spacing: 8) {
            Button {
                guard !auth.isBusy, !passkeyAuth.isBusy else { return }
                Task {
                    await passkeyAuth.signInWithPasskey(email: auth.email)
                    if passkeyAuth.didCompleteSignIn {
                        passkeyAuth.consumeSignInFlag()
                        auth.adoptExistingSession(status: "Signed in with passkey.")
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    if passkeyAuth.isBusy {
                        ProgressView()
                            .tint(BrandTheme.goldBright)
                    } else {
                        Image(systemName: "person.badge.key.fill")
                            .font(.body.weight(.semibold))
                    }
                    Text("Sign in with Passkey")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .buttonStyle(.bordered)
            .tint(BrandTheme.goldBright)
            .disabled(auth.isBusy || passkeyAuth.isBusy)
            .accessibilityIdentifier("login.passkey")
            .accessibilityLabel("Sign in with Passkey")
            .accessibilityHint("Uses a passkey stored on this device or iCloud Keychain")

            if let status = passkeyAuth.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = passkeyAuth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var scaffoldBypass: some View {
        Button("Browse without signing in") {
            guard !auth.isBusy, !passkeyAuth.isBusy else { return }
            auth.enterScaffoldSession()
        }
        .font(.subheadline)
        .foregroundStyle(BrandTheme.goldBright)
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
        .disabled(auth.isBusy || passkeyAuth.isBusy)
        .opacity(auth.isBusy || passkeyAuth.isBusy ? 0.55 : 1)
        .accessibilityHint("Opens the tab shell without calling the API. For design and layout review only.")
        .accessibilityIdentifier("login.scaffold")
    }

    private var footerLegal: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("By continuing you agree to NoMarkup’s Terms and acknowledge the Privacy Policy.")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
            HStack(spacing: 16) {
                Link("Privacy", destination: AppConfig.privacyURL)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("login.privacy")
                Link("Terms", destination: AppConfig.termsURL)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("login.terms")
            }
            .font(.caption.weight(.medium))
            .tint(BrandTheme.accent)
        }
        .padding(.top, 8)
    }
}

/// Navigation routes from the login shell.
private enum AuthRoute: Hashable {
    case register
    case forgotPassword
}

#Preview {
    LoginView()
        .environmentObject(AuthViewModel())
        .environmentObject(FeatureFlags())
}
