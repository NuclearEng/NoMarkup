import Combine
import Foundation

/// Native **public** auction spectator WebSocket for
/// `GET /ws/auction/{jobId}/spectate`.
///
/// Security contract (gateway `SpectatorWSHandler`):
/// - **Anonymous** — no JWT, cookie, or query token.
/// - **Delayed** — server holds events ~3s before fan-out (anti front-running).
/// - **Anonymized** — PII fields stripped server-side (`provider_id`, names,
///   email, phone, bidder ids, …). Only public bid signals
///   (`type` / `amount_cents` / `timestamp` / `job_id`) should appear in `data`.
/// - **Live auctions only** — bidding engine publishes Redis `auction:{jobId}`
///   for `auction_type == "live"`; sealed reverse auctions do not stream amounts.
/// - Feature-gated (`ENABLE_LIVE_AUCTION`); soft-fail when the endpoint 404s.
///
/// Do **not** use this path for participants who need the privileged feed —
/// they use `AuctionWebSocketClient` → `/ws/auction/{jobId}`.
///
/// Lifecycle: owned by `JobDetailView` for unauth / non-participant viewers.
/// Same reconnect + hybrid HTTP poll pattern as the participant socket.
///
/// **Never attach Authorization or `?token=` to this URL.**
@MainActor
final class SpectatorWebSocketClient: ObservableObject {

    // MARK: - Public status

    enum ConnectionStatus: String, Sendable {
        case disconnected
        case connecting
        case connected
    }

    enum ServerEvent: Sendable {
        /// Delayed, anonymized bid activity from Redis fan-out.
        case bidEvent(AuctionEvent)
        /// Concurrent public viewer count (optional UI).
        case spectatorCount(Int)
        /// Protocol / transport error (non-fatal for the view).
        case error(String)
    }

    @Published private(set) var status: ConnectionStatus = .disconnected

    /// Job this client is currently dialing / subscribed to (path param).
    private(set) var activeJobID: String?

    // MARK: - Config (mirrors AuctionWebSocketClient + web spectator-websocket)

    private static let initialReconnectDelayMs: UInt64 = 1_000
    private static let maxReconnectDelayMs: UInt64 = 30_000
    private static let stableConnectionMs: UInt64 = 5_000
    private static let clientPingIntervalNanoseconds: UInt64 = 25_000_000_000
    private static let maxReconnectAttempts = 10

    // MARK: - Private state

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var intentionalClose = false
    private var permanentStop = false
    private var reconnectAttempts = 0
    private var reconnectDelayMs: UInt64 = SpectatorWebSocketClient.initialReconnectDelayMs
    private var openedAt: Date?
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?

    /// Debounced event delivery to the owner view.
    var onEvent: ((ServerEvent) -> Void)?

    // MARK: - Lifecycle

    /// Open (or re-open) the public spectator socket for `jobID`.
    func connect(jobID: String) {
        let id = jobID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }

        intentionalClose = false
        permanentStop = false

        if activeJobID == id, status == .connected || status == .connecting {
            return
        }

