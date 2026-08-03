import CoreLocation
import Foundation

/// One-shot When-In-Use GPS fix for job-site check-in / check-out.
///
/// GPS is **required** by the gateway (`POST …/checkin|checkout` body `{ lat, lng }`).
/// Mirrors web `useCheckIn` / `useCheckOut` (high accuracy, short timeout).
@MainActor
final class JobSiteLocationProvider: NSObject, CLLocationManagerDelegate {
    enum LocationError: LocalizedError {
        case permissionDenied
        case unavailable
        case timedOut

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "GPS is required for check-in so we can confirm you arrived at the job site (stored with the contract for dispute protection). Enable location access and try again."
            case .unavailable:
                return "GPS is required for check-in. We could not read your location — check that location services are on, then try again."
            case .timedOut:
                return "Location request timed out. Move outdoors or wait for GPS lock, then try again."
            }
        }
    }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?
    private var timeoutTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// Requests When-In-Use if needed, then a single location fix.
    func currentCoordinate(timeoutSeconds: TimeInterval = 12) async throws -> CLLocationCoordinate2D {
        if continuation != nil {
            throw LocationError.unavailable
        }

        return try await withCheckedThrowingContinuation { cont in
            continuation = cont

            timeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                guard let self, !Task.isCancelled else { return }
                self.finish(.failure(LocationError.timedOut))
            }

            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .authorizedAlways, .authorizedWhenInUse:
                manager.requestLocation()
            case .denied, .restricted:
                finish(.failure(LocationError.permissionDenied))
            @unknown default:
                finish(.failure(LocationError.permissionDenied))
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            switch status {
            case .authorizedAlways, .authorizedWhenInUse:
                if self.continuation != nil {
                    self.manager.requestLocation()
                }
            case .denied, .restricted:
                self.finish(.failure(LocationError.permissionDenied))
            case .notDetermined:
                break
            @unknown default:
                self.finish(.failure(LocationError.permissionDenied))
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        Task { @MainActor in
            self.finish(.success(coordinate))
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            if let cl = error as? CLError, cl.code == .denied {
                self.finish(.failure(LocationError.permissionDenied))
            } else {
                self.finish(.failure(LocationError.unavailable))
            }
        }
    }

    private func finish(_ result: Result<CLLocationCoordinate2D, Error>) {
        timeoutTask?.cancel()
        timeoutTask = nil
        guard let cont = continuation else { return }
        continuation = nil
        cont.resume(with: result)
    }
}
