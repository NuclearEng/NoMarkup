import PhotosUI
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Chat channel inbox — `GET /api/v1/channels` (auth). Thread detail loads + sends messages.
///
/// ## Real-time SLA
/// Open threads use native WebSocket (`GET /ws/chat`, JWT via `Authorization`)
/// for live message frames + typing indicators (`ChatWebSocketClient`). When
/// the socket is down, `ChatThreadView` falls back to a quiet REST poll every
/// **~2.5s** (active app only). While connected, a slower **~15s** reconcile
/// poll still runs so any missed frames backfill. Inbox list loads on appear
/// and pull-to-refresh — it does not auto-poll.
///
/// ## FR-8 (iOS)
/// - Live WS: connect / subscribe / receive / typing / reconnect + poll fallback
/// - Photo attach via PhotosPicker → `ImageUploader` (job_photo context) →
///   `POST …/messages` with `message_type: image` + confirmed URL as content
/// - Mark read on open / pull-to-refresh / after send / scroll-to-bottom tip
///   (`POST …/channels/{id}/read`) — deduped per tip message id
/// - Local in-thread search over loaded messages
/// - **Read receipts (FR-8.2):** double-check + "Seen" under the caller’s last own
///   message when the peer has read it; single check ("Sent") while pending.
///   Prefer channel `customer_last_read_at` / `provider_last_read_at` (peer
///   watermark ≥ message `created_at`) so Seen works without a peer reply.
///   Fallbacks: `message.is_read == true` or a later peer message (web heuristic).
///   Live `read_receipt` WS frames patch peer watermark; REST re-fetch remains
///   load/poll for watermark updates. Party-only: JWT `sub` vs channel parties.
/// - **Mark read:** on open / pull-to-refresh / after send, and when the newest
///   message scrolls into view (bottom) if not already marked for that tip.
/// - **Inbox unread:** per-row badge from `channel.unread_count` (server, party-
///   relative); list reloads when leaving a thread so badges clear after mark-read.
/// - **Local terms (FR-5.4 / FR-8.9):** providers propose via toolbar **Propose terms**
///   sheet → `POST /api/v1/channels/{id}/proposed-terms` (dollars → Int64 cents wire
///   amount; server enforces provider-only). Cards render when content starts with
///   `[Proposed Terms]` or `message_type` is `proposed_terms`. Customer Accept/Reject
///   calls `POST /api/v1/channels/{id}/terms/respond` (`accepted: true|false`) —
///   auth + customer-only server-side; records `terms_accepted` / `terms_rejected`
///   (explicit consent only). Contract local-terms override remains server residual.
struct MessagesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var channels: [ChatChannelSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    /// Split-view selection (iPad regular width) — DES.12 / MP.1.
    @State private var selectedChannel: ChatChannelSummary?

    private var usesSplitView: Bool { horizontalSizeClass == .regular }

    var body: some View {
        Group {
            if usesSplitView {
                NavigationSplitView {
                    listRoot
                } detail: {
                    NavigationStack {
                        if let selectedChannel {
                            ChatThreadView(channel: selectedChannel)
                                .onDisappear {
                                    Task { await load() }
                                }
                        } else {
                            ContentUnavailableView(
                                "Select a conversation",
                                systemImage: "bubble.left.and.bubble.right",
                                description: Text("Choose a thread from your inbox.")
                            )
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .brandScreenBackground()
                        }
                    }
                }
            } else {
                NavigationStack {
                    listRoot
                        .navigationDestination(for: ChatChannelSummary.self) { channel in
                            ChatThreadView(channel: channel)
                                // Refresh inbox unread badges after mark-read in the thread.
                                .onDisappear {
                                    Task { await load() }
                                }
                        }
                }
            }
        }
    }

    private var listRoot: some View {
        content
            .navigationTitle("Messages")
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .refreshable { await load() }
            .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if auth.isScaffoldSession {
            BrandEmptyState(
                title: "Sign in for messages",
                systemImage: "person.crop.circle.badge.exclamationmark",
                message: "Browse-only mode has no API token. Sign out and sign in with a real account to load chat threads.",
                actionTitle: "Sign out to log in"
            ) {
                auth.signOut()
            }
        } else if needsSignIn {
            BrandEmptyState(
                title: "Sign in required",
                systemImage: "lock.circle",
                message: "Your session expired or is missing. Sign in again to see conversations.",
                actionTitle: "Sign in"
            ) {
                auth.signOut()
            }
        } else if isLoading && channels.isEmpty {
            ProgressView("Loading messages…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, channels.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load messages",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if channels.isEmpty {
            BrandEmptyState(
                title: "No conversations yet",
                systemImage: "bubble.left.and.bubble.right.fill",
                message: "Chat threads with providers and customers appear here after you bid or award a job. Pull to refresh anytime."
            )
        } else {
            List {
                Section {
                    ForEach(channels) { channel in
                        if usesSplitView {
                            Button {
                                selectedChannel = channel
                            } label: {
                                ChannelRowView(channel: channel)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .frame(minHeight: 44)
                            .listRowBackground(
                                selectedChannel?.id == channel.id
                                    ? BrandTheme.surfaceRaised
                                    : BrandTheme.navyElevated
                            )
                            .accessibilityHint("Shows conversation in the side panel")
                        } else {
                            NavigationLink(value: channel) {
                                ChannelRowView(channel: channel)
                            }
                            .frame(minHeight: 44)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityHint("Opens conversation")
                        }
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(channels.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("Inbox").brandSectionHeader()
                    }
                } footer: {
                    Text("Unread counts come from each channel’s server unread_count (your party only). Open a conversation for live updates (WebSocket when available, otherwise a few-second refresh). Attach photos from the thread composer. Inbox refreshes when you leave a thread or pull down.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            .brandListBackground()
        }
    }

    @MainActor
    private func load() async {
        if auth.isScaffoldSession {
            channels = []
            pagination = nil
            needsSignIn = false
            errorMessage = nil
            return
        }

        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchChatChannels(page: 1, pageSize: 40)
            channels = response.channels
            pagination = response.pagination
        } catch let error as APIClientError where error.isUnauthorized {
            channels = []
            pagination = nil
            needsSignIn = true
        } catch {
            if channels.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Channel row

private struct ChannelRowView: View {
    let channel: ChatChannelSummary
    @ScaledMetric(relativeTo: .title3) private var iconFrame: CGFloat = 36

    /// Server `unread_count` is relative to the authenticated party (gateway).
    private var unreadCount: Int {
        max(0, channel.unreadCount ?? 0)
    }

    private var hasUnread: Bool { unreadCount > 0 }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.title3)
                .foregroundStyle(BrandTheme.accent)
                .frame(width: iconFrame, height: iconFrame)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(channel.displayTitle)
                        .font(.body.weight(hasUnread ? .semibold : .medium))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if hasUnread {
                        Text(unreadCount > 99 ? "99+" : "\(unreadCount)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.ctaLabelOnGold)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(BrandTheme.accent))
                            .accessibilityLabel(
                                unreadCount == 1
                                    ? "1 unread message"
                                    : "\(unreadCount) unread messages"
                            )
                    }
                }

                if let preview = channel.previewText {
                    Text(preview)
                        .font(.subheadline.weight(hasUnread ? .medium : .regular))
                        .foregroundStyle(hasUnread ? BrandTheme.textPrimary.opacity(0.9) : BrandTheme.textSecondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    if let type = channel.typeLabel {
                        Text(type)
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary.opacity(0.8))
                    }
                    if let updated = channel.updatedAt ?? channel.createdAt, !updated.isEmpty {
                        Text(CatalogDateFormat.friendlyDateTime(updated))
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary.opacity(0.8))
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityValue(hasUnread ? "\(unreadCount) unread" : "No unread")
    }
}

// MARK: - Thread detail

struct ChatThreadView: View {
    let channel: ChatChannelSummary

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @StateObject private var chatSocket = ChatWebSocketClient()
    @State private var messages: [ChatMessage] = []
    /// Mutable channel snapshot (seeded from inbox nav, refreshed via GET channel).
    /// Holds peer last-read watermarks for FR-8.2 Seen without a reply.
    @State private var channelMeta: ChatChannelSummary
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var showWebSafari = false
    @State private var draft = ""
    @State private var isSending = false
    @State private var isUploadingPhoto = false
    @State private var sendError: String?
    @State private var currentUserID: String?
    @State private var searchText = ""
    @State private var photoPickerItem: PhotosPickerItem?
    /// Remote user ids currently typing in this channel (from WS `typing` frames).
    @State private var typingUserIDs: Set<String> = []
    @State private var typingClearTask: Task<Void, Never>?
    @State private var lastTypingSentAt: Date = .distantPast
    @State private var showReportSheet = false
    @State private var confirmBlock = false
    @State private var isBlocking = false
    @State private var safetyStatusMessage: String?
    @State private var safetyStatusIsError = false
    /// In-flight Accept/Reject for a proposed-terms card (message id).
    @State private var termsRespondingMessageID: String?
    @State private var termsRespondError: String?
    /// Provider Propose Terms sheet (FR-5.4).
    @State private var showProposeTermsSheet = false
    /// Tip message id we last successfully POSTed mark-read for (dedupe scroll/open).
    @State private var lastMarkedReadTipMessageID: String?
    @State private var isMarkingRead = false
    #if canImport(UIKit)
    @State private var showCamera = false
    @State private var showCameraDeniedAlert = false
    @State private var cameraImage: UIImage?
    #endif
    @FocusState private var composerFocused: Bool

    init(channel: ChatChannelSummary) {
        self.channel = channel
        _channelMeta = State(initialValue: channel)
    }

    /// Fast REST poll when WebSocket is down (live substitute).
    private static let pollFallbackNanoseconds: UInt64 = 2_500_000_000
    /// Slow reconcile poll while WebSocket is connected (catch missed frames).
    private static let pollReconcileNanoseconds: UInt64 = 15_000_000_000
    /// Debounce for outbound typing frames (matches web ~300ms).
    private static let typingSendMinInterval: TimeInterval = 0.35
    /// Clear typing indicator if no refresh arrives.
    private static let typingDisplayTTLNanoseconds: UInt64 = 3_000_000_000

    private var webMessagesURL: URL {
        AppConfig.publicWebBaseURL.appending(path: "messages")
    }

    private var canCompose: Bool {
        !auth.isScaffoldSession && !needsSignIn
    }

    private var canSend: Bool {
        canCompose
            && !isSending
            && !isUploadingPhoto
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canAttachPhoto: Bool {
        canCompose && !isSending && !isUploadingPhoto
    }

    /// Show the live caption once the thread has content or is idle (not
    /// full-screen loading / hard empty-error shells that already fill chrome).
    private var showsLiveUpdateCaption: Bool {
        !needsSignIn && !(isLoading && messages.isEmpty) && errorMessage == nil
    }

    private var isLiveConnected: Bool {
        chatSocket.status == .connected
    }

    private var showsTypingIndicator: Bool {
        !typingUserIDs.isEmpty && canCompose
    }

    /// Local filter over loaded messages (no server search endpoint).
    private var displayedMessages: [ChatMessage] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return messages }
        return messages.filter { $0.matchesSearch(q) }
    }

    /// True when JWT `sub` is the channel customer (only party that may Accept/Reject terms).
    private var isChannelCustomer: Bool {
        let me = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let customer = channelMeta.customerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !me.isEmpty && !customer.isEmpty && me == customer
    }

    /// True when JWT `sub` is the channel provider (only party that may propose terms).
    private var isChannelProvider: Bool {
        let me = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let provider = channelMeta.providerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !me.isEmpty && !provider.isEmpty && me == provider
    }

    /// Provider may open Propose Terms when signed in and party is provider.
    /// Server rejects closed/read-only channels and non-providers.
    private var canProposeTerms: Bool {
        canCompose && isChannelProvider
    }

    /// Other party for block/report — customer vs provider relative to JWT `sub`.
    private var counterpartyUserID: String? {
        let me = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let customer = channelMeta.customerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let provider = channelMeta.providerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !me.isEmpty {
            if me == customer, !provider.isEmpty { return provider }
            if me == provider, !customer.isEmpty { return customer }
        }
        // Fall back: first non-self participant id we know.
        if !provider.isEmpty, provider != me { return provider }
        if !customer.isEmpty, customer != me { return customer }
        // Last resort: last message from someone else.
        if !me.isEmpty {
            for msg in messages.reversed() {
                if let sender = msg.senderId?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !sender.isEmpty, sender != me {
                    return sender
                }
            }
        }
        return nil
    }

    private var canMutateSafety: Bool {
        canCompose
            && counterpartyUserID != nil
            && !(counterpartyUserID == currentUserID)
    }

    /// Receipt under the caller's last own message only (web double-check parity).
    ///
    /// - **seen:** peer MarkRead watermark ≥ message `created_at`, or `is_read`, or
    ///   a later peer message (implies they opened the thread).
    /// - **sent:** last own message not yet covered by the above.
    ///
    /// Party-only: uses JWT `sub` vs `sender_id` / channel `customer_id`|`provider_id`
    /// via `peerLastReadAt`. Gateway re-enforces membership on list/mark-read.
    private var lastOwnReceipt: (messageID: String, status: MessageReceiptStatus)? {
        guard let me = currentUserID, !me.isEmpty else { return nil }
        guard let lastOwnIndex = messages.lastIndex(where: {
            ($0.senderId ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == me
        }) else {
            return nil
        }
        let lastOwn = messages[lastOwnIndex]

        // (1) Channel peer watermark — works without a peer reply.
        if let peerISO = channelMeta.peerLastReadAt(viewerUserID: me),
           let peerRead = CatalogDateFormat.parseISO(peerISO),
           let createdISO = lastOwn.createdAt,
           let created = CatalogDateFormat.parseISO(createdISO),
           peerRead >= created {
            return (lastOwn.id, .seen)
        }

        // (2) Explicit per-message is_read when populated on the wire.
        if lastOwn.isRead == true {
            return (lastOwn.id, .seen)
        }

        // (3) Fallback: peer replied after our last message (implies they opened the thread).
        let after = messages.index(after: lastOwnIndex)
        if after < messages.endIndex {
            let peerRepliedAfter = messages[after...].contains { msg in
                guard let sender = msg.senderId?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !sender.isEmpty
                else { return false }
                return sender != me
            }
            if peerRepliedAfter {
                return (lastOwn.id, .seen)
            }
        }

        // Not yet seen by peer — single check under last own bubble.
        return (lastOwn.id, .sent)
    }

    private func receiptStatus(for messageID: String) -> MessageReceiptStatus? {
        guard let lastOwnReceipt, lastOwnReceipt.messageID == messageID else { return nil }
        return lastOwnReceipt.status
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsLiveUpdateCaption {
                liveUpdateCaption
            }
            if showsTypingIndicator {
                typingIndicatorBar
            }
            threadBody
            Divider()
                .overlay(BrandTheme.gold.opacity(0.15))
            composerBar
        }
        .background(BrandTheme.navy.ignoresSafeArea())
        .navigationTitle(channel.displayTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .searchable(text: $searchText, prompt: "Search this conversation")
        .toolbar {
            if canProposeTerms {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showProposeTermsSheet = true
                    } label: {
                        Label("Propose terms", systemImage: "doc.badge.plus")
                    }
                    .accessibilityLabel("Propose terms")
                    .accessibilityHint("Open a form to propose local payment terms to the customer")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if canProposeTerms {
                        Button {
                            showProposeTermsSheet = true
                        } label: {
                            Label("Propose terms", systemImage: "doc.badge.plus")
                        }
                    }
                    if canMutateSafety {
                        Button {
                            showReportSheet = true
                        } label: {
                            Label("Report user", systemImage: "flag")
                        }
                        Button(role: .destructive) {
                            confirmBlock = true
                        } label: {
                            Label("Block user", systemImage: "hand.raised.fill")
                        }
                        .disabled(isBlocking)
                    }
                    Button {
                        showWebSafari = true
                    } label: {
                        Label("Open on web", systemImage: "safari")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Conversation actions")
                .accessibilityHint("Propose terms, report or block the other person, or open this chat on the web")
            }
        }
        .alert("Block this user?", isPresented: $confirmBlock) {
            Button("Cancel", role: .cancel) {}
            Button("Block", role: .destructive) {
                Task { await blockCounterparty() }
            }
        } message: {
            Text("They won’t be able to message you. You can unblock later from Account → Blocked users.")
        }
        .sheet(isPresented: $showReportSheet) {
            if let target = counterpartyUserID {
                ChatReportUserSheet(
                    userID: target,
                    channelID: channel.id,
                    onDone: { showReportSheet = false }
                )
                .environmentObject(auth)
            }
        }
        .sheet(isPresented: $showProposeTermsSheet) {
            ProposeTermsSheet(
                channelID: channel.id,
                onSent: { message in
                    appendMessageIfNeeded(message)
                    showProposeTermsSheet = false
                    Task { await markChannelReadBestEffort() }
                },
                onCancel: { showProposeTermsSheet = false }
            )
            .environmentObject(auth)
        }
        .task {
            currentUserID = await APIClient.shared.currentUserID()
            // Open thread: load + mark read (auth required path inside helper).
            await loadMessages(showLoading: true, markRead: true)
        }
        .task(id: channel.id) {
            await runChatSocketLifecycle()
        }
        .task(id: channel.id) {
            // Hybrid REST poll: fast when WS down, slow reconcile when connected.
            // Cancels on disappear / id change. Stops on sign-out. Pauses when inactive.
            while !Task.isCancelled {
                let interval = isLiveConnected
                    ? Self.pollReconcileNanoseconds
                    : Self.pollFallbackNanoseconds
                do {
                    try await Task.sleep(nanoseconds: interval)
                } catch {
                    break
                }
                guard !Task.isCancelled else { break }
                if needsSignIn || auth.isScaffoldSession || !auth.isAuthenticated {
                    break
                }
                guard scenePhase == .active else { continue }
                // Poll only — mark-read is open/refresh/send, not every quiet tick.
                await loadMessages(showLoading: false, markRead: false)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Pause WS when backgrounded; reconnect when active again.
            if phase == .active {
                guard canCompose, auth.isAuthenticated, !auth.isScaffoldSession else { return }
                chatSocket.connect()
                chatSocket.subscribe(channelID: channel.id)
            } else {
                chatSocket.disconnect()
            }
        }
        .onChange(of: draft) { _, newValue in
            guard canCompose, isLiveConnected else { return }
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            let now = Date()
            guard now.timeIntervalSince(lastTypingSentAt) >= Self.typingSendMinInterval else {
                return
            }
            lastTypingSentAt = now
            chatSocket.sendTyping(channelID: channel.id)
        }
        .onDisappear {
            typingClearTask?.cancel()
            typingClearTask = nil
            typingUserIDs = []
            chatSocket.onEvent = nil
            chatSocket.disconnect()
        }
        .refreshable {
            await loadMessages(showLoading: false, markRead: true)
        }
        .sheet(isPresented: $showWebSafari) {
            NavigationStack {
                LegalWebView(title: "Messages on web", url: webMessagesURL)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showWebSafari = false }
                                .frame(minHeight: 44)
                        }
                    }
            }
        }
        #if canImport(UIKit)
        .sheet(isPresented: $showCamera) {
            CameraImagePicker(image: $cameraImage)
                .ignoresSafeArea()
        }
        .cameraDeniedAlert(isPresented: $showCameraDeniedAlert)
        .onChange(of: cameraImage) { _, image in
            guard let image else { return }
            Task { await uploadAndSendCamera(image) }
        }
        #endif
        .onChange(of: photoPickerItem) { _, item in
            guard let item else { return }
            Task { await uploadAndSendPhoto(item) }
        }
    }

    #if canImport(UIKit)
    @MainActor
    private func requestCamera() async {
        switch await CameraAuthorization.prepareToPresent() {
        case .ready:
            showCamera = true
        case .denied:
            showCameraDeniedAlert = true
        case .unavailable:
            sendError = "Camera is not available on this device. Choose a photo from your library instead."
        }
    }
    #endif

    /// Live status strip: Live (WS) vs Updating… (REST poll fallback).
    private var liveUpdateCaption: some View {
        HStack(spacing: 6) {
            Image(systemName: isLiveConnected ? "antenna.radiowaves.left.and.right" : "arrow.triangle.2.circlepath")
                .font(.caption2)
                .foregroundStyle(
                    isLiveConnected
                        ? BrandTheme.accent.opacity(0.95)
                        : BrandTheme.textSecondary.opacity(0.85)
                )
                .accessibilityHidden(true)
            Text(isLiveConnected ? "Live" : "Updating every few seconds")
                .font(.caption2)
                .foregroundStyle(
                    isLiveConnected
                        ? BrandTheme.accent.opacity(0.95)
                        : BrandTheme.textSecondary.opacity(0.9)
                )
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(BrandTheme.navyElevated.opacity(0.65))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            isLiveConnected
                ? "Live conversation connection"
                : "Conversation updates every few seconds"
        )
        .accessibilityHint(
            isLiveConnected
                ? "Messages arrive in real time while this thread is open"
                : "Messages refresh automatically while this thread is open"
        )
    }

    private var typingIndicatorBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "ellipsis.bubble")
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
                .accessibilityHidden(true)
            Text(typingUserIDs.count > 1 ? "Several people are typing…" : "Typing…")
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.95))
                .italic()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .background(BrandTheme.navyElevated.opacity(0.45))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Someone is typing")
    }

    /// Connect WS for this channel; tears down when the task is cancelled (leave thread).
    @MainActor
    private func runChatSocketLifecycle() async {
        guard !auth.isScaffoldSession, auth.isAuthenticated else { return }

        chatSocket.onEvent = { [channelID = channel.id] event in
            handleSocketEvent(event, expectedChannelID: channelID)
        }
        chatSocket.connect()
        chatSocket.subscribe(channelID: channel.id)

        // Stay alive until the view/task is cancelled, then disconnect.
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            } catch {
                break
            }
            if needsSignIn || !auth.isAuthenticated || auth.isScaffoldSession {
                break
            }
        }
        chatSocket.disconnect()
        typingUserIDs = []
    }

    @MainActor
    private func handleSocketEvent(_ event: ChatWebSocketClient.ServerEvent, expectedChannelID: String) {
        switch event {
        case .message(let channelID, let message):
            guard channelID.isEmpty || channelID == expectedChannelID else { return }
            if let message {
                appendMessageIfNeeded(message)
            }
            // Prefer REST refetch (web does the same) so wire-shape drift can't drop content.
            Task { await loadMessages(showLoading: false, markRead: false) }
        case .typing(let channelID, let userID):
            guard channelID == expectedChannelID else { return }
            if let me = currentUserID, me == userID { return }
            typingUserIDs.insert(userID)
            scheduleTypingClear()
        case .unreadUpdate:
            // Thread is open — mark-read on open handles badges; no UI action required.
            break
        case .readReceipt(let channelID, let userID, let lastReadAt):
            guard channelID.isEmpty || channelID == expectedChannelID else { return }
            guard let lastReadAt, !lastReadAt.isEmpty else { return }
            // Patch peer watermark so Sent → Seen without waiting for poll.
            let customer = channelMeta.customerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let provider = channelMeta.providerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let reader = userID.trimmingCharacters(in: .whitespacesAndNewlines)
            if !customer.isEmpty, reader == customer {
                channelMeta.customerLastReadAt = lastReadAt
            } else if !provider.isEmpty, reader == provider {
                channelMeta.providerLastReadAt = lastReadAt
            }
        case .error:
            // Protocol errors are non-fatal; poll fallback covers recovery.
            break
        }
    }

    private func scheduleTypingClear() {
        typingClearTask?.cancel()
        typingClearTask = Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: Self.typingDisplayTTLNanoseconds)
            } catch {
                return
            }
            typingUserIDs = []
        }
    }

    @ViewBuilder
    private var threadBody: some View {
        if needsSignIn {
            BrandEmptyState(
                title: "Sign in required",
                systemImage: "lock.circle",
                message: "Session expired. Sign in again to read this conversation.",
                actionTitle: "Sign in"
            ) {
                auth.signOut()
            }
        } else if isLoading && messages.isEmpty {
            ProgressView("Loading messages…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, messages.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load thread",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again",
                action: { Task { await loadMessages(showLoading: true, markRead: true) } },
                secondaryActionTitle: "Open on web",
                secondaryAction: { showWebSafari = true }
            )
        } else if messages.isEmpty {
            BrandEmptyState(
                title: "No messages yet",
                systemImage: "text.bubble",
                message: canCompose
                    ? "Say hello below or attach a photo — your first message starts the thread. Messages are plain text or platform photos (don’t paste scripts or HTML). Pull to refresh anytime."
                    : "This channel has no messages yet."
            )
        } else if displayedMessages.isEmpty {
            BrandEmptyState(
                title: "No matches",
                systemImage: "magnifyingglass",
                message: "No messages in this thread match “\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))”. Clear search to see the full conversation."
            )
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(displayedMessages) { message in
                            MessageBubbleRow(
                                message: message,
                                isMine: isMine(message),
                                receipt: receiptStatus(for: message.id),
                                canRespondToTerms: canRespondToProposedTerms(message),
                                isRespondingToTerms: termsRespondingMessageID == message.id,
                                onAcceptTerms: { Task { await respondToTerms(message: message, accepted: true) } },
                                onRejectTerms: { Task { await respondToTerms(message: message, accepted: false) } }
                            )
                            .id(message.id)
                            // Mark read when the thread tip becomes visible (scroll to bottom
                            // or initial open). Skips if already marked for this tip.
                            .onAppear {
                                guard searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                                    return
                                }
                                guard message.id == displayedMessages.last?.id else { return }
                                Task { await markChannelReadIfNeeded(tipMessageID: message.id) }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .background(BrandTheme.navy)
                .onChange(of: displayedMessages.count) { _, _ in
                    // Only auto-scroll when not filtering (search active would jump oddly).
                    guard searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                    if let lastID = displayedMessages.last?.id {
                        // A11Y.3 — skip scroll animation when Reduce Motion is on.
                        if accessibilityReduceMotion {
                            proxy.scrollTo(lastID, anchor: .bottom)
                        } else {
                            withAnimation(.easeOut(duration: 0.2)) {
                                proxy.scrollTo(lastID, anchor: .bottom)
                            }
                        }
                    }
                }
                .onAppear {
                    if let lastID = displayedMessages.last?.id {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var composerBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let safetyStatusMessage {
                Text(safetyStatusMessage)
                    .font(.caption)
                    .foregroundStyle(safetyStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }
            if auth.isScaffoldSession {
                Text("Browse-only mode can’t send messages. Sign out and sign in with a real account.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let sendError {
                Text(sendError)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(alignment: .bottom, spacing: 8) {
                // Photo attach — library (PhotosPicker). Upload uses our imaging pipeline only.
                PhotosPicker(
                    selection: $photoPickerItem,
                    matching: .images,
                    photoLibrary: .shared()
                ) {
                    Group {
                        if isUploadingPhoto {
                            ProgressView()
                                .controlSize(.small)
                                .tint(BrandTheme.accent)
                        } else {
                            Image(systemName: "photo.on.rectangle")
                                .font(.title3)
                                .foregroundStyle(
                                    canAttachPhoto
                                        ? BrandTheme.accent
                                        : BrandTheme.textSecondary.opacity(0.5)
                                )
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .disabled(!canAttachPhoto)
                .accessibilityLabel("Attach photo")
                .accessibilityHint("Upload a photo from your library to this conversation")

                #if canImport(UIKit)
                Button {
                    Task { await requestCamera() }
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.title3)
                        .foregroundStyle(
                            canAttachPhoto && UIImagePickerController.isSourceTypeAvailable(.camera)
                                ? BrandTheme.accent
                                : BrandTheme.textSecondary.opacity(0.5)
                        )
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canAttachPhoto || !UIImagePickerController.isSourceTypeAvailable(.camera))
                .accessibilityLabel("Take photo")
                .accessibilityHint("Capture a photo with the camera for this conversation")
                #endif

                TextField("Message", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(1 ... 5)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
                    )
                    .focused($composerFocused)
                    .disabled(!canCompose || isSending || isUploadingPhoto)
                    .accessibilityLabel("Message")

                Button {
                    Task { await sendText() }
                } label: {
                    Group {
                        if isSending {
                            ProgressView()
                                .controlSize(.small)
                                .tint(BrandTheme.accent)
                        } else {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.largeTitle)
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(canSend ? BrandTheme.accent : BrandTheme.textSecondary.opacity(0.5))
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel("Send message")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandTheme.navyElevated)
    }

    private func isMine(_ message: ChatMessage) -> Bool {
        guard let me = currentUserID, let sender = message.senderId else {
            return false
        }
        return me == sender
    }

    @MainActor
    private func blockCounterparty() async {
        safetyStatusMessage = nil
        safetyStatusIsError = false
        guard canMutateSafety, let target = counterpartyUserID else {
            safetyStatusIsError = true
            safetyStatusMessage = "Couldn’t determine the other person in this chat."
            return
        }

        isBlocking = true
        defer { isBlocking = false }

        do {
            try await APIClient.shared.blockUser(id: target, reason: "chat")
            safetyStatusIsError = false
            safetyStatusMessage = "User blocked. Manage blocks from Account → Blocked users."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            safetyStatusIsError = true
            safetyStatusMessage = "Sign in required to block users."
        } catch {
            safetyStatusIsError = true
            safetyStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadMessages(showLoading: Bool = true, markRead: Bool = false) async {
        if showLoading {
            isLoading = true
            errorMessage = nil
        }
        needsSignIn = false
        defer {
            if showLoading {
                isLoading = false
            }
        }

        if currentUserID == nil {
            currentUserID = await APIClient.shared.currentUserID()
        }

        do {
            async let messagesTask = APIClient.shared.fetchChannelMessages(
                channelID: channel.id,
                pageSize: 50
            )
            // Refresh peer last-read watermarks alongside messages (best-effort).
            async let channelTask = APIClient.shared.fetchChatChannel(channelID: channel.id)

            let response = try await messagesTask
            // Chronological oldest → newest for chat reading order.
            let sorted = response.messages.sorted { lhs, rhs in
                (lhs.createdAt ?? "") < (rhs.createdAt ?? "")
            }
            // Avoid clobbering optimistic sends with an older poll snapshot when possible.
            if sorted.map(\.id) != messages.map(\.id) {
                messages = sorted
            }
            if let refreshed = try? await channelTask {
                channelMeta = refreshed
            }
            if markRead {
                // Open / pull-to-refresh: always attempt (force) so peer watermark updates.
                await markChannelReadBestEffort(force: true)
            }
        } catch let error as APIClientError where error.isUnauthorized {
            if showLoading {
                messages = []
            }
            needsSignIn = true
        } catch {
            if messages.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func sendText() async {
        guard canCompose else {
            sendError = "Sign in with a real account to send messages."
            return
        }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        isSending = true
        sendError = nil
        defer { isSending = false }

        do {
            let created = try await APIClient.shared.sendChannelMessage(
                channelID: channel.id,
                content: text,
                messageType: "text"
            )
            draft = ""
            composerFocused = false
            appendMessageIfNeeded(created)
            if currentUserID == nil {
                currentUserID = await APIClient.shared.currentUserID()
            }
            await markChannelReadBestEffort()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            sendError = "Session expired. Sign in again to send."
        } catch {
            sendError = error.localizedDescription
        }
    }

    /// Photos library → imaging upload (`job_photo`) → chat message `message_type: image`.
    @MainActor
    private func uploadAndSendPhoto(_ item: PhotosPickerItem) async {
        guard canCompose else {
            sendError = "Sign in with a real account to send photos."
            photoPickerItem = nil
            return
        }
        isUploadingPhoto = true
        sendError = nil
        defer {
            isUploadingPhoto = false
            photoPickerItem = nil
        }

        do {
            // Imaging allow-list has no dedicated chat context; job_photo is the public-photo path.
            let url = try await ImageUploader.upload(item: item, context: .job)
            let created = try await APIClient.shared.sendChannelImageMessage(
                channelID: channel.id,
                imageURL: url
            )
            appendMessageIfNeeded(created)
            if currentUserID == nil {
                currentUserID = await APIClient.shared.currentUserID()
            }
            await markChannelReadBestEffort()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            sendError = "Session expired. Sign in again to send photos."
        } catch {
            sendError = error.localizedDescription
        }
    }

    #if canImport(UIKit)
    @MainActor
    private func uploadAndSendCamera(_ image: UIImage) async {
        guard canCompose else {
            sendError = "Sign in with a real account to send photos."
            cameraImage = nil
            return
        }
        isUploadingPhoto = true
        sendError = nil
        defer {
            isUploadingPhoto = false
            cameraImage = nil
        }

        do {
            let url = try await ImageUploader.upload(uiImage: image, context: .job)
            let created = try await APIClient.shared.sendChannelImageMessage(
                channelID: channel.id,
                imageURL: url
            )
            appendMessageIfNeeded(created)
            if currentUserID == nil {
                currentUserID = await APIClient.shared.currentUserID()
            }
            await markChannelReadBestEffort()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            sendError = "Session expired. Sign in again to send photos."
        } catch {
            sendError = error.localizedDescription
        }
    }
    #endif

    private func appendMessageIfNeeded(_ created: ChatMessage) {
        if messages.contains(where: { $0.id == created.id }) {
            return
        }
        messages.append(created)
        messages.sort { ($0.createdAt ?? "") < ($1.createdAt ?? "") }
    }

    /// Customer may Accept/Reject the latest open proposed-terms card that is not theirs.
    /// Hides controls once any later terms_accepted/terms_rejected exists (explicit response).
    private func canRespondToProposedTerms(_ message: ChatMessage) -> Bool {
        guard canCompose, isChannelCustomer, !isMine(message), message.isProposedTermsMessage else {
            return false
        }
        // Only the most recent proposal without a subsequent accept/reject is actionable.
        guard let idx = messages.firstIndex(where: { $0.id == message.id }) else { return false }
        let later = messages.suffix(from: messages.index(after: idx))
        let alreadyResponded = later.contains { msg in
            let t = msg.normalizedType
            return t == "terms_accepted" || t == "terms_rejected"
        }
        if alreadyResponded { return false }
        // Prefer only the newest proposed-terms message.
        let laterProposal = later.contains(where: \.isProposedTermsMessage)
        return !laterProposal
    }

    /// POST `/api/v1/channels/{id}/terms/respond` — explicit Accept/Reject only.
    @MainActor
    private func respondToTerms(message: ChatMessage, accepted: Bool) async {
        guard canRespondToProposedTerms(message) else { return }
        termsRespondingMessageID = message.id
        termsRespondError = nil
        sendError = nil
        defer { termsRespondingMessageID = nil }

        do {
            let created = try await APIClient.shared.respondToProposedTerms(
                channelID: channel.id,
                accepted: accepted
            )
            appendMessageIfNeeded(created)
            await markChannelReadBestEffort()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            // Surface on the composer banner (termsRespondError alone is not rendered).
            let msg = "Session expired. Sign in again to respond to terms."
            termsRespondError = msg
            sendError = msg
        } catch {
            let msg = error.localizedDescription.isEmpty
                ? (accepted ? "Failed to accept terms." : "Failed to reject terms.")
                : error.localizedDescription
            termsRespondError = msg
            sendError = msg
        }
    }

    /// POST `/api/v1/channels/{id}/read` — best-effort; never surfaces as a thread error.
    /// Dedupes by tip message id so open + scroll-to-bottom + send don't thrash.
    /// `force: true` always hits the network (pull-to-refresh / explicit open).
    @MainActor
    private func markChannelReadIfNeeded(tipMessageID: String? = nil, force: Bool = false) async {
        guard canCompose else { return }
        let tip = tipMessageID ?? messages.last?.id
        if !force, let tip, tip == lastMarkedReadTipMessageID {
            // Already marked through this tip — still clear local badge if needed.
            if (channelMeta.unreadCount ?? 0) > 0 {
                channelMeta.unreadCount = 0
            }
            return
        }
        if isMarkingRead { return }
        isMarkingRead = true
        defer { isMarkingRead = false }

        do {
            try await APIClient.shared.markChannelRead(channelID: channel.id)
            lastMarkedReadTipMessageID = tip
            channelMeta.unreadCount = 0
        } catch {
            // Unread badges may lag until next open; message load/send still succeeded.
        }
    }

    /// Convenience for open/send/refresh paths (force network unless tip already marked).
    @MainActor
    private func markChannelReadBestEffort(force: Bool = false) async {
        await markChannelReadIfNeeded(tipMessageID: messages.last?.id, force: force)
    }
}

// MARK: - Propose local terms (provider-only, FR-5.4)

/// Payment schedule options for local-terms proposals (web MessageInput parity).
private enum ProposeTermsPaymentType: String, CaseIterable, Identifiable {
    case completion
    case upfront
    case milestone
    case paymentPlan = "payment_plan"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .completion: return "On completion"
        case .upfront: return "Upfront"
        case .milestone: return "Milestone"
        case .paymentPlan: return "Payment plan"
        }
    }
}

/// Provider sheet: payment type, dollar amount → Int64 cents, optional milestones, description.
/// POST `/api/v1/channels/{id}/proposed-terms` (auth; server enforces provider-only).
private struct ProposeTermsSheet: View {
    let channelID: String
    var onSent: (ChatMessage) -> Void
    var onCancel: () -> Void

    @EnvironmentObject private var auth: AuthViewModel

    @State private var paymentType: ProposeTermsPaymentType = .completion
    @State private var amountDollarsText = ""
    @State private var milestonesText = ""
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    private var parsedAmountCents: Int64? {
        MoneyFormat.cents(fromDollarsText: amountDollarsText)
    }

    private var canSubmit: Bool {
        !auth.isScaffoldSession
            && !isSubmitting
            && parsedAmountCents != nil
            && !descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Payment type", selection: $paymentType) {
                        ForEach(ProposeTermsPaymentType.allCases) { item in
                            Text(item.displayName).tag(item)
                        }
                    }
                    .accessibilityLabel("Payment type")

                    DollarAmountField(
                        text: $amountDollarsText,
                        placeholder: "0.00",
                        accessibilityLabelText: "Proposed amount in dollars"
                    )
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                } header: {
                    Text("Terms").brandSectionHeader()
                } footer: {
                    Text("Enter dollars only (example 1,500.00). The app converts to integer cents before sending — never paste raw cents.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if paymentType == .milestone {
                    Section {
                        TextField("One milestone per line", text: $milestonesText, axis: .vertical)
                            .lineLimit(3 ... 8)
                            .foregroundStyle(BrandTheme.textPrimary)
                            .accessibilityLabel("Milestones")
                            .accessibilityHint("One milestone per line, for example Initial deposit - 20%")
                    } header: {
                        Text("Milestones").brandSectionHeader()
                    }
                }

                Section {
                    TextField("Describe scope of work", text: $descriptionText, axis: .vertical)
                        .lineLimit(2 ... 6)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .accessibilityLabel("Description")
                        .accessibilityHint("Required. Summarize what is included in these terms")
                } header: {
                    Text("Description").brandSectionHeader()
                } footer: {
                    Text("Proposals do not bind the contract until the customer Accepts. Reject leaves terms open for a new proposal.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            HStack {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Sending proposal…")
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        } else if let cents = parsedAmountCents {
                            Text("Send proposal · \(MoneyFormat.usd(cents: cents))")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Send proposal")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .disabled(!canSubmit)
                    .tint(BrandTheme.accent)
                    .accessibilityLabel("Send proposal")
                    .accessibilityHint("Posts proposed local terms for the customer to accept or reject")
                }
            }
            .brandListBackground()
            .navigationTitle("Propose terms")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .disabled(isSubmitting)
                }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    @MainActor
    private func submit() async {
        guard canSubmit, let amountCents = parsedAmountCents else { return }
        isSubmitting = true
        statusMessage = nil
        statusIsError = false
        defer { isSubmitting = false }

        do {
            let created = try await APIClient.shared.sendProposedTerms(
                channelID: channelID,
                paymentType: paymentType.rawValue,
                amountCents: amountCents,
                milestones: paymentType == .milestone ? milestonesText : "",
                description: descriptionText
            )
            onSent(created)
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Session expired. Sign in again to propose terms."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Chat report sheet (channel-scoped)

private enum ChatUserReportReason: String, CaseIterable, Identifiable {
    case harassment
    case spam
    case scam
    case inappropriate
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .harassment: return "Harassment"
        case .spam: return "Spam"
        case .scam: return "Scam"
        case .inappropriate: return "Inappropriate"
        case .other: return "Other"
        }
    }
}

/// Report the other party with optional `channel_id` for moderator context.
private struct ChatReportUserSheet: View {
    let userID: String
    let channelID: String
    var onDone: () -> Void

    @EnvironmentObject private var auth: AuthViewModel

    @State private var reason: ChatUserReportReason = .spam
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(ChatUserReportReason.allCases) { item in
                            Text(item.displayName).tag(item)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Report reason")
                } header: {
                    Text("Why are you reporting?").brandSectionHeader()
                }

                Section {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Additional details")
                } header: {
                    Text("Details (optional)").brandSectionHeader()
                } footer: {
                    Text("This report includes this conversation so moderators can review context. You can also block the user separately.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isSubmitting || !auth.isAuthenticated || auth.isScaffoldSession)
                }
            }
            .brandListBackground()
            .navigationTitle("Report user")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDone() }
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        statusMessage = nil
        statusIsError = false
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let response = try await APIClient.shared.reportUser(
                id: userID,
                reason: reason.rawValue,
                description: descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
                channelId: channelID
            )
            statusIsError = false
            if response.status == "already_reported" {
                statusMessage = response.message
                    ?? "You’ve already reported this — our team is reviewing it."
            } else {
                statusMessage = "Thanks — your report was submitted."
            }
            try? await Task.sleep(nanoseconds: 900_000_000)
            onDone()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Receipt status (FR-8.2)

/// Delivery/read status for the caller's last own message only.
private enum MessageReceiptStatus: Equatable, Sendable {
    /// Delivered to server; peer has not yet marked the channel read through this tip.
    case sent
    /// Peer MarkRead watermark (or reply / is_read) covers this message.
    case seen
}

// MARK: - Bubble

private struct MessageBubbleRow: View {
    let message: ChatMessage
    let isMine: Bool
    /// A11Y.3: solid incoming-bubble border under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    /// Receipt under last own message only (nil elsewhere).
    var receipt: MessageReceiptStatus? = nil
    /// Customer-only Accept/Reject for proposed local terms (FR-8.9).
    var canRespondToTerms: Bool = false
    var isRespondingToTerms: Bool = false
    var onAcceptTerms: (() -> Void)?
    var onRejectTerms: (() -> Void)?

    var body: some View {
        if message.isSystemMessage {
            systemRow
        } else if message.isProposedTermsMessage {
            proposedTermsRow
        } else {
            standardBubbleRow
        }
    }

    /// Double-check + "Seen" when peer read; single check when sent only.
    @ViewBuilder
    private var receiptCaption: some View {
        if isMine, let receipt {
            switch receipt {
            case .seen:
                HStack(spacing: 4) {
                    doubleCheckmarks(color: BrandTheme.teal.opacity(0.95))
                    Text("Seen")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(BrandTheme.teal.opacity(0.95))
                }
                .padding(.trailing, 8)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Seen by the other party")
            case .sent:
                HStack(spacing: 4) {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                        .accessibilityHidden(true)
                }
                .padding(.trailing, 8)
                .accessibilityLabel("Sent")
            }
        }
    }

    private func doubleCheckmarks(color: Color) -> some View {
        // Two overlapping checkmarks — web CheckCheck parity (no dedicated SF Symbol).
        HStack(spacing: -5) {
            Image(systemName: "checkmark")
                .font(.caption2.weight(.bold))
            Image(systemName: "checkmark")
                .font(.caption2.weight(.bold))
        }
        .foregroundStyle(color)
        .accessibilityHidden(true)
    }

    private var receiptA11ySuffix: String {
        guard isMine, let receipt else { return "" }
        switch receipt {
        case .seen: return ", Seen"
        case .sent: return ", Sent"
        }
    }

    // MARK: System (centered pill)

    private var systemRow: some View {
        HStack {
            Spacer(minLength: 24)
            Text(message.displayBody)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule(style: .continuous)
                        .fill(BrandTheme.surfaceRaised.opacity(0.9))
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.12), lineWidth: 1)
                )
            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message.displayBody)
    }

    // MARK: Proposed terms card (FR-8.9)
    // Accept/Reject → POST …/terms/respond (customer-only, explicit consent).

    private var proposedTermsRow: some View {
        VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
            HStack {
                if isMine { Spacer(minLength: 32) }

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text.fill")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.goldBright)
                            .accessibilityHidden(true)
                        Text("Proposed Terms")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                            .textCase(.uppercase)
                        Spacer(minLength: 0)
                    }

                    if let terms = message.parsedProposedTerms {
                        proposedTermsFields(terms)
                    } else {
                        // Fallback: plain body if prefix matched but fields empty.
                        Text(message.displayBody)
                            .font(.body)
                            .foregroundStyle(BrandTheme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if canRespondToTerms {
                        proposedTermsActions
                    }

                    metaRow(onGold: false)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: 320, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(BrandTheme.surfaceRaised)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.35), lineWidth: 1)
                )

                if !isMine { Spacer(minLength: 32) }
            }
            .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)

            receiptCaption
        }
        // Keep children accessible when Accept/Reject are present (interactive buttons).
        .modifier(ProposedTermsA11yModifier(
            combineChildren: !canRespondToTerms,
            label: accessibilityText + receiptA11ySuffix
        ))
    }

    @ViewBuilder
    private func proposedTermsFields(_ terms: ProposedTermsPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !terms.paymentType.isEmpty {
                termsFieldRow(
                    label: "Payment",
                    value: terms.paymentType.replacingOccurrences(of: "_", with: " ").capitalized
                )
            }
            if !terms.amount.isEmpty {
                termsFieldRow(label: "Amount", value: terms.amount, emphasize: true)
            }
            if let milestones = terms.milestones, !milestones.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Milestones")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(milestones)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !terms.description.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Scope")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(terms.description)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Explicit Accept / Reject — never auto-bound; requires customer action.
    private var proposedTermsActions: some View {
        HStack(spacing: 10) {
            Button {
                onRejectTerms?()
            } label: {
                Text("Reject")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(BrandTheme.destructive)
            .disabled(isRespondingToTerms)
            .accessibilityLabel("Reject proposed terms")

            Button {
                onAcceptTerms?()
            } label: {
                Group {
                    if isRespondingToTerms {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Accept")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.teal)
            .disabled(isRespondingToTerms)
            .accessibilityLabel("Accept proposed terms")
        }
        .padding(.top, 4)
    }

    private func termsFieldRow(label: String, value: String, emphasize: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer(minLength: 8)
            Text(value)
                .font(emphasize ? .subheadline.weight(.semibold) : .subheadline.weight(.medium))
                .foregroundStyle(BrandTheme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    // MARK: Standard text / image bubble

    private var standardBubbleRow: some View {
        VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
            HStack {
                if isMine { Spacer(minLength: 48) }

                VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                    bubbleContent
                    metaRow(onGold: isMine)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(isMine ? BrandTheme.accent : BrandTheme.surfaceRaised)
                )
                .overlay {
                    if !isMine {
                        // Incoming: subtle electric-blue border (not gold).
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(
                                reduceTransparency
                                    ? BrandTheme.chatIncomingBorderOpaque
                                    : BrandTheme.chatIncomingBorder,
                                lineWidth: 1
                            )
                    }
                }
                .frame(maxWidth: 320, alignment: isMine ? .trailing : .leading)

                if !isMine { Spacer(minLength: 48) }
            }
            .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)

            // FR-8.2 read receipt — only under last own message (sent / seen).
            receiptCaption
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText + receiptA11ySuffix)
    }

    private func metaRow(onGold: Bool) -> some View {
        HStack(spacing: 6) {
            if let type = message.messageType,
               message.normalizedType != "text",
               !message.isProposedTermsMessage,
               !type.isEmpty {
                Text(type.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption2)
            }
            if let created = message.createdAt, !created.isEmpty {
                Text(CatalogDateFormat.friendlyDateTime(created))
                    .font(.caption2)
            }
        }
        .foregroundStyle(onGold ? BrandTheme.ctaLabelOnGold.opacity(0.75) : BrandTheme.textSecondary)
    }

    @ViewBuilder
    private var bubbleContent: some View {
        if message.isImageMessage, let url = message.safeImageURL {
            // Platform photo only — AsyncImage loads https/http absolute URL from content.
            // Plain Text fallback if decode fails; never HTML / attributed string.
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: 240, maxHeight: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                case .failure:
                    Label("Photo unavailable", systemImage: "photo")
                        .font(.subheadline)
                        .foregroundStyle(isMine ? BrandTheme.ctaLabelOnGold : BrandTheme.textSecondary)
                default:
                    ProgressView()
                        .tint(isMine ? BrandTheme.navy : BrandTheme.accent)
                        .frame(width: 120, height: 90)
                }
            }
            .accessibilityLabel("Photo")
        } else if message.isImageMessage {
            // Image type without a safe URL — never render content as HTML.
            Label("Photo", systemImage: "photo")
                .font(.body)
                .foregroundStyle(isMine ? BrandTheme.ctaLabelOnGold : BrandTheme.textPrimary)
        } else {
            // Plain `Text` only — never attributed HTML (XSS-safe).
            Text(message.displayBody)
                .font(.body)
                .foregroundStyle(isMine ? BrandTheme.ctaLabelOnGold : BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(isMine ? .trailing : .leading)
        }
    }

    private var accessibilityText: String {
        if message.isProposedTermsMessage {
            return isMine ? "You proposed terms: \(message.displayBody)" : "Proposed terms: \(message.displayBody)"
        }
        if message.isImageMessage {
            return isMine ? "You sent a photo" : "Photo"
        }
        if message.isSystemMessage {
            return message.displayBody
        }
        return isMine ? "You: \(message.displayBody)" : message.displayBody
    }
}

/// Combines the proposed-terms card for VoiceOver unless Accept/Reject are shown
/// (interactive children must remain individually focusable).
private struct ProposedTermsA11yModifier: ViewModifier {
    let combineChildren: Bool
    let label: String

    func body(content: Content) -> some View {
        if combineChildren {
            content
                .accessibilityElement(children: .combine)
                .accessibilityLabel(label)
        } else {
            content
                .accessibilityElement(children: .contain)
        }
    }
}

#Preview {
    MessagesView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
