import Foundation
import LocalAuthentication

/// Optional Face ID / Touch ID / device passcode gate for sensitive actions and app lock (IOS-SEC.7).
///
/// Uses `deviceOwnerAuthentication` so users without enrolled biometrics can still
/// authenticate with device passcode. When the device cannot evaluate that policy,
/// `authenticate` returns false. The lock screen offers the account password and
/// sign-out. `authenticateIfRequired` still skips the prompt when the lock is off.
@MainActor
enum BiometricGate {
    private static let preferenceKey = "com.nomarkup.security.requireBiometricForSensitive"

    /// User preference: require device owner auth before destructive / money-adjacent actions.
    /// Stored in UserDefaults (not Keychain) — preference is not a secret; Keychain holds tokens.
    static var requireForSensitiveActions: Bool {
        get { UserDefaults.standard.bool(forKey: preferenceKey) }
        set { UserDefaults.standard.set(newValue, forKey: preferenceKey) }
    }

    /// Human-readable biometry name for Settings copy (Face ID / Touch ID / Passcode).
    static var biometryDisplayName: String {
        let context = LAContext()
        var error: NSError?
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        switch context.biometryType {
        case .faceID:
            return "Face ID"
        case .touchID:
            return "Touch ID"
        case .opticID:
            return "Optic ID"
        case .none:
            return "Device Passcode"
        @unknown default:
            return "Device Authentication"
        }
    }

    /// Whether the device can present any owner authentication (biometry or passcode).
    static var canAuthenticate: Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// Always prompts (when possible). Use for explicit unlock / sensitive confirm.
    /// - Returns: `true` only when the system accepts the owner. Cancel, fallback,
    ///   lockout, missing biometrics, a missing passcode, or a policy that cannot
    ///   be evaluated all return `false` so the caller can offer the account password.
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Use Password"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }

        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            ) { success, evalError in
                if success {
                    continuation.resume(returning: true)
                    return
                }
                let code = (evalError as? LAError)?.code ?? .authenticationFailed
                // Every failure leaves the biometric prompt. The lock screen's
                // password field is the way back in.
                _ = routesToPasswordFallback(code)
                continuation.resume(returning: false)
            }
        }
    }

    /// Maps a LocalAuthentication failure onto the password fallback. Biometrics
    /// are never the only way in.
    static func routesToPasswordFallback(_ code: LAError.Code) -> Bool {
        switch code {
        case .userCancel, .userFallback, .systemCancel, .appCancel,
             .biometryNotAvailable, .biometryNotEnrolled, .biometryLockout,
             .passcodeNotSet, .invalidContext, .authenticationFailed,
             .notInteractive:
            return true
        @unknown default:
            return true
        }
    }

    /// Prompts only when the user enabled the Settings toggle; otherwise passes through.
    static func authenticateIfRequired(reason: String) async -> Bool {
        guard requireForSensitiveActions else { return true }
        return await authenticate(reason: reason)
    }
}
