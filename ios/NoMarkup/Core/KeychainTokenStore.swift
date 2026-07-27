import Foundation
import Security

/// Minimal Keychain-backed token store for access / refresh tokens.
/// Not a full session manager — Stage B will wire refresh + rotation.
final class KeychainTokenStore: @unchecked Sendable {
    enum Key: String {
        case accessToken = "com.nomarkup.auth.accessToken"
        case refreshToken = "com.nomarkup.auth.refreshToken"
    }

    private let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "com.nomarkup.app") {
        self.service = service
    }

    func save(_ value: String, for key: Key) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]

        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess {
            let update: [String: Any] = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw KeychainError.unhandled(updateStatus)
            }
        } else if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unhandled(addStatus)
            }
        } else {
            throw KeychainError.unhandled(status)
        }
    }

    func read(_ key: Key) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainError.unhandled(status)
        }
        guard let data = item as? Data, let string = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return string
    }

    func delete(_ key: Key) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status)
        }
    }

    /// Whether a non-empty access token is currently stored.
    func hasAccessToken() -> Bool {
        (try? read(.accessToken)).map { !$0.isEmpty } ?? false
    }

    /// Whether a non-empty refresh token is currently stored.
    func hasRefreshToken() -> Bool {
        (try? read(.refreshToken)).map { !$0.isEmpty } ?? false
    }

    /// Removes both access and refresh tokens.
    /// Best-effort: always attempts both deletes so a failure on one key
    /// cannot leave the other behind.
    func clearSession() throws {
        var firstError: Error?
        do {
            try delete(.accessToken)
        } catch {
            firstError = error
        }
        do {
            try delete(.refreshToken)
        } catch {
            firstError = firstError ?? error
        }
        if let firstError {
            throw firstError
        }
    }
}

enum KeychainError: Error, LocalizedError {
    case unhandled(OSStatus)
    case invalidData

    var errorDescription: String? {
        switch self {
        case .unhandled(let status):
            return "Keychain error (\(status))"
        case .invalidData:
            return "Keychain item was not valid UTF-8"
        }
    }
}
