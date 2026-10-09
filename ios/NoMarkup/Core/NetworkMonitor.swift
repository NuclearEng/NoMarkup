import Combine
import Foundation
import Network

/// App-wide path reachability via `NWPathMonitor`.
///
/// Exposes `isOnline` for a non-blocking offline banner. Does not gate API calls —
/// `APIClient` still surfaces transport failures as `.unreachable` after retries.
@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    /// `true` when the system path is `.satisfied` (Wi‑Fi, cellular, or other usable interface).
    @Published private(set) var isOnline: Bool = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.nomarkup.network-monitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                if self.isOnline != online {
                    self.isOnline = online
                }
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}
