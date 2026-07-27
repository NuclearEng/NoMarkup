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
/// - Mark read on open / pull-to-refresh / after send
/// - Local in-thread search over loaded messages
/// - **Residual:** read-receipts UI (server has no iOS-facing receipt frame
///   beyond mark-read REST); inbox-level live unread badges without opening a
///   thread; proposed-terms message type UI (FR-8.9)
struct MessagesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var channels: [ChatChannelSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Messages")
                .toolbarBackground(BrandTheme.navy, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .refreshable { await load() }
                .task { await load() }
                .navigationDestination(for: ChatChannelSummary.self) { channel in
                    ChatThreadView(channel: channel)
                }
        }
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
                        NavigationLink(value: channel) {
                            ChannelRowView(channel: channel)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens conversation")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(channels.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("Inbox").brandSectionHeader()
                    }
                } footer: {
                    Text("Open a conversation for live updates (WebSocket when available, otherwise a few-second refresh). Attach photos from the thread composer. Inbox refreshes when you pull down.")
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

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.title3)
                .foregroundStyle(BrandTheme.accent)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(channel.displayTitle)
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let unread = channel.unreadCount, unread > 0 {
                        Text("\(unread)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.navy)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(BrandTheme.accent))
                            .accessibilityLabel("\(unread) unread")
                    }
                }

                if let preview = channel.previewText {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
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
    }
}

// MARK: - Thread detail

struct ChatThreadView: View {
    let channel: ChatChannelSummary

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var chatSocket = ChatWebSocketClient()
    @State private var messages: [ChatMessage] = []
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
    #if canImport(UIKit)
    @State private var showCamera = false
    @State private var cameraImage: UIImage?
    #endif
    @FocusState private var composerFocused: Bool

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
        .toolbarBackground(.visible, for: .navigationBar)
        .searchable(text: $searchText, prompt: "Search this conversation")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showWebSafari = true
                } label: {
                    Label("Open on web", systemImage: "safari")
                }
                .frame(minHeight: 44)
            }
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
                                isMine: isMine(message)
                            )
                            .id(message.id)
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
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(lastID, anchor: .bottom)
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
                                .font(.system(size: 22))
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
                    showCamera = true
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 20))
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
                                .font(.system(size: 32))
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
            let response = try await APIClient.shared.fetchChannelMessages(
                channelID: channel.id,
                pageSize: 50
            )
            // Chronological oldest → newest for chat reading order.
            let sorted = response.messages.sorted { lhs, rhs in
                (lhs.createdAt ?? "") < (rhs.createdAt ?? "")
            }
            // Avoid clobbering optimistic sends with an older poll snapshot when possible.
            if sorted.map(\.id) != messages.map(\.id) {
                messages = sorted
            }
            if markRead {
                await markChannelReadBestEffort()
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

    /// POST `/api/v1/channels/{id}/read` — best-effort; never surfaces as a thread error.
    @MainActor
    private func markChannelReadBestEffort() async {
        guard canCompose else { return }
        do {
            try await APIClient.shared.markChannelRead(channelID: channel.id)
        } catch {
            // Unread badges may lag until next open; message load/send still succeeded.
        }
    }
}

// MARK: - Bubble

private struct MessageBubbleRow: View {
    let message: ChatMessage
    let isMine: Bool

    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 48) }

            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                bubbleContent

                HStack(spacing: 6) {
                    if let type = message.messageType,
                       message.normalizedType != "text",
                       !type.isEmpty {
                        Text(type.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.caption2)
                    }
                    if let created = message.createdAt, !created.isEmpty {
                        Text(CatalogDateFormat.friendlyDateTime(created))
                            .font(.caption2)
                    }
                }
                .foregroundStyle(isMine ? BrandTheme.navy.opacity(0.75) : BrandTheme.textSecondary)
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
                        .strokeBorder(BrandTheme.chatIncomingBorder, lineWidth: 1)
                }
            }
            .frame(maxWidth: 320, alignment: isMine ? .trailing : .leading)

            if !isMine { Spacer(minLength: 48) }
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
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
        if message.isImageMessage {
            return isMine ? "You sent a photo" : "Photo"
        }
        return isMine ? "You: \(message.displayBody)" : message.displayBody
    }
}

#Preview {
    MessagesView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
