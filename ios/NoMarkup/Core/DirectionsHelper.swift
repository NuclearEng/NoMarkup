import Foundation
import MapKit

#if canImport(UIKit)
import UIKit
#endif

// MARK: - Exact service address (party-only)

/// Street-level service address from `GET /api/v1/jobs/{id}` → `exact_address`.
/// Server only populates this for the job owner or awarded provider.
/// Never use approximate city/state alone when this is absent.
struct JobExactAddress: Codable, Sendable, Hashable {
    var street: String?
    var city: String?
    var state: String?
    var zipCode: String?

    var singleLine: String? {
        DirectionsHelper.singleLine(
            street: street,
            city: city,
            state: state,
            zipCode: zipCode
        )
    }

    var isPresent: Bool { singleLine != nil }

    var isDirectionsReady: Bool {
        DirectionsHelper.isDirectionsReady(
            street: street,
            city: city,
            state: state,
            zipCode: zipCode
        )
    }
}

// MARK: - Directions helpers (PRD FR-10.4)

/// Pure Maps URL / address helpers for post-award Get Directions.
/// Never invents coordinates; only uses address strings the server already
/// exposed to the authenticated party.
enum DirectionsHelper {
    // MARK: Address assembly

    /// Single-line postal address from optional components. `nil` if all empty.
    static func singleLine(
        street: String?,
        city: String?,
        state: String?,
        zipCode: String?
    ) -> String? {
        let streetPart = normalized(street)
        var cityState = ""
        if let city = normalized(city) {
            cityState = city
        }
        if let state = normalized(state) {
            cityState = cityState.isEmpty ? state : "\(cityState), \(state)"
        }
        let zipPart = normalized(zipCode)

        var parts: [String] = []
        if let streetPart { parts.append(streetPart) }
        if !cityState.isEmpty { parts.append(cityState) }
        if let zipPart { parts.append(zipPart) }

        let joined = parts.joined(separator: ", ")
        return joined.isEmpty ? nil : joined
    }

    /// Strong enough for a maps deep link: street **or** (city + state/zip).
    static func isDirectionsReady(
        street: String?,
        city: String?,
        state: String?,
        zipCode: String?
    ) -> Bool {
        if normalized(street) != nil { return true }
        let hasCity = normalized(city) != nil
        let hasRegion = normalized(state) != nil || normalized(zipCode) != nil
        return hasCity && hasRegion
    }

    /// Client-side rule: only offer directions when we have a usable party address.
    static func canOfferDirections(address: String?) -> Bool {
        guard let address else { return false }
        return address.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3
    }

    static func canOfferDirections(exact: JobExactAddress?) -> Bool {
        exact?.isDirectionsReady == true
    }

    // MARK: Maps URLs

    /// Apple Maps directions (`maps.apple.com/?daddr=`). Always available on iOS.
    static func appleMapsURL(address: String) -> URL? {
        guard let query = mapsQuery(address) else { return nil }
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [
            URLQueryItem(name: "daddr", value: query),
            URLQueryItem(name: "dirflg", value: "d"),
        ]
        return components?.url
    }

    /// Google Maps app scheme. Requires `comgooglemaps` in `LSApplicationQueriesSchemes`.
    static func googleMapsAppURL(address: String) -> URL? {
        guard let query = mapsQuery(address) else { return nil }
        var components = URLComponents(string: "comgooglemaps://")
        components?.queryItems = [
            URLQueryItem(name: "daddr", value: query),
            URLQueryItem(name: "directionsmode", value: "driving"),
        ]
        return components?.url
    }

