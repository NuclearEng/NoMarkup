import SwiftUI

/// Styled “Continue with Google” control for the login shell.
/// Uses ASWebAuthenticationSession under AuthViewModel — no Google SDK.
struct GoogleSignInButton: View {
    var isBusy: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                // Simple “G” mark — avoids bundling Google brand assets.
                Text("G")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(Color(red: 0.26, green: 0.52, blue: 0.96))
                    .frame(width: 22, height: 22)
                    .accessibilityHidden(true)
                Text("Continue with Google")
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
        .accessibilityLabel("Continue with Google")
        .accessibilityHint("Opens a secure browser window to sign in with your Google account")
    }
}

#Preview {
    GoogleSignInButton(isBusy: false) {}
        .padding()
        .background(BrandTheme.navy)
}
