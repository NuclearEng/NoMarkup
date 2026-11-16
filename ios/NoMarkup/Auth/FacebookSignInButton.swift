import SwiftUI

/// Styled “Continue with Facebook” control for the login shell.
/// Uses ASWebAuthenticationSession under AuthViewModel — no Facebook SDK.
/// Only rendered when `AppConfig.isFacebookSignInConfigured` is true.
struct FacebookSignInButton: View {
    var isBusy: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text("f")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(Color(red: 0.09, green: 0.47, blue: 0.95))
                    .frame(width: 22, height: 22)
                    .accessibilityHidden(true)
                Text("Continue with Facebook")
                    .fontWeight(.semibold)
                    .foregroundStyle(BrandTheme.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(BrandTheme.gold.opacity(0.25), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .opacity(isBusy ? 0.55 : 1)
        .accessibilityLabel("Continue with Facebook")
        .accessibilityHint("Opens a secure browser window to sign in with your Facebook account")
        .accessibilityIdentifier("login.facebook")
    }
}

#Preview {
    FacebookSignInButton(isBusy: false) {}
        .padding()
        .background(BrandTheme.navy)
}