    /// Google Maps HTTPS (browser / universal link).
    static func googleMapsURL(address: String) -> URL? {
        guard let query = mapsQuery(address) else { return nil }
        var components = URLComponents(string: "https://www.google.com/maps/dir/")
        components?.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "destination", value: query),
            URLQueryItem(name: "travelmode", value: "driving"),
        ]
        return components?.url
    }

    /// Prefer Apple Maps; Google HTTPS as secondary for callers that only need one URL.
    static func preferredDirectionsURL(address: String) -> URL? {
        appleMapsURL(address: address) ?? googleMapsURL(address: address)
    }

    /// Ordered candidates: Google Maps app scheme (if built), then Apple Maps HTTPS.
    static func directionsURLCandidates(address: String) -> [URL] {
        var urls: [URL] = []
        if let google = googleMapsAppURL(address: address) {
            urls.append(google)
        }
        if let apple = appleMapsURL(address: address) {
            urls.append(apple)
        }
        return urls
    }

    /// `MKMapItem` named with the address (no precise lat/lng — avoid leaking pins).
    static func mapItem(named address: String) -> MKMapItem {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: kCLLocationCoordinate2DInvalid))
        item.name = address
        return item
    }

    // MARK: Open

    /// Prefer Google Maps app when `canOpenURL` succeeds; otherwise Apple Maps.
    @MainActor
    static func openDirections(address: String, openURL: ((URL) -> Void)? = nil) {
        let candidates = directionsURLCandidates(address: address)
        guard !candidates.isEmpty else { return }

        #if canImport(UIKit)
        let open: (URL) -> Void = { url in
            if let openURL {
                openURL(url)
            } else {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        }
        for url in candidates {
            if url.scheme == "comgooglemaps" {
                if UIApplication.shared.canOpenURL(url) {
                    open(url)
                    return
                }
                continue
            }
            open(url)
            return
        }
        #else
        if let first = candidates.last ?? candidates.first {
            openURL?(first)
        }
        #endif
    }

    /// Open Apple Maps via `MKMapItem` (driving directions).
    @MainActor
    static func openInAppleMaps(address: String) {
        let item = mapItem(named: address)
        item.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving,
        ])
    }

    // MARK: Private

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func mapsQuery(_ address: String) -> String? {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count >= 3 ? trimmed : nil
    }
}

// MARK: - Bid amount rules (pure)

/// Pure bid-lowering validation (PRD FR-4.3) — unit-testable without UI.
enum BidAmountRules {
    /// Returns nil if `newCents` is a valid lower bid vs `currentCents`; otherwise an error message.
    static func validateLowerOnly(currentCents: Int64, newCents: Int64) -> String? {
        guard newCents > 0 else {
            return "Bid amount must be greater than zero."
        }
        guard newCents < currentCents else {
            return "Reverse auction: new bid must be lower than your current bid (\(MoneyFormat.usd(cents: currentCents)))."
        }
        return nil
    }

    /// Offer-accepted must be positive and ≤ starting bid.
    static func validateOfferAccepted(startingCents: Int64, offerCents: Int64) -> String? {
        guard offerCents > 0 else {
            return "Offer-accepted price must be greater than zero."
        }
        guard offerCents <= startingCents else {
            return "Offer-accepted price must be at or below the starting bid."
        }
        return nil
    }
}

// MARK: - Soft travel ETA (§13 Instant — not AI, not live GPS)

/// Driving ETA for Instant offer cards.
/// Prefer MapKit `MKDirections` when both endpoints have coordinates; fall back
/// to haversine → urban-drive minutes (same rule as the gateway). Never claims
/// live GPS tracking of the provider — profile service location or device
/// source is a one-shot estimate only.
enum SoftTravelETA {
    /// Mean Earth radius (meters) — same constant as gateway geofence.
    private static let earthRadiusMeters = 6_371_000.0

    /// Where the minutes came from (for honest UI labels).
    enum Source: String, Sendable, Hashable {
        /// `MKDirections.Request` automobile ETA.
        case mapKit
        /// Client haversine × urban-drive heuristic.
        case haversine
        /// Server-precomputed `approx_travel_minutes` (also haversine).
        case server
    }

    struct Estimate: Sendable, Hashable {
        let minutes: Int
        let source: Source
    }

    /// Soft label for UI. Honest wording: "approx. drive time", never "live GPS".
    /// MapKit estimates are tagged so users know the source.
    static func label(minutes: Int?, source: Source? = nil) -> String? {
        guard let minutes, minutes > 0 else { return nil }
        let core: String
        if minutes < 60 {
            core = "≈ \(minutes) min approx. drive time"
        } else {
            let hours = minutes / 60
            let rem = minutes % 60
            if rem == 0 {
                core = "≈ \(hours)h approx. drive time"
            } else {
                core = "≈ \(hours)h \(rem)m approx. drive time"
            }
        }
        if source == .mapKit {
            return "\(core) (MapKit)"
        }
        return core
    }

