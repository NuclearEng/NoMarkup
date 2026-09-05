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

    /// Last 8 HTTP hops as `METHOD path status requestID` (labels only — no bodies/tokens).
    /// UITest builds surface this on `debug.requestLog.latest`.
    func debugSummary() -> String {
        Self.formatDebugSummary(events)
    }

    static func formatDebugSummary(_ events: [ClientActionEvent], limit: Int = 8) -> String {
        events
            .filter { $0.kind == "http" }
            .prefix(limit)
            .map { "\($0.method) \($0.path) \($0.status) \($0.requestID)" }
            .joined(separator: "\n")
    }

    // MARK: Server activity merge (web request-log parity)

    /// One row from `GET /api/v1/me/activity`. No bodies, tokens, or query strings.
    struct MeActivityItem: Equatable, Sendable {
        var requestId: String
        var method: String
        var path: String
        var status: Int
        var durationMs: Int
        var createdAt: String
    }

    /// Merged local + server hop for Request log. `source` is local | server | both.
    struct MergedActionEvent: Identifiable, Equatable, Sendable {
        let id: String
        let at: Date
        let kind: String
        let method: String
        let path: String
        let status: Int
        let durationMs: Int
        let requestID: String
        let outcome: String
        let source: String

        var statusLabel: String {
            if kind == "ui" || kind == "screen" { return kind }
            if status == 0 { return "no response" }
            return "\(status)"
        }
    }

    /// Strip query/hash from a path the way the gateway sanitizes on read.
    static func sanitizedActivityPath(_ raw: String) -> String {
        var path = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if path.isEmpty { return "/" }
        if let idx = path.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            path = String(path[..<idx]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return path.isEmpty ? "/" : path
    }

    /// Flexible decode of `{events|items|activity|rows}` or a bare array.
    static func parseMeActivityPayload(_ data: Data) -> [MeActivityItem] {
        guard let obj = try? JSONSerialization.jsonObject(with: data) else { return [] }
        return parseMeActivityJSON(obj)
    }

    static func parseMeActivityJSON(_ raw: Any?) -> [MeActivityItem] {
        if let arr = raw as? [Any] {
            return arr.compactMap { parseMeActivityRow($0) }
        }
        guard let dict = raw as? [String: Any] else { return [] }
        for key in ["events", "items", "activity", "rows"] {
            if dict[key] != nil {
                return parseMeActivityJSON(dict[key])
            }
        }
        return []
    }

    private static func parseMeActivityRow(_ raw: Any) -> MeActivityItem? {
        guard let dict = raw as? [String: Any] else { return nil }
        func str(_ keys: String...) -> String {
            for key in keys {
                if let value = dict[key] as? String { return value }
            }
            return ""
        }
        func int(_ keys: String...) -> Int {
            for key in keys {
                if let value = dict[key] as? Int { return value }
                if let value = dict[key] as? NSNumber { return value.intValue }
                if let value = dict[key] as? String, let parsed = Int(value) { return parsed }
            }
            return 0
        }
        return MeActivityItem(
            requestId: str("request_id", "requestId"),
            method: str("method").uppercased(),
            path: sanitizedActivityPath(str("path")),
            status: int("status"),
            durationMs: int("duration_ms", "durationMs"),
            createdAt: str("created_at", "at")
        )
    }

    static func parseActivityDate(_ raw: String) -> Date {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return Date.distantPast }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: trimmed) { return date }
        let basic = ISO8601DateFormatter()
        basic.formatOptions = [.withInternetDateTime]
        return basic.date(from: trimmed) ?? Date.distantPast
    }

    /// Dedupes on `requestID` when present (web `mergeActivity`). Local wins; server fills gaps.
    static func mergeActivity(
        local: [ClientActionEvent],
        server: [MeActivityItem]
    ) -> [MergedActionEvent] {
        var byId: [String: MergedActionEvent] = [:]
        var unmatched: [MergedActionEvent] = []

        for event in local {
            let row = MergedActionEvent(
                id: event.id.uuidString,
                at: event.at,
                kind: event.kind,
                method: event.method,
                path: event.path,
                status: event.status,
                durationMs: event.durationMs,
                requestID: event.requestID,
                outcome: event.outcome,
                source: "local"
            )
            if !event.requestID.isEmpty {
                byId[event.requestID] = row
            } else {
                unmatched.append(row)
            }
        }

        for item in server {
            if !item.requestId.isEmpty, var existing = byId[item.requestId] {
                existing = MergedActionEvent(
                    id: existing.id,
                    at: existing.at,
                    kind: existing.kind,
                    method: existing.method.isEmpty ? item.method : existing.method,
                    path: existing.path.isEmpty ? item.path : existing.path,
                    status: existing.status == 0 && item.status > 0 ? item.status : existing.status,
                    durationMs: existing.durationMs == 0 && item.durationMs > 0 ? item.durationMs : existing.durationMs,
                    requestID: existing.requestID,
                    outcome: existing.outcome,
                    source: "both"
                )
                byId[item.requestId] = existing
                continue
            }
            unmatched.append(
                MergedActionEvent(
                    id: "server-\(item.requestId)-\(item.createdAt)-\(item.path)",
                    at: parseActivityDate(item.createdAt),
                    kind: "http",
                    method: item.method,
                    path: item.path,
                    status: item.status,
                    durationMs: item.durationMs,
                    requestID: item.requestId,
                    outcome: outcome(status: item.status, error: nil),
                    source: "server"
                )
            )
        }

        return (Array(byId.values) + unmatched).sorted { lhs, rhs in
            if lhs.at == rhs.at { return false }
            return lhs.at > rhs.at
        }
    }
}
