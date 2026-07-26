import SwiftUI

/// Chat channel inbox — `GET /api/v1/channels` (auth). Thread detail loads + sends messages.
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
                message: "Scaffold session has no API token. Sign out and sign in with a real account to load chat threads.",
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
    @State private var messages: [ChatMessage] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var showWebSafari = false
    @State private var draft = ""
    @State private var isSending = false
    @State private var sendError: String?
    @State private var currentUserID: String?
    @FocusState private var composerFocused: Bool

    private var webMessagesURL: URL {
        AppConfig.publicWebBaseURL.appending(path: "messages")
    }

    private var canCompose: Bool {
        !auth.isScaffoldSession && !needsSignIn
    }

    private var canSend: Bool {
        canCompose
            && !isSending
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
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
            await loadMessages()
        }
        .refreshable { await loadMessages() }
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
                action: { Task { await loadMessages() } },
                secondaryActionTitle: "Open on web",
                secondaryAction: { showWebSafari = true }
            )
        } else if messages.isEmpty {
            BrandEmptyState(
                title: "No messages yet",
                systemImage: "text.bubble",
                message: canCompose
                    ? "Say hello below — your first message starts the thread. Pull to refresh anytime."
                    : "This channel has no messages yet."
            )
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(messages) { message in
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
                .onChange(of: messages.count) { _, _ in
                    if let lastID = messages.last?.id {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(lastID, anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    if let lastID = messages.last?.id {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var composerBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if auth.isScaffoldSession {
                Text("Scaffold session can’t send messages. Sign out and sign in with a real account.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let sendError {
                Text(sendError)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(alignment: .bottom, spacing: 10) {
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
                    .disabled(!canCompose || isSending)
                    .accessibilityLabel("Message")

                Button {
                    Task { await send() }
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
    private func loadMessages() async {
        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        if currentUserID == nil {
            currentUserID = await APIClient.shared.currentUserID()
        }

        do {
            let response = try await APIClient.shared.fetchChannelMessages(
                channelID: channel.id,
                pageSize: 50
            )
            // Chronological oldest → newest for chat reading order.
            messages = response.messages.sorted { lhs, rhs in
                (lhs.createdAt ?? "") < (rhs.createdAt ?? "")
            }
        } catch let error as APIClientError where error.isUnauthorized {
            messages = []
            needsSignIn = true
        } catch {
            if messages.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func send() async {
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
                content: text
            )
            draft = ""
            composerFocused = false
            // Prefer server message; fall back to optimistic row if decode was sparse.
            if messages.contains(where: { $0.id == created.id }) {
                // already present (unlikely)
            } else {
                messages.append(created)
                messages.sort { ($0.createdAt ?? "") < ($1.createdAt ?? "") }
            }
            if currentUserID == nil {
                currentUserID = await APIClient.shared.currentUserID()
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            sendError = "Session expired. Sign in again to send."
        } catch {
            sendError = error.localizedDescription
        }
    }
}

private struct MessageBubbleRow: View {
    let message: ChatMessage
    let isMine: Bool

    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 48) }

            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                Text(message.displayBody)
                    .font(.body)
                    .foregroundStyle(isMine ? BrandTheme.navy : BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(isMine ? .trailing : .leading)

                HStack(spacing: 6) {
                    if let type = message.messageType, type != "text", !type.isEmpty {
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
                    .fill(isMine ? BrandTheme.accent : BrandTheme.navyElevated)
            )
            .overlay {
                if !isMine {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.12), lineWidth: 1)
                }
            }
            .frame(maxWidth: 320, alignment: isMine ? .trailing : .leading)

            if !isMine { Spacer(minLength: 48) }
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isMine ? "You: \(message.displayBody)" : message.displayBody)
    }
}

#Preview {
    MessagesView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
