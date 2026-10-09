import Combine
import Foundation

/// Native chat WebSocket client for gateway `GET /ws/chat`.
///
/// Protocol (mirrors `web/src/lib/websocket.ts` + chat service `ws.Handler`):
/// - **Client → server:** `subscribe` / `unsubscribe` / `typing` with `channel_id`
/// - **Server → client:** `message` / `typing` / `unread_update` / `read_receipt` / `error`
///
/// Auth: JWT on the upgrade request as `Authorization: Bearer <access>` (preferred).
/// The gateway also accepts `?token=` — we deliberately avoid putting the token in
/// the URL so it never appears in access logs that record the request line.
/// **Never log the access token or Authorization header.**
///
/// Lifecycle: per open thread (owned by `ChatThreadView`). Connect → subscribe →
/// receive live frames → reconnect with exponential backoff + jitter. On stable
/// connection drop, reset backoff only if the socket stayed open ≥ 5s (avoids
/// hot-loop when gateway accepts then immediately fails dialing chat).
///
/// Fall-back: the thread view keeps a slower REST poll while connected and a
/// fast poll while disconnected so missed frames still surface.
@MainActor
final class ChatWebSocketClient: ObservableObject {

    // MARK: - Public status

    enum ConnectionStatus: String, Sendable {
        case disconnected
        case connecting
        case connected
    }

    enum ServerEvent: Sendable {
        /// New chat message on a channel — payload may be incomplete; prefer REST refetch.
        case message(channelID: String, message: ChatMessage?)
        /// Remote user is typing in a channel.
        case typing(channelID: String, userID: String)
        /// Unread badge change for a channel.
        case unreadUpdate(channelID: String, unreadCount: Int)
        /// Peer MarkRead watermark — flip Sent → Seen without REST poll.
        case readReceipt(channelID: String, userID: String, lastReadAt: String?)
        /// Server-sent protocol error (e.g. not subscribed).
        case error(String)
    }

    @Published private(set) var status: ConnectionStatus = .disconnected

    /// Channel IDs this client currently wants live subscriptions for.
    private(set) var activeSubscriptions: Set<String> = []

    // MARK: - Config (mirrors web ws-backoff)

    private static let initialReconnectDelayMs: UInt64 = 1_000
    private static let maxReconnectDelayMs: UInt64 = 30_000
    private static let stableConnectionMs: UInt64 = 5_000
    private static let typingLocalTTLNanoseconds: UInt64 = 3_000_000_000
    private static let clientPingIntervalNanoseconds: UInt64 = 25_000_000_000

    // MARK: - Private state

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var intentionalClose = false
    private var reconnectDelayMs: UInt64 = ChatWebSocketClient.initialReconnectDelayMs
    private var openedAt: Date?
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var outboundQueue: [[String: String]] = []

    /// Debounced event delivery to the owner view.
    var onEvent: ((ServerEvent) -> Void)?

    // MARK: - Lifecycle

    func connect() {
        intentionalClose = false
        guard status != .connected, status != .connecting else { return }
        openSocket()
    }

    func disconnect() {
        intentionalClose = true
        cancelReconnect()
        tearDownSocket(resetBackoff: true)
        activeSubscriptions.removeAll()
        outboundQueue.removeAll()
        status = .disconnected
    }

    deinit {
        // Best-effort: cancel tasks without hopping to MainActor (deinit is nonisolated).
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        urlSession?.invalidateAndCancel()
    }

    // MARK: - Channel ops

    func subscribe(channelID: String) {
        let id = channelID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        activeSubscriptions.insert(id)
        sendFrame(["type": "subscribe", "channel_id": id])
    }

    func unsubscribe(channelID: String) {
        let id = channelID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        activeSubscriptions.remove(id)
        sendFrame(["type": "unsubscribe", "channel_id": id])
    }

    /// Publish a typing indicator. Server ignores self-echo; requires prior subscribe.
    func sendTyping(channelID: String) {
        let id = channelID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        sendFrame(["type": "typing", "channel_id": id])
    }

    // MARK: - Socket open

    private func openSocket() {
        guard !intentionalClose else { return }
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
                guard let access = try await APIClient.shared.accessTokenForWebSocket(),
                      !access.isEmpty
                else {
                    // No session — stay disconnected (do not thrash reconnect without a JWT).
                    status = .disconnected
                    return
                }
                token = access
            } catch {
                // Transient keychain/read failure — back off and retry.
                status = .disconnected
                scheduleReconnect()
                return
            }

