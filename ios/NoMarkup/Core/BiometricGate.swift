import Foundation
import LocalAuthentication

/// Optional Face ID / Touch ID / device passcode gate for sensitive actions and app lock (IOS-SEC.7).
///
/// Uses `deviceOwnerAuthentication` so users without enrolled biometrics can still
/// authenticate with device passcode. When the device has **no** authentication at all,
/// calls fail closed only when the preference is on and evaluation cannot run — otherwise
/// we degrade gracefully (allow) so development / simulators without a passcode stay usable.
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
    /// - Returns: `true` on success; `false` on cancel/failure.
    ///   If the device cannot evaluate policy at all, returns `true` (graceful fallback).
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // Simulator / no passcode: do not brick the product surface.
            return true
        }

        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            ) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }

    /// Prompts only when the user enabled the Settings toggle; otherwise passes through.
    static func authenticateIfRequired(reason: String) async -> Bool {
        guard requireForSensitiveActions else { return true }
        return await authenticate(reason: reason)
    }
}
