import AuthenticationServices
import SwiftUI

/// Thin wrapper around the system Sign in with Apple control.
/// Requires the `com.apple.developer.applesignin` entitlement (see NoMarkup.entitlements).
struct SignInWithAppleButtonView: View {
    var onCompletion: (Result<ASAuthorization, Error>) -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
        } onCompletion: { result in
            onCompletion(result)
        }
        .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
        .frame(height: 48)
        .accessibilityLabel("Sign in with Apple")
    }
}

#Preview {
    SignInWithAppleButtonView { _ in }
        .padding()
}