            guard let url = Self.chatWebSocketURL() else {
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
            self.markConnectedAndBootstrap()
            self.startReceiveLoop()
            self.startPingLoop()
        }
    }

    private func markConnectedAndBootstrap() {
        status = .connected
        openedAt = Date()
        // Re-subscribe before flushing typing frames so the server membership check passes.
        for channelID in activeSubscriptions {
            sendFrameDirect(["type": "subscribe", "channel_id": channelID])
        }
        flushQueue()
    }

    // MARK: - Send

    private func sendFrame(_ payload: [String: String]) {
        if webSocketTask?.state == .running, status == .connected {
            sendFrameDirect(payload)
        } else {
            // Queue transient frames; subscribe is replayed from activeSubscriptions.
            if payload["type"] == "subscribe" || payload["type"] == "unsubscribe" {
                // Already tracked in activeSubscriptions; nothing to queue beyond that.
                return
            }
            outboundQueue.append(payload)
            if status == .disconnected {
                connect()
            }
        }
    }

    private func sendFrameDirect(_ payload: [String: String]) {
        guard let task = webSocketTask else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            return
        }
        guard let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { [weak self] error in
            guard let self else { return }
            if error != nil {
                Task { @MainActor in
                    self.handleSocketFailure()
                }
            }
        }
    }

    private func flushQueue() {
        let pending = outboundQueue
        outboundQueue.removeAll()
        for frame in pending {
            let type = frame["type"] ?? ""
            if type == "subscribe" || type == "unsubscribe" {
                continue
            }
            sendFrameDirect(frame)
        }
    }

    // MARK: - Receive

    private func startReceiveLoop() {
        receiveTask?.cancel()
        receiveTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled, !self.intentionalClose {
                guard let task = self.webSocketTask else { break }
                do {
                    let message = try await task.receive()
                    self.handleReceived(message)
                } catch {
                    if !Task.isCancelled, !self.intentionalClose {
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
                guard let self, !self.intentionalClose else { break }
                guard let task = self.webSocketTask, task.state == .running else { continue }
                // Keepalive — gateway also pings; this resets idle on half-open paths.
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

        let channelID = (obj["channel_id"] as? String) ?? ""

        switch type {
        case "message":
            let decoded = Self.decodeNestedMessage(obj["message"])
            onEvent?(.message(channelID: channelID, message: decoded))
        case "typing":
            let userID = (obj["user_id"] as? String) ?? ""
            guard !channelID.isEmpty, !userID.isEmpty else { return }
            onEvent?(.typing(channelID: channelID, userID: userID))
        case "unread_update":
            let count: Int
            if let n = obj["unread_count"] as? Int {
                count = n
            } else if let n = obj["unread_count"] as? Double {
                count = Int(n)
            } else {
                count = 0
            }
            onEvent?(.unreadUpdate(channelID: channelID, unreadCount: count))
        case "read_receipt":
            let userID = (obj["user_id"] as? String) ?? ""
            let lastReadAt = obj["last_read_at"] as? String
            guard !channelID.isEmpty, !userID.isEmpty else { return }
            onEvent?(.readReceipt(channelID: channelID, userID: userID, lastReadAt: lastReadAt))
        case "error":
            let msg = (obj["error"] as? String) ?? "WebSocket error"
            onEvent?(.error(msg))
        default:
            break
        }
    }

    /// Best-effort decode of nested message JSON (snake_case REST shape or Go PascalCase pubsub).
    private static func decodeNestedMessage(_ raw: Any?) -> ChatMessage? {
        guard let raw else { return nil }
        let data: Data?
        if let dict = raw as? [String: Any] {
            data = try? JSONSerialization.data(withJSONObject: dict, options: [])
        } else if let s = raw as? String {
            data = s.data(using: .utf8)
        } else if let d = raw as? Data {
            data = d
        } else {
            data = nil
        }
        guard let data else { return nil }

        // Prefer snake_case (REST / documented wire). Fall back to flexible keys.
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        if let msg = try? decoder.decode(ChatMessage.self, from: data) {
            return msg
        }
        // Go domain.Message has no json tags → PascalCase field names.
        if let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let id = (dict["id"] as? String)
                ?? (dict["ID"] as? String)
                ?? (dict["Id"] as? String)
            guard let id, !id.isEmpty else { return nil }
            let channelId = (dict["channel_id"] as? String)
                ?? (dict["ChannelID"] as? String)
                ?? (dict["channelId"] as? String)
            let senderId = (dict["sender_id"] as? String)
                ?? (dict["SenderID"] as? String)
                ?? (dict["senderId"] as? String)
            let messageType = (dict["message_type"] as? String)
                ?? (dict["MessageType"] as? String)
                ?? (dict["messageType"] as? String)
            let content = (dict["content"] as? String) ?? (dict["Content"] as? String)
            var createdAt = dict["created_at"] as? String
            if createdAt == nil, let d = dict["CreatedAt"] as? String {
                createdAt = d
            }
            return ChatMessage(
                id: id,
                channelId: channelId,
                senderId: senderId,
                messageType: messageType,
                content: content,
                isRead: nil,
                createdAt: createdAt
            )
        }
        return nil
    }

    // MARK: - Failure / reconnect

    private func handleSocketFailure() {
        guard !intentionalClose else { return }
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
        }

        status = .disconnected
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard !intentionalClose else { return }
        guard reconnectTask == nil else { return }

        let delay = jitteredDelayMs(reconnectDelayMs)
        reconnectDelayMs = min(
            reconnectDelayMs * 2,
            Self.maxReconnectDelayMs
        )

        reconnectTask = Task { @MainActor [weak self] in
            defer { self?.reconnectTask = nil }
            do {
                try await Task.sleep(nanoseconds: delay * 1_000_000)
            } catch {
                return
            }
            guard let self, !self.intentionalClose else { return }
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

    /// `ws(s)://{api-host}/ws/chat` derived from `AppConfig.apiBaseURL`.
    static func chatWebSocketURL() -> URL? {
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
        components.path = "/ws/chat"
        components.query = nil
        components.fragment = nil
        // Never attach token as query here.
        return components.url
    }
}