        if activeJobID != id {
            tearDownSocket(resetBackoff: true)
            reconnectAttempts = 0
        }
        activeJobID = id
        openSocket()
    }

    func disconnect() {
        intentionalClose = true
        permanentStop = false
        cancelReconnect()
        tearDownSocket(resetBackoff: true)
        activeJobID = nil
        reconnectAttempts = 0
        status = .disconnected
    }

    deinit {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        urlSession?.invalidateAndCancel()
    }

    // MARK: - Socket open

    private func openSocket() {
        guard !intentionalClose, !permanentStop else { return }
        guard let jobID = activeJobID, !jobID.isEmpty else {
            status = .disconnected
            return
        }

        if webSocketTask != nil {
            let state = webSocketTask?.state
            if state == .running || state == .suspended {
                return
            }
        }

        status = .connecting

        guard let url = Self.spectatorWebSocketURL(jobID: jobID) else {
            status = .disconnected
            return
        }

        // No Authorization / no ?token= — public anonymous stream only.
        let request = URLRequest(url: url)
        // Do not log request headers or attach credentials.

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: request)
        urlSession = session
        webSocketTask = task
        openedAt = nil
        task.resume()

        markConnected()
        startReceiveLoop()
        startPingLoop()
    }

    private func markConnected() {
        status = .connected
        openedAt = Date()
        // Do NOT reset reconnectAttempts here — gateway may accept then close
        // (e.g. Redis unavailable). Reset only after a stable open on close path.
    }

    // MARK: - Receive

    private func startReceiveLoop() {
        receiveTask?.cancel()
        receiveTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled, !self.intentionalClose, !self.permanentStop {
                guard let task = self.webSocketTask else { break }
                do {
                    let message = try await task.receive()
                    self.handleReceived(message)
                } catch {
                    if !Task.isCancelled, !self.intentionalClose, !self.permanentStop {
                        self.handleSocketFailure()
                    }
                    break
                }
            }
        }
    }

    private func startPingLoop() {
        pingTask?.cancel()
        pingTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: Self.clientPingIntervalNanoseconds)
                } catch {
                    break
                }
                guard let self, !self.intentionalClose, !self.permanentStop else { break }
                guard let task = self.webSocketTask, task.state == .running else { continue }
                task.sendPing { _ in }
            }
        }
    }

    private func handleReceived(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text):
            guard let d = text.data(using: .utf8) else { return }
            data = d
        case .data(let d):
            data = d
        @unknown default:
            return
        }

        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String
        else {
            return
        }

        let jobID = (obj["job_id"] as? String) ?? activeJobID ?? ""

        switch type {
        case "bid_event":
            // Server already stripped PII; still only map public bid fields.
            if let event = Self.decodeBidEvent(obj["data"], envelopeJobID: jobID) {
                onEvent?(.bidEvent(event))
            }
        case "spectator_count":
            if let count = Self.intValue(obj["spectator_count"]) {
                onEvent?(.spectatorCount(count))
            }
        case "error":
            let msg = (obj["error"] as? String) ?? "WebSocket error"
            let lower = msg.lowercased()
            // Feature-off / hard deny: stop thrashing reconnect (HTTP poll covers).
            if lower.contains("not enabled")
                || lower.contains("not found")
                || lower.contains("not authorized")
            {
                permanentStop = true
                cancelReconnect()
                tearDownSocket(resetBackoff: true)
                status = .disconnected
            }
            onEvent?(.error(msg))
        default:
            // Ignore auction_state / auction_ended / unknown — not on public
            // spectator envelope today; poll remains source of truth for close.
            break
        }
    }

    /// Maps delayed, anonymized bid payload into `AuctionEvent`.
    ///
    /// Wire: `{ "type":"bid_placed", "job_id":"…", "amount_cents":N, "timestamp":"…" }`
    /// after gateway `anonymizeEvent` (PII keys deleted).
    private static func decodeBidEvent(_ raw: Any?, envelopeJobID: String) -> AuctionEvent? {
        guard let dict = asDictionary(raw) else { return nil }

        // Defense in depth: never surface identity fields even if a server
        // regression re-introduces them — AuctionEvent has no such slots.
        let jobId = stringValue(dict["job_id"])
            ?? stringValue(dict["jobId"])
            ?? (envelopeJobID.isEmpty ? nil : envelopeJobID)

        let amount = int64Value(dict["amount_cents"]) ?? int64Value(dict["amountCents"])

        let eventType = stringValue(dict["type"])
            ?? stringValue(dict["event_type"])
            ?? stringValue(dict["eventType"])

        let createdAt = stringValue(dict["timestamp"])
            ?? stringValue(dict["created_at"])
            ?? stringValue(dict["createdAt"])

        guard jobId != nil || amount != nil || eventType != nil else { return nil }

        return AuctionEvent(
            jobId: jobId,
            amountCents: amount,
            eventType: eventType,
            createdAt: createdAt
        )
    }

    private static func asDictionary(_ raw: Any?) -> [String: Any]? {
        if let dict = raw as? [String: Any] { return dict }
        if let s = raw as? String, let d = s.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
        {
            return obj
        }
        if let d = raw as? Data,
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
        {
            return obj
        }
        return nil
    }

    private static func stringValue(_ raw: Any?) -> String? {
        if let s = raw as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        return nil
    }

    private static func int64Value(_ raw: Any?) -> Int64? {
        if let v = raw as? Int64 { return v }
        if let v = raw as? Int { return Int64(v) }
        if let v = raw as? Double { return Int64(v) }
        if let s = raw as? String, let v = Int64(s) { return v }
        if let n = raw as? NSNumber { return n.int64Value }
        return nil
    }

    private static func intValue(_ raw: Any?) -> Int? {
        if let v = raw as? Int { return v }
        if let v = raw as? Int64 { return Int(v) }
        if let v = raw as? Double { return Int(v) }
        if let s = raw as? String, let v = Int(s) { return v }
        if let n = raw as? NSNumber { return n.intValue }
        return nil
    }

    // MARK: - Failure / reconnect

    private func handleSocketFailure() {
        guard !intentionalClose, !permanentStop else { return }
        tearDownSocket(resetBackoff: false)

        let wasStable: Bool
        if let openedAt {
            wasStable = Date().timeIntervalSince(openedAt) * 1000 >= Double(Self.stableConnectionMs)
        } else {
            wasStable = false
        }
        openedAt = nil
        if wasStable {
            reconnectDelayMs = Self.initialReconnectDelayMs
            reconnectAttempts = 0
        }

        status = .disconnected
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard !intentionalClose, !permanentStop else { return }
        guard reconnectTask == nil else { return }
        guard reconnectAttempts < Self.maxReconnectAttempts else { return }
        guard activeJobID != nil else { return }

        let delay = jitteredDelayMs(reconnectDelayMs)
        reconnectAttempts += 1
        reconnectDelayMs = min(reconnectDelayMs * 2, Self.maxReconnectDelayMs)

        reconnectTask = Task { @MainActor [weak self] in
            defer { self?.reconnectTask = nil }
            do {
                try await Task.sleep(nanoseconds: delay * 1_000_000)
            } catch {
                return
            }
            guard let self, !self.intentionalClose, !self.permanentStop else { return }
            // No session refresh — public socket has no token.
            self.openSocket()
        }
    }

    private func cancelReconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
    }

    private func tearDownSocket(resetBackoff: Bool) {
        receiveTask?.cancel()
        receiveTask = nil
        pingTask?.cancel()
        pingTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        if resetBackoff {
            reconnectDelayMs = Self.initialReconnectDelayMs
            openedAt = nil
            reconnectAttempts = 0
        }
    }

    private func jitteredDelayMs(_ delayMs: UInt64) -> UInt64 {
        let half = delayMs / 2
        let span = max(delayMs - half, 1)
        let extra = UInt64.random(in: 0 ..< span)
        return half + extra
    }

    // MARK: - URL

    /// `ws(s)://{api-host}/ws/auction/{jobId}/spectate` — **no** query token.
    static func spectatorWebSocketURL(jobID: String) -> URL? {
        let http = AppConfig.apiBaseURL
        guard var components = URLComponents(url: http, resolvingAgainstBaseURL: false) else {
            return nil
        }
        switch components.scheme?.lowercased() {
        case "https":
            components.scheme = "wss"
        case "http":
            components.scheme = "ws"
        default:
            components.scheme = components.scheme == nil ? "ws" : components.scheme
        }
        let encoded = jobID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? jobID
        components.path = "/ws/auction/\(encoded)/spectate"
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
