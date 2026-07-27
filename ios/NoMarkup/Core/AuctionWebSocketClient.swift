import Combine
import Foundation

/// Native auction WebSocket client for gateway `GET /ws/auction/{jobId}`.
///
/// Protocol (mirrors `web/src/lib/auction-websocket.ts` + chat `ws.AuctionHandler`):
/// - **Connect:** path job id; gateway validates JWT then proxies to chat auction WS.
/// - **Auth:** JWT on the upgrade as `Authorization: Bearer <access>` (preferred).
///   Gateway also accepts `?token=` — we deliberately avoid the query form so the JWT
///   never appears in access logs that record the request line.
/// - **Server → client:**
///   - `bid_event` — Redis fan-out; `data` is the bidding-engine payload
///     `{ type, job_id, amount_cents, timestamp }` (`type` = `bid_placed` /
///     `bid_updated` / `bid_withdrawn`, …).
///   - `auction_state` / `snipe_extended` / `auction_ended` — accepted for forward
///     compatibility with the web client envelope (not all are published today).
///   - `error` — e.g. not a job participant.
/// - **Client → server (optional):** `subscribe_auction` / `unsubscribe_auction`
///   with `job_id` for multi-job; path job is auto-subscribed on connect.
///
/// Authorization: only job **participants** (owner or bidder) receive the privileged
/// feed. Non-participants get an error + close; the view keeps HTTP poll fallback.
/// Anonymous spectators must use `/ws/auction/{jobId}/spectate` (not this client).
///
/// Lifecycle: owned by `JobDetailView`. Connect → receive live frames → reconnect
/// with exponential backoff + jitter. Reset backoff only if the socket stayed open
/// ≥ 5s (avoids hot-loop when gateway accepts then fails chat dial). Stop reconnect
/// on `auction_ended` or permanent auth denial.
///
/// Fall-back: the detail view keeps a faster REST poll of
/// `GET …/auction/state` + `…/events` while disconnected and a slow reconcile poll
/// while connected (same hybrid as chat).
///
/// **Never log the access token or Authorization header.**
@MainActor
final class AuctionWebSocketClient: ObservableObject {

    // MARK: - Public status

    enum ConnectionStatus: String, Sendable {
        case disconnected
        case connecting
        case connected
    }

    enum ServerEvent: Sendable {
        /// Live bid activity from Redis fan-out.
        case bidEvent(AuctionEvent)
        /// Full/partial auction state snapshot (optional wire type).
        case auctionState(
            lowestBidCents: Int64?,
            bidCount: Int?,
            auctionEndsAt: String?,
            snipeExtensionCount: Int?
        )
        /// Anti-snipe extension signal (optional wire type).
        case snipeExtended(jobID: String)
        /// Auction finished — stop reconnect.
        case auctionEnded(jobID: String)
        /// Protocol / auth error.
        case error(String)
    }

    @Published private(set) var status: ConnectionStatus = .disconnected

    /// Job this client is currently dialing / subscribed to (path param).
    private(set) var activeJobID: String?

    // MARK: - Config (mirrors chat + web ws-backoff)

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
    private var reconnectDelayMs: UInt64 = AuctionWebSocketClient.initialReconnectDelayMs
    private var openedAt: Date?
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?

    /// Debounced event delivery to the owner view.
    var onEvent: ((ServerEvent) -> Void)?

    // MARK: - Lifecycle

    /// Open (or re-open) the auction socket for `jobID`.
    func connect(jobID: String) {
        let id = jobID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }

        intentionalClose = false
        permanentStop = false

        if activeJobID == id, status == .connected || status == .connecting {
            return
        }

        // Switching jobs: tear down previous socket cleanly.
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

