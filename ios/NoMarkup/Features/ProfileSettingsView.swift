import PhotosUI
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Profile editor — `GET/PATCH /api/v1/users/me`.
/// Display name is editable; email is read-only (auth lookup identity).
/// Photo: library/camera → `ImageUploader` (`avatar` context) → `updateMe(avatarURL:)`.
struct ProfileSettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var profile: UserProfile?
    @State private var displayName = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var isUploadingAvatar = false
    @State private var isEnablingProvider = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var photoPickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showCameraDeniedAlert = false
    #if canImport(UIKit)
    @State private var cameraImage: UIImage?
    #endif

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Browse-only mode has no API token. Sign in with a real account to edit your profile.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Your session expired. Sign in again to manage profile settings.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && profile == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading profile…")
            } else if let errorMessage, profile == nil {
                BrandEmptyState(
                    title: "Couldn’t load profile",
                    systemImage: "wifi.exclamationmark",
                    message: errorMessage,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else {
                formContent
            }
        }
        .navigationTitle("Profile")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
    }

    private var formContent: some View {
        Form {
            photoSection

            Section {
                TextField("Display name", text: $displayName, prompt: Text("How you appear to others"))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled(false)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Display name")

                if let email = profile?.email, !email.isEmpty {
                    LabeledContent("Email") {
                        Text(email)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Email is used to sign in and cannot be changed here")
                } else if let authEmail = displayEmail {
                    LabeledContent("Email") {
                        Text(authEmail)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                }
            } header: {
                Text("Identity").brandSectionHeader()
            } footer: {
                Text("Display name is public on bids and chat. Email stays private for sign-in.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let profile {
                Section {
                    if let status = profile.status, !status.isEmpty {
                        LabeledContent("Status", value: StatusChipStyle.displayLabel(status))
                    }
                    if let roles = profile.roles, !roles.isEmpty {
                        LabeledContent("Roles", value: roles.joined(separator: ", ").capitalized)
                    } else {
                        LabeledContent("Roles", value: "Customer")
                    }
                    if let created = profile.createdAt, !created.isEmpty {
                        LabeledContent("Member since", value: CatalogDateFormat.friendlyDateTime(created))
                    }
                    LabeledContent("User ID") {
                        Text(shortID(profile.id))
                            .font(.caption.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                } header: {
                    Text("Account").brandSectionHeader()
                }

                if !profile.hasProviderRole {
                    Section {
                        Text(
                            "Customers can bid and buy. Enabling the provider role lets you bid on service jobs and complete reverse-auction contracts."
                        )
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                        Button {
                            Task { await enableProviderRole() }
                        } label: {
                            HStack {
                                if isEnablingProvider {
                                    ProgressView()
                                        .tint(BrandTheme.ctaLabelOnGold)
                                }
                                Text(isEnablingProvider ? "Enabling…" : "Enable provider role")
                                    .frame(maxWidth: .infinity)
                            }
                            .frame(minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.accent)
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .disabled(isEnablingProvider || isSaving || isUploadingAvatar)
                        .accessibilityHint("Adds the provider role so you can bid on service jobs")
                    } header: {
                        Text("Provider").brandSectionHeader()
                    } footer: {
                        Text("Self-service only grants customer or provider. Admin cannot be self-assigned.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                }
            }

            if let errorMessage, profile != nil {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if isSaving {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text("Save changes")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(!canSave || isSaving || isUploadingAvatar)
                .accessibilityHint("Updates your display name on the server")
            }
        }
        .brandListBackground()
        .scrollDismissesKeyboard(.interactively)
        .cameraDeniedAlert(isPresented: $showCameraDeniedAlert)
        #if canImport(UIKit)
        .sheet(isPresented: $showCamera) {
            CameraImagePicker(image: $cameraImage)
                .ignoresSafeArea()
        }
        .onChange(of: cameraImage) { _, image in
            guard let image else { return }
            Task { await uploadCameraPhoto(image) }
        }
        #endif
        .onChange(of: photoPickerItem) { _, item in
            guard let item else { return }
            Task { await uploadPickedPhoto(item) }
        }
    }

    private var photoSection: some View {
        // Snapshot MainActor state — PhotosPicker's label builder is nonisolated.
        let uploading = isUploadingAvatar
        let hasPhoto = currentAvatarURL != nil
        return Section {
            HStack(spacing: 16) {
                avatarPreview
                VStack(alignment: .leading, spacing: 4) {
                    Text(hasPhoto ? "Profile photo" : "No photo yet")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text("Shown on bids and chat.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .combine)

            PhotosPicker(
                selection: $photoPickerItem,
                matching: .images,
                photoLibrary: .shared()
            ) {
                HStack {
                    Label(
                        hasPhoto ? "Choose new photo" : "Choose from library",
                        systemImage: "photo.on.rectangle.angled"
                    )
                    Spacer()
                    if uploading {
                        ProgressView()
                            .tint(BrandTheme.accent)
                    }
                }
                .frame(minHeight: 44)
            }
            .disabled(uploading || isSaving)
            .accessibilityHint("Opens the photo library. JPEG, PNG, or WebP up to 10 MB.")

            #if canImport(UIKit)
            Button {
                Task { await requestCamera() }
            } label: {
                Label("Take photo", systemImage: "camera.fill")
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .disabled(
                uploading
                    || isSaving
                    || !UIImagePickerController.isSourceTypeAvailable(.camera)
            )
            .accessibilityHint("Opens the camera to capture a new profile photo")
            #endif
        } header: {
            Text("Photo").brandSectionHeader()
        } footer: {
            Text("Library or camera. JPEG, PNG, or WebP up to 10 MB. Photo uploads immediately.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    @ViewBuilder
    private var avatarPreview: some View {
        ZStack {
            Circle()
                .fill(BrandTheme.navyElevated)
                .frame(width: 72, height: 72)
            if let url = currentAvatarURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        avatarPlaceholder
                    default:
                        ProgressView()
                            .tint(BrandTheme.accent)
                    }
                }
                .frame(width: 72, height: 72)
                .clipShape(Circle())
            } else {
                avatarPlaceholder
            }
            if isUploadingAvatar {
                Circle()
                    .fill(BrandTheme.navyInk.opacity(0.55))
                    .frame(width: 72, height: 72)
                ProgressView()
                    .tint(BrandTheme.accent)
            }
        }
        .brandHairlineBorder(cornerRadius: 36)
        .accessibilityHidden(true)
    }

    private var avatarPlaceholder: some View {
        Text(avatarInitials)
            .font(.title2.weight(.semibold))
            .foregroundStyle(BrandTheme.textSecondary)
            .frame(width: 72, height: 72)
    }

    private var currentAvatarURL: URL? {
        guard let raw = profile?.avatarUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else { return nil }
        return URL(string: raw)
    }

    private var avatarInitials: String {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty {
            return ProviderInitials.from(displayName: name)
        }
        return "?"
    }

    private var displayEmail: String? {
        let fromAuth = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
        return fromAuth.isEmpty ? nil : fromAuth
    }

    private var canSave: Bool {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 80 else { return false }
        let original = profile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed != original && !isSaving && !isUploadingAvatar
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(8)) + "…"
    }

    @MainActor
    private func load() async {
        if auth.isScaffoldSession {
            profile = nil
            return
        }

        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let me = try await APIClient.shared.fetchMe()
            profile = me
            displayName = me.displayName ?? ""
            if let email = me.email, !email.isEmpty, auth.email.isEmpty {
                auth.email = email
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            profile = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func save() async {
        errorMessage = nil
        statusMessage = nil

        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Display name cannot be empty."
            return
        }
        guard trimmed.count <= 80 else {
            errorMessage = "Display name must be at most 80 characters."
            return
        }

        isSaving = true
        defer { isSaving = false }

        do {
            let updated = try await APIClient.shared.updateMe(displayName: trimmed)
            profile = updated
            displayName = updated.displayName ?? trimmed
            statusMessage = "Profile saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
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
            errorMessage = "Camera is not available on this device. Choose a photo from your library instead."
        }
    }
    #endif

    @MainActor
    private func uploadPickedPhoto(_ item: PhotosPickerItem) async {
        guard !auth.isScaffoldSession else {
            errorMessage = "Browse-only mode cannot change your photo."
            photoPickerItem = nil
            return
        }
        BrandHaptics.medium()
        isUploadingAvatar = true
        errorMessage = nil
        statusMessage = nil
        defer {
            isUploadingAvatar = false
            photoPickerItem = nil
        }
        do {
            let url = try await ImageUploader.upload(item: item, context: .avatar)
            try await applyAvatarURL(url)
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            BrandHaptics.error()
            errorMessage = error.localizedDescription
        }
    }

    #if canImport(UIKit)
    @MainActor
    private func uploadCameraPhoto(_ image: UIImage) async {
        guard !auth.isScaffoldSession else {
            errorMessage = "Browse-only mode cannot change your photo."
            cameraImage = nil
            return
        }
        BrandHaptics.medium()
        isUploadingAvatar = true
        errorMessage = nil
        statusMessage = nil
        defer {
            isUploadingAvatar = false
            cameraImage = nil
        }
        do {
            let url = try await ImageUploader.upload(uiImage: image, context: .avatar)
            try await applyAvatarURL(url)
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            BrandHaptics.error()
            errorMessage = error.localizedDescription
        }
    }
    #endif

    @MainActor
    private func applyAvatarURL(_ url: String) async throws {
        let updated = try await APIClient.shared.updateMe(avatarURL: url)
        profile = updated
        if let name = updated.displayName, !name.isEmpty {
            displayName = name
        }
        BrandHaptics.success()
        statusMessage = "Profile photo updated."
    }

    /// POST `/api/v1/users/me/roles` with `{ "role": "provider" }`.
    @MainActor
    private func enableProviderRole() async {
        errorMessage = nil
        statusMessage = nil

        guard !auth.isScaffoldSession else {
            errorMessage = "Browse-only mode cannot change roles."
            return
        }
        guard !(profile?.hasProviderRole ?? false) else {
            statusMessage = "Provider role is already enabled."
            return
        }

        isEnablingProvider = true
        defer { isEnablingProvider = false }

        do {
            let updated = try await APIClient.shared.enableRole("provider")
            profile = updated
            if let name = updated.displayName, !name.isEmpty {
                displayName = name
            }
            statusMessage = "Provider role enabled. You can bid on service jobs."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        ProfileSettingsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
