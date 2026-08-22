import Foundation
import Security

/// One outbound API hop. No request bodies, tokens, or query strings —
/// those can carry passwords, PANs, and PII.
struct ClientActionEvent: Identifiable, Equatable, Sendable {
    let id: UUID
    let at: Date
    let kind: String
    let method: String
    let path: String
    let status: Int
    let durationMs: Int
    let requestID: String
    let outcome: String

    var statusLabel: String {
        if kind == "ui" || kind == "screen" { return kind }
        if status == 0 { return "no response" }
        return "\(status)"
    }
}

/// In-process ring buffer of recent API calls so a tap/submit can be audited
/// against gateway `X-Request-ID` logs. Device-local only (not Keychain, not
/// uploaded). Cap 100. Never stores Authorization or bodies.
final class ClientActionLog: ObservableObject, @unchecked Sendable {
    static let shared = ClientActionLog()

    static let requestIDHeader = "X-Request-ID"
    static let capacity = 200

    @Published private(set) var events: [ClientActionEvent] = []

    private let lock = NSLock()

    /// 16-hex-char id matching gateway `observability.NewRequestID`.
    static func mintRequestID() -> String {
        var bytes = [UInt8](repeating: 0, count: 8)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            return String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)).lowercased()
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Stamp `X-Request-ID` when the caller did not already set one.
    static func stamp(_ request: inout URLRequest) {
        if request.value(forHTTPHeaderField: requestIDHeader) == nil {
            request.setValue(mintRequestID(), forHTTPHeaderField: requestIDHeader)
        }
    }

    static func sanitizedPath(from url: URL?) -> String {
        guard let url else { return "" }
        let path = url.path
        return path.isEmpty ? "/" : path
    }

    static func outcome(status: Int, error: Error?, kind: String = "http") -> String {
        if kind == "ui" { return "ui" }
        if kind == "screen" { return "screen" }
        if error != nil, status == 0 { return "unreachable" }
        switch status {
        case 200 ... 299: return "ok"
        case 401: return "unauthorized"
        case 403: return "forbidden"
        case 404: return "not_found"
        case 409: return "conflict"
        case 429: return "rate_limited"
        case 0: return "unreachable"
        default: return "error"
        }
    }

    /// Labels / a11y ids only — never field values (passwords, PANs).
    static func sanitizeLabel(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let collapsed = trimmed.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        // Drop long digit runs (cards, OTPs).
        let redacted = collapsed.replacingOccurrences(of: "\\d{6,}", with: "[digits]", options: .regularExpression)
        if redacted.count <= 80 { return redacted }
        return String(redacted.prefix(80))
    }

    func record(
        method: String,
        path: String,
        status: Int,
        durationMs: Int,
        requestID: String,
        error: Error? = nil,
        kind: String = "http"
    ) {
        let event = ClientActionEvent(
            id: UUID(),
            at: Date(),
            kind: kind,
            method: method.uppercased(),
            path: path,
            status: status,
            durationMs: max(0, durationMs),
            requestID: requestID,
            outcome: Self.outcome(status: status, error: error, kind: kind)
        )
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            var next = self.events
            next.insert(event, at: 0)
            if next.count > Self.capacity {
                next = Array(next.prefix(Self.capacity))
            }
            self.events = next
        }
    }

    func record(request: URLRequest, response: URLResponse?, error: Error?, started: Date) {
        let http = response as? HTTPURLResponse
        let echoed = http?.value(forHTTPHeaderField: Self.requestIDHeader)
        let minted = request.value(forHTTPHeaderField: Self.requestIDHeader)
        let requestID = (echoed?.isEmpty == false ? echoed : minted) ?? ""
        let status = http?.statusCode ?? 0
        let ms = Int((Date().timeIntervalSince(started) * 1000).rounded())
        record(
            method: request.httpMethod ?? "GET",
            path: Self.sanitizedPath(from: request.url),
            status: status,
            durationMs: ms,
            requestID: requestID,
            error: error,
            kind: "http"
        )
    }

    func recordUI(method: String, path: String, kind: String = "ui") {
        let cleaned = Self.sanitizeLabel(path)
        guard !cleaned.isEmpty else { return }
        record(
            method: method,
            path: cleaned,
            status: 1,
            durationMs: 0,
            requestID: "",
            kind: kind
        )
    }

    func clear() {
        DispatchQueue.main.async { [weak self] in
            self?.events = []
        }
    }
}