        Task { @MainActor in
            let token: String
            do {
                // Match ChatWebSocketClient: token is sync keychain read; stay disconnected
                // when there is no session (HTTP poll covers the public feed).
                guard let access = try APIClient.shared.accessTokenForWebSocket(),
                      !access.isEmpty
                else {
                    status = .disconnected
                    return
                }
                token = access
            } catch {
                status = .disconnected
                scheduleReconnect()
                return
            }

            guard let url = Self.auctionWebSocketURL(jobID: jobID) else {
                status = .disconnected
                return
            }

            // Prefer Authorization header over ?token= so the JWT never lands in
            // request-line access logs. Gateway accepts header, query, or cookie.
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            // Do not log `request` or `token`.

            let session = URLSession(configuration: .default)
            let task = session.webSocketTask(with: request)
            self.urlSession = session
            self.webSocketTask = task
            self.openedAt = nil
            task.resume()

            // URLSessionWebSocketTask has no onopen callback — first successful
            // receive or a zero-length ping establishes "connected".
            self.markConnected()
            self.startReceiveLoop()
            self.startPingLoop()
        }
    }

    private func markConnected() {
        status = .connected
        openedAt = Date()
        // Do NOT reset reconnectAttempts here — gateway may accept then immediately
        // close if chat dial fails. Reset only after a stable open (on close path).
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
                task.sendPing { _ in
                    // Errors surface via the receive loop / next send.
                }
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
            if let event = Self.decodeBidEvent(obj["data"], envelopeJobID: jobID) {
                onEvent?(.bidEvent(event))
            }
        case "auction_state":
            let state = Self.decodeAuctionState(obj["data"])
            onEvent?(
                .auctionState(
                    lowestBidCents: state.lowest,
                    bidCount: state.bidCount,
                    auctionEndsAt: state.endsAt,
                    snipeExtensionCount: state.snipe
                )
            )
        case "snipe_extended":
            onEvent?(.snipeExtended(jobID: jobID))
        case "auction_ended":
            permanentStop = true
            onEvent?(.auctionEnded(jobID: jobID))
            // Stay "connected" briefly then disconnect cleanly without reconnect.
            tearDownSocket(resetBackoff: true)
            status = .disconnected
        case "error":
            let msg = (obj["error"] as? String) ?? "WebSocket error"
            // Permanent auth denial — do not thrash reconnect (participant check failed).
            let lower = msg.lowercased()
            if lower.contains("not authorized")
                || lower.contains("authentication required")
                || lower.contains("subscription unavailable")
            {
                permanentStop = true
                cancelReconnect()
                tearDownSocket(resetBackoff: true)
                status = .disconnected
            }
            onEvent?(.error(msg))
        default:
            break
        }
    }

    /// Maps Redis / bidding-engine bid payload into `AuctionEvent`.
    ///
    /// Wire shapes seen in production paths:
    /// - `{ "type":"bid_placed", "job_id":"…", "amount_cents":N, "timestamp":"…" }`
    /// - snake_case REST event: `event_type` + `created_at`
    private static func decodeBidEvent(_ raw: Any?, envelopeJobID: String) -> AuctionEvent? {
        guard let dict = asDictionary(raw) else { return nil }

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

        // Need at least one identifying field so empty garbage does not spam the feed.
        guard jobId != nil || amount != nil || eventType != nil else { return nil }

        return AuctionEvent(
            jobId: jobId,
            amountCents: amount,
            eventType: eventType,
            createdAt: createdAt
        )
    }

    private static func decodeAuctionState(_ raw: Any?) -> (
        lowest: Int64?,
        bidCount: Int?,
        endsAt: String?,
        snipe: Int?
    ) {
        guard let dict = asDictionary(raw) else {
            return (nil, nil, nil, nil)
        }
        let lowest = int64Value(dict["lowest_bid_cents"]) ?? int64Value(dict["lowestBidCents"])
        let bidCount = intValue(dict["bid_count"]) ?? intValue(dict["bidCount"])
        let endsAt = stringValue(dict["auction_ends_at"]) ?? stringValue(dict["auctionEndsAt"])
        let snipe = intValue(dict["snipe_extension_count"])
            ?? intValue(dict["snipeExtensionCount"])
        return (lowest, bidCount, endsAt, snipe)
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
            // Refresh access token before re-dial (15-min JWT may have expired while down).
            _ = try? await APIClient.shared.refreshSession()
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

    /// Full jitter in `[delay/2, delay)`.
    private func jitteredDelayMs(_ delayMs: UInt64) -> UInt64 {
        let half = delayMs / 2
        let span = max(delayMs - half, 1)
        let extra = UInt64.random(in: 0 ..< span)
        return half + extra
    }

    // MARK: - URL

    /// `ws(s)://{api-host}/ws/auction/{jobId}` derived from `AppConfig.apiBaseURL`.
    static func auctionWebSocketURL(jobID: String) -> URL? {
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
        // Path segments only — job id is not a query param.
        let encoded = jobID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? jobID
        components.path = "/ws/auction/\(encoded)"
        components.query = nil
        components.fragment = nil
        // Never attach token as query here.
        return components.url
    }
}
