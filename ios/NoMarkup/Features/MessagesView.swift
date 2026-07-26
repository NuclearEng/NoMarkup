import SwiftUI

struct MessagesView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Messages", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("Chat threads load from the chat service over the gateway and WebSocket later. This screen is native chrome only.")
            } actions: {
                Text("No conversations yet")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Messages")
        }
    }
}

#Preview {
    MessagesView()
}
