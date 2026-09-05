import Foundation

// MARK: - Platform surfaces (map, APNs, images, profile)
//
// Kept as an extension so core catalog/auth clients stay lean.
// Gateway contracts match web: jobs map, notification devices, image pipeline, users/me.

extension APIClient {
    // MARK: Jobs map

    /// GET `/api/v1/jobs/map?latitude=&longitude=&radius_km=&category_ids=&schedule_type=` → `{ "pins": [...] }`.
    /// Public, edge-cacheable. Latitude/longitude optional (server may default region).
    /// `category_ids` and `schedule_type` are server-side (gateway MapView). Min starting bid is not
    /// on this API — filter pins client-side when needed (FR-10.2).
    func fetchJobsMap(
        latitude: Double? = nil,
        longitude: Double? = nil,
        radiusKm: Double = 25,
        categoryIds: [String]? = nil,
        scheduleType: String? = nil
    ) async throws -> JobsMapResponse {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "radius_km", value: String(radiusKm)),
        ]
        if let latitude, let longitude {
            query.append(URLQueryItem(name: "latitude", value: String(latitude)))
            query.append(URLQueryItem(name: "longitude", value: String(longitude)))
        }
        if let categoryIds {
            let joined = categoryIds
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: ",")
            if !joined.isEmpty {
                query.append(URLQueryItem(name: "category_ids", value: joined))
            }
        }
        if let scheduleType {
            let trimmed = scheduleType.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                query.append(URLQueryItem(name: "schedule_type", value: trimmed))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "jobs", "map"],
            query: query,
            authorized: false
        )
    }

    // MARK: APNs device registration

    /// POST `/api/v1/notifications/devices` — register APNs token (Bearer required).
    /// Body: `{ "device_token", "platform": "ios", "device_id" }`.
    ///
    /// Also used for Live Activity push tokens (IOS-SYS.LA.3) with
    /// `platform: "ios_live_activity"` and `device_id: "liveactivity:<auctionID>"`
    /// — see `AuctionLiveActivityController.observePushToken` for the server-side
    /// work still required before those pushes flow.
    @discardableResult
    func registerPushDevice(
        deviceToken: String,
        deviceID: String,
        platform: String = "ios"
    ) async throws -> RegisterDeviceResponse {
        let trimmedToken = deviceToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "device_token is required.")
        }
        let body = RegisterDeviceRequestBody(
            deviceToken: trimmedToken,
            platform: platform,
            deviceId: deviceID
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "notifications", "devices"],
            body: body,
            authorized: .required
        )
    }

    /// DELETE `/api/v1/notifications/devices/{token}` — unregister APNs token (Bearer required).
    /// Path param is device id or token (gateway treats it as device identifier).
    @discardableResult
    func unregisterPushDevice(deviceTokenOrID: String) async throws -> RegisterDeviceResponse {
        let key = deviceTokenOrID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "device id required")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "notifications", "devices", key],
            authorized: .required
        )
    }

    // MARK: Image upload pipeline

    /// POST `/api/v1/images/upload-url` — mint a presigned PUT URL (Bearer required).
    /// Context wire values: `avatar` | `job_photo` | `listing` | `document` | `chat_attachment`
    /// (imaging allow-list).
    func requestImageUploadURL(
        filename: String,
        mimeType: String,
        fileSizeBytes: Int,
        context: ImageUploadContext
    ) async throws -> ImageUploadURLResponse {
        let name = filename.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "filename is required.")
        }
        guard fileSizeBytes > 0 else {
            throw APIClientError.httpStatus(400, detail: "file_size_bytes must be positive.")
        }
        let body = ImageUploadURLRequestBody(
            filename: name,
            mimeType: mimeType,
            fileSizeBytes: Int32(min(fileSizeBytes, Int(Int32.max))),
            context: context.apiValue
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "images", "upload-url"],
            body: body,
            authorized: .required
        )
    }

    /// PUT raw bytes to a presigned S3/MinIO URL (no Bearer — signed in query).
    func putPresignedUpload(
        data: Data,
        uploadURL: URL,
        contentType: String
    ) async throws {
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        request.timeoutInterval = 120

        let (_, response): (Data, URLResponse)
        do {
            (_, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIClientError.unreachable
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.unreachable
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw APIClientError.httpStatus(http.statusCode, detail: "Presigned upload failed.")
        }
    }

    /// POST `/api/v1/images/confirm` — verify object + return CDN/public URL.
    func confirmImageUpload(
        objectKey: String,
        context: ImageUploadContext
    ) async throws -> ImageConfirmResponse {
        let key = objectKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "object_key is required.")
        }
        let body = ImageConfirmRequestBody(objectKey: key, context: context.apiValue)
        return try await postJSON(
            pathComponents: ["api", "v1", "images", "confirm"],
            body: body,
            authorized: .required
        )
    }

    /// Full pipeline: upload-url → PUT → confirm. Returns public `confirmed_url`.
    func uploadImage(
        data: Data,
        filename: String,
        mimeType: String,
        context: ImageUploadContext
    ) async throws -> String {
        let maxBytes = 10 * 1024 * 1024
        guard data.count > 0 else {
            throw APIClientError.httpStatus(400, detail: "File data is empty.")
        }
        guard data.count <= maxBytes else {
            throw APIClientError.httpStatus(400, detail: "File must be 10 MB or smaller.")
        }

        let urlResponse = try await requestImageUploadURL(
            filename: filename,
            mimeType: mimeType,
            fileSizeBytes: data.count,
            context: context
        )
        guard let uploadURL = URL(string: urlResponse.uploadUrl), !urlResponse.uploadUrl.isEmpty else {
            throw APIClientError.decoding("upload_url missing from upload-url response")
        }
        try await putPresignedUpload(data: data, uploadURL: uploadURL, contentType: mimeType)

        let confirmed = try await confirmImageUpload(
            objectKey: urlResponse.objectKey,
            context: context
        )
        if confirmed.contentTypeValid == false {
            let reason = confirmed.actualContentType?.trimmingCharacters(in: .whitespacesAndNewlines)
            let detail: String
            if let reason, !reason.isEmpty {
                detail = "Upload rejected: \(reason)"
            } else {
                detail = "Upload rejected: content type invalid."
            }
            throw APIClientError.httpStatus(400, detail: detail)
        }
        let publicURL = confirmed.confirmedUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !publicURL.isEmpty else {
            throw APIClientError.decoding("confirmed_url missing from confirm response")
        }
        return publicURL
    }

    // MARK: Profile (users/me)

    /// GET `/api/v1/users/me` — current user profile (Bearer required).
    func fetchMe() async throws -> UserProfile {
        try await getJSON(
            pathComponents: ["api", "v1", "users", "me"],
            authorized: true
        )
    }

    /// PATCH `/api/v1/users/me` — update display name (and optional fields).
    /// Omitted fields stay unchanged server-side.
    @discardableResult
    func updateMe(
        displayName: String? = nil,
        phone: String? = nil,
        avatarURL: String? = nil,
        timezone: String? = nil
    ) async throws -> UserProfile {
        let body = UpdateMeRequestBody(
            displayName: displayName.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            phone: phone,
            avatarUrl: avatarURL,
            timezone: timezone
        )
        return try await patchJSON(
            pathComponents: ["api", "v1", "users", "me"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/users/me/roles` — self-service role enablement.
    /// Gateway body: `{ "role": "customer" | "provider" }` (admin cannot be self-assigned).
    @discardableResult
    func enableRole(_ role: String) async throws -> UserProfile {
        let trimmed = role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed == "customer" || trimmed == "provider" else {
            throw APIClientError.httpStatus(400, detail: "invalid role")
        }
        let body = EnableRoleRequestBody(role: trimmed)
        return try await postJSON(
            pathComponents: ["api", "v1", "users", "me", "roles"],
            body: body,
            authorized: .required
        )
    }
}

// MARK: - Request / response DTOs (platform)

/// Imaging upload context — maps product labels to engine allow-list strings.
enum ImageUploadContext: String, Sendable, Hashable {
    /// Profile avatars — S3 prefix `avatars/{userID}/…`. Imaging allow-list `avatar`.
    case avatar
    /// Job photos on reverse-auction posts.
    case job
    /// Goods listing photos.
    case listing
    /// Provider verification documents (ID, license, insurance) — S3 prefix `documents/{userID}/…`.
    /// Accepts JPEG/PNG/WebP and PDF (pass-through).
    case document
    /// Chat file attachments (PDF invoices, scope docs) — S3 prefix `chat-attachments/{userID}/…`.
    /// Accepts JPEG/PNG/WebP and PDF (pass-through). Photos in chat still use `.job`.
    case chatAttachment
    /// Review photos on leave-review — S3 prefix `review-photos/{userID}/…`. Imaging allow-list `review_photo`.
    case reviewPhoto

    /// Wire value for `context` on upload-url / confirm.
    var apiValue: String {
        switch self {
        case .avatar: return "avatar"
        case .job: return "job_photo"
        case .listing: return "listing"
        case .document: return "document"
        case .chatAttachment: return "chat_attachment"
        case .reviewPhoto: return "review_photo"
        }
    }
}

struct JobsMapResponse: Codable, Sendable {
    let pins: [JobMapPin]
}

struct JobMapPin: Codable, Sendable, Hashable, Identifiable {
    let jobId: String
    var title: String?
    var latitude: Double?
    var longitude: Double?
    var categoryName: String?
    var bidCount: Int?
    var startingBidCents: Int64?
    var auctionEndsAt: String?

    var id: String { jobId }

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Job" : t
    }

    var hasCoordinate: Bool {
        latitude != nil && longitude != nil
    }

    var priceLabel: String? {
        guard let startingBidCents else { return nil }
        return MoneyFormat.usd(cents: startingBidCents)
    }
}

struct RegisterDeviceResponse: Codable, Sendable {
    var status: String?
}

private struct RegisterDeviceRequestBody: Encodable {
    let deviceToken: String
    let platform: String
    let deviceId: String
}

struct ImageUploadURLResponse: Codable, Sendable {
    let uploadUrl: String
    let objectKey: String
    var expiresAt: String?
}

struct ImageConfirmResponse: Codable, Sendable {
    var confirmedUrl: String?
    var contentTypeValid: Bool?
    var actualContentType: String?
}

private struct ImageUploadURLRequestBody: Encodable {
    let filename: String
    let mimeType: String
    let fileSizeBytes: Int32
    let context: String
}

private struct ImageConfirmRequestBody: Encodable {
    let objectKey: String
    let context: String
}

/// `GET|PATCH /api/v1/users/me` profile shape.
struct UserProfile: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var email: String?
    var emailVerified: Bool?
    var phone: String?
    var phoneVerified: Bool?
    var displayName: String?
    var avatarUrl: String?
    var roles: [String]?
    var status: String?
    var mfaEnabled: Bool?
    var createdAt: String?
    var lastActiveAt: String?

    var displayLabel: String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        let mail = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return mail.isEmpty ? "Account" : mail
    }

    /// True when `roles` includes provider (case-insensitive).
    var hasProviderRole: Bool {
        (roles ?? []).contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "provider" }
    }

    /// True when `roles` includes customer (case-insensitive).
    var hasCustomerRole: Bool {
        (roles ?? []).contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "customer" }
    }

    /// True when `roles` includes admin (case-insensitive).
    var hasAdminRole: Bool {
        (roles ?? []).contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "admin" }
    }

    /// Profile needs the guided onboarding wizard when display name or phone is missing (FR-1.5/1.6).
    var isOnboardingIncomplete: Bool {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let phoneValue = phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty || phoneValue.isEmpty
    }
}

private struct EnableRoleRequestBody: Encodable {
    let role: String
}

private struct UpdateMeRequestBody: Encodable {
    var displayName: String?
    var phone: String?
    var avatarUrl: String?
    var timezone: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        // Only emit present keys so omitted fields stay unchanged server-side.
        if let displayName { try c.encode(displayName, forKey: .displayName) }
        if let phone { try c.encode(phone, forKey: .phone) }
        if let avatarUrl { try c.encode(avatarUrl, forKey: .avatarUrl) }
        if let timezone { try c.encode(timezone, forKey: .timezone) }
    }

    private enum CodingKeys: String, CodingKey {
        case displayName
        case phone
        case avatarUrl
        case timezone
    }
}
