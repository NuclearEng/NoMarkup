import SwiftUI

/// Chat channel inbox — `GET /api/v1/channels` (auth). Thread detail loads messages when available.
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
            ContentUnavailableView {
                Label("Sign in for messages", systemImage: "person.crop.circle.badge.exclamationmark")
            } description: {
                Text("Scaffold session has no API token. Sign out and sign in with a real account to load chat threads.")
            } actions: {
                Button("Sign out to log in") {
                    auth.signOut()
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if needsSignIn {
            ContentUnavailableView {
                Label("Sign in required", systemImage: "lock.circle")
            } description: {
                Text("Your session expired or is missing. Sign in again to see conversations.")
            } actions: {
                Button("Sign in") {
                    auth.signOut()
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if isLoading && channels.isEmpty {
            ProgressView("Loading messages…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, channels.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load messages", systemImage: "wifi.exclamationmark")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Try again") {
                    Task { await load() }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if channels.isEmpty {
            ContentUnavailableView {
                Label("No conversations yet", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("Chat threads with providers and customers appear here after you bid or award a job.")
            }
        } else {
            List {
                Section {
                    ForEach(channels) { channel in
                        NavigationLink(value: channel) {
                            ChannelRowView(channel: channel)
                        }
                        .frame(minHeight: 44)
                        .accessibilityHint("Opens conversation")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(channels.count) of \(total)")
                    } else {
                        Text("Inbox")
                    }
                }
            }
            .listStyle(.insetGrouped)
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
                .foregroundStyle(.tint)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(channel.displayTitle)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let unread = channel.unreadCount, unread > 0 {
                        Text("\(unread)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.accentColor))
                            .accessibilityLabel("\(unread) unread")
                    }
                }

                if let preview = channel.previewText {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    if let type = channel.typeLabel {
                        Text(type)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    if let updated = channel.updatedAt ?? channel.createdAt, !updated.isEmpty {
                        Text(Self.friendlyDate(updated))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private static func friendlyDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return iso
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

    private var webMessagesURL: URL {
        AppConfig.publicWebBaseURL.appending(path: "messages")
    }

    var body: some View {
        Group {
            if needsSignIn {
                ContentUnavailableView {
                    Label("Sign in required", systemImage: "lock.circle")
                } description: {
                    Text("Session expired. Sign in again to read this conversation.")
                } actions: {
                    Button("Sign in") {
                        auth.signOut()
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                }
            } else if isLoading && messages.isEmpty {
                ProgressView("Loading messages…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, messages.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load thread", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try again") {
                        Task { await loadMessages() }
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                    Button("Open on web") {
                        showWebSafari = true
                    }
                    .frame(minHeight: 44)
                }
            } else if messages.isEmpty {
                ContentUnavailableView {
                    Label("No messages yet", systemImage: "text.bubble")
                } description: {
                    Text("This channel has no messages. Compose and full real-time chat are on the web for now.")
                } actions: {
                    Button("Open on web") {
                        showWebSafari = true
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                }
            } else {
                List {
                    Section {
                        ForEach(messages) { message in
                            MessageBubbleRow(message: message)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                        }
                    } footer: {
                        Text("Read-only on iOS for now. Reply on the website.")
                            .font(.caption)
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle(channel.displayTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
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
        .task { await loadMessages() }
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

    @MainActor
    private func loadMessages() async {
        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchChannelMessages(
                channelID: channel.id,
                pageSize: 50
            )
            // API returns newest-first or oldest-first depending on service; show chronological.
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
}

private struct MessageBubbleRow: View {
    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message.displayBody)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                if let type = message.messageType, type != "text", !type.isEmpty {
                    Text(type.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if let created = message.createdAt, !created.isEmpty {
                    Text(Self.friendlyDate(created))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private static func friendlyDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return iso
    }
}

#Preview {
    MessagesView()
        .environmentObject(AuthViewModel())
}