    /// Great-circle distance in meters between two WGS84 points.
    static func haversineMeters(
        lat1: Double, lng1: Double,
        lat2: Double, lng2: Double
    ) -> Double {
        let toRad = { (d: Double) in d * .pi / 180 }
        let dLat = toRad(lat2 - lat1)
        let dLng = toRad(lng2 - lng1)
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(toRad(lat1)) * cos(toRad(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadiusMeters * c
    }

    /// Urban-drive heuristic: ~2 minutes per mile (~30 mph with lights). Bounds [1, 999].
    static func minutes(meters: Double) -> Int {
        guard meters.isFinite, meters > 0 else { return 1 }
        let miles = meters / 1609.344
        let raw = Int((miles * 2.0).rounded())
        return min(999, max(1, raw))
    }

    /// Convenience: haversine minutes between two coordinates, or nil if any coord is invalid.
    static func minutes(
        fromLat: Double?, fromLng: Double?,
        toLat: Double?, toLng: Double?
    ) -> Int? {
        guard let fromLat, let fromLng, let toLat, let toLng else { return nil }
        guard (-90...90).contains(fromLat), (-180...180).contains(fromLng),
              (-90...90).contains(toLat), (-180...180).contains(toLng) else {
            return nil
        }
        let m = haversineMeters(lat1: fromLat, lng1: fromLng, lat2: toLat, lng2: toLng)
        return minutes(meters: m)
    }

    /// Resolve best available ETA for an Instant offer.
    /// 1) MapKit automobile when `from` + job `approx_lat/lng` are valid
    /// 2) Server `approx_travel_minutes` when present
    /// 3) Client haversine when both ends have coords
    static func resolve(
        fromLat: Double?,
        fromLng: Double?,
        toLat: Double?,
        toLng: Double?,
        serverMinutes: Int?
    ) async -> Estimate? {
        if let mapKit = await drivingMinutesMapKit(
            fromLat: fromLat, fromLng: fromLng,
            toLat: toLat, toLng: toLng
        ) {
            return mapKit
        }
        if let serverMinutes, serverMinutes > 0 {
            return Estimate(minutes: min(999, serverMinutes), source: .server)
        }
        if let m = minutes(fromLat: fromLat, fromLng: fromLng, toLat: toLat, toLng: toLng) {
            return Estimate(minutes: m, source: .haversine)
        }
        return nil
    }

    /// `MKDirections.Request` automobile ETA in minutes. Nil on failure / invalid coords.
    static func drivingMinutesMapKit(
        fromLat: Double?, fromLng: Double?,
        toLat: Double?, toLng: Double?
    ) async -> Estimate? {
        guard let fromLat, let fromLng, let toLat, let toLng else { return nil }
        guard (-90...90).contains(fromLat), (-180...180).contains(fromLng),
              (-90...90).contains(toLat), (-180...180).contains(toLng) else {
            return nil
        }
        // Identical points — skip network directions.
        if abs(fromLat - toLat) < 0.00001, abs(fromLng - toLng) < 0.00001 {
            return Estimate(minutes: 1, source: .mapKit)
        }

        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(
            coordinate: CLLocationCoordinate2D(latitude: fromLat, longitude: fromLng)
        ))
        request.destination = MKMapItem(placemark: MKPlacemark(
            coordinate: CLLocationCoordinate2D(latitude: toLat, longitude: toLng)
        ))
        request.transportType = .automobile
        request.requestsAlternateRoutes = false

        let directions = MKDirections(request: request)
        do {
            let response = try await directions.calculate()
            guard let route = response.routes.first else { return nil }
            let seconds = route.expectedTravelTime
            guard seconds.isFinite, seconds > 0 else { return nil }
            let mins = Int((seconds / 60.0).rounded())
            return Estimate(minutes: min(999, max(1, mins)), source: .mapKit)
        } catch {
            return nil
        }
    }
}
