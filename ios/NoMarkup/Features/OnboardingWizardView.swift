import SwiftUI

/// Guided multi-step onboarding (PRD FR-1.5 / FR-1.6 / FR-1.3 address).
///
/// Steps: display name → phone (OTP) → service address (link to create property) → optional provider role.
/// Non-blocking: skip allowed on optional steps; dismiss anytime and resume via Account “Finish setup”.
/// Uses existing `updateMe` / `enableRole` / `sendPhoneOTP` / `verifyPhone` / properties APIs.
struct OnboardingWizardView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var step: Step = .displayName
    @State private var profile: UserProfile?
    @State private var displayName = ""
    @State private var phone = ""
    @State private var otpCode = ""
    @State private var enableProvider = false
    @State private var otpSent = false
    @State private var isLoadingProfile = false
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false
    @State private var showVerificationCenter = false
    @State private var showAddPropertySheet = false
    @State private var propertySavedNickname: String?

    private enum Step: Int, CaseIterable {
        case displayName = 0
        case phone = 1
        case address = 2
        case provider = 3
        case done = 4

        var title: String {
            switch self {
            case .displayName: return "Display name"
            case .phone: return "Phone"
            case .address: return "Service address"
            case .provider: return "Provider role"
            case .done: return "You’re set"
            }
        }

        /// Progress through guided steps (done = 100%).
        var progressPercent: Int {
            switch self {
            case .displayName: return 0
            case .phone: return 25
            case .address: return 50
            case .provider: return 75
            case .done: return 100
            }
        }

        var isOptional: Bool {
            switch self {
            case .displayName: return false
            case .phone, .address, .provider: return true
            case .done: return false
            }
        }
    }

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode cannot complete onboarding. Sign in with a real account.",
                    actionTitle: "Close",
                    action: { dismiss() }
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Your session expired. Sign in again to finish setup.",
                    actionTitle: "Close",
                    action: { dismiss() }
                )
            } else if isLoadingProfile && profile == nil {
                ProgressView("Loading profile…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, profile == nil {
                BrandEmptyState(
                    title: "Couldn’t load profile",
                    systemImage: "wifi.exclamationmark",
                    message: errorMessage,
                    actionTitle: "Try again",
                    action: { Task { await loadProfile() } }
                )
            } else {
                wizardContent
            }
        }
        .navigationTitle("Finish setup")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Not now") {
                    dismiss()
                }
                .foregroundStyle(BrandTheme.goldBright)
                .accessibilityHint("Close setup and continue using the app. You can finish later from Account.")
            }
        }
        .navigationDestination(isPresented: $showVerificationCenter) {
            VerificationCenterView()
        }
        .sheet(isPresented: $showAddPropertySheet) {
            NavigationStack {
                AddPropertySheet { created in
                    propertySavedNickname = created.displayNickname
                    statusMessage = "Property “\(created.displayNickname)” saved."
                    showAddPropertySheet = false
                } onCancel: {
                    showAddPropertySheet = false
                }
            }
        }
        .task { await loadProfile() }
    }

    // MARK: - Content

    private var wizardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                progressHeader
                stepBody
                if let statusMessage {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Error: \(errorMessage)")
                }
                stepActions
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .background(BrandTheme.navy.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(step.title)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer()
                Text("\(step.progressPercent)%")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .accessibilityLabel("Setup \(step.progressPercent) percent complete")
            }

            ProgressView(value: Double(step.progressPercent), total: 100)
                .tint(BrandTheme.accent)
                .accessibilityValue("\(step.progressPercent) percent")

            Text(stepSubtitle)
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if step.isOptional {
                Text("Optional — you can skip and finish later.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .brandHairlineBorder(cornerRadius: 18)
    }

    private var stepSubtitle: String {
        switch step {
        case .displayName:
            return "How you appear on bids, chat, and your public profile."
        case .phone:
            return "Add a phone number and send an SMS code. Verification is required before some transactions."
        case .address:
            return "Save a home or site address so reverse-auction jobs can reuse it (FR-1.3). Optional — manage anytime under Properties."
        case .provider:
            return "Providers bid on service jobs and complete reverse-auction contracts. You can add this anytime."
        case .done:
            return "You’re ready to browse jobs, goods, and messages. Complete verification anytime from Account."
        }
    }

    @ViewBuilder
    private var stepBody: some View {
        switch step {
        case .displayName:
            displayNameStep
        case .phone:
            phoneStep
        case .address:
            addressStep
        case .provider:
            providerStep
        case .done:
            doneStep
        }
    }

    private var displayNameStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Display name")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(BrandTheme.sectionHeader)
            TextField("How you appear to others", text: $displayName)
                .textContentType(.name)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .frame(minHeight: 44)
                .accessibilityLabel("Display name")
            Text("At most 80 characters. Public on bids and chat.")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private var phoneStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Phone number")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(BrandTheme.sectionHeader)
            TextField("Phone (E.164 preferred, e.g. +15551234567)", text: $phone)
                .textContentType(.telephoneNumber)
                .keyboardType(.phonePad)
                .foregroundStyle(BrandTheme.textPrimary)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .frame(minHeight: 44)
                .accessibilityLabel("Phone number")

            if otpSent {
                TextField("OTP code", text: $otpCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .padding(14)
                    .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(fieldStroke)
                    .frame(minHeight: 44)
                    .accessibilityLabel("One-time passcode")
            }

            Button {
                Task { await sendOTP() }
            } label: {
                HStack {
                    if isBusy {
                        ProgressView().tint(BrandTheme.accent)
                    }
                    Text(otpSent ? "Resend SMS code" : "Save phone & send SMS code")
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .buttonStyle(.bordered)
            .tint(BrandTheme.accent)
            .disabled(isBusy || phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if otpSent {
                Button {
                    Task { await verifyOTP() }
                } label: {
                    Text("Verify code")
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isBusy || otpCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            Button {
                showVerificationCenter = true
            } label: {
                Label("Open full verification center", systemImage: "checkmark.shield")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
            }
            .accessibilityHint("Email resend and phone OTP in a dedicated screen")
        }
    }


    private var addressStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let nickname = propertySavedNickname {
                Label("Saved “\(nickname)”", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.success)
                    .frame(minHeight: 44)
            } else {
                Text("Add a service location for reverse-auction jobs. You can skip and manage properties later from Account.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                showAddPropertySheet = true
            } label: {
                Label(
                    propertySavedNickname == nil ? "Add property address" : "Add another property",
                    systemImage: "house.fill"
                )
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .accessibilityHint("Opens the create-property form")

            NavigationLink {
                PropertiesView()
            } label: {
                Label("Open Properties", systemImage: "list.bullet.rectangle")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
            }
            .accessibilityHint("Manage all saved addresses")
        }
    }

    private var providerStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            if profile?.hasProviderRole == true {
                Label("Provider role already enabled", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.success)
                    .frame(minHeight: 44)
            } else {
                Toggle(isOn: $enableProvider) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Enable provider role")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text("Bid on service jobs and complete reverse-auction contracts. Admin cannot be self-assigned.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .tint(BrandTheme.accent)
                .padding(14)
                .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(fieldStroke)
                .accessibilityHint("Optional. Adds the provider role in addition to customer")
            }
        }
    }

    private var doneStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Setup complete", systemImage: "checkmark.circle.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(BrandTheme.success)
            if let name = profile?.displayName, !name.isEmpty {
                Text("Signed in as \(name)")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textPrimary)
            }
            if let phoneValue = profile?.phone, !phoneValue.isEmpty {
                Text("Phone on file: \(phoneValue)")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            if profile?.hasProviderRole == true {
                Text("Provider role: enabled")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            if let nickname = propertySavedNickname {
                Text("Service address: \(nickname)")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTheme.navyElevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(BrandTheme.success.opacity(0.35), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var stepActions: some View {
        VStack(spacing: 12) {
            switch step {
            case .displayName:
                primaryButton(title: "Continue", enabled: canContinueDisplayName) {
                    Task { await saveDisplayNameAndAdvance() }
                }
                // FR-1.6: allow leaving required fields for later via Account banner.
                secondarySkipButton(title: "Skip for now") {
                    step = .phone
                    clearMessages()
                }
            case .phone:
                primaryButton(title: "Continue", enabled: !isBusy) {
                    Task { await continueFromPhone() }
                }
                secondarySkipButton(title: "Skip phone") {
                    step = .address
                    clearMessages()
                }
            case .address:
                primaryButton(title: "Continue", enabled: !isBusy) {
                    step = .provider
                    clearMessages()
                }
                secondarySkipButton(title: "Skip address") {
                    step = .provider
                    clearMessages()
                }
            case .provider:
                primaryButton(
                    title: enableProvider && profile?.hasProviderRole != true ? "Enable & finish" : "Finish",
                    enabled: !isBusy
                ) {
                    Task { await finishProviderStep() }
                }
                if profile?.hasProviderRole != true {
                    secondarySkipButton(title: "Skip — stay customer only") {
                        step = .done
                        clearMessages()
                    }
                }
            case .done:
                primaryButton(title: "Done", enabled: true) {
                    dismiss()
                }
            }
        }
    }

    private func primaryButton(title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if isBusy {
                    ProgressView()
                        .tint(BrandTheme.ctaLabelOnGold)
                } else {
                    Text(title)
                        .fontWeight(.semibold)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .tint(BrandTheme.accent)
        .foregroundStyle(BrandTheme.ctaLabelOnGold)
        .disabled(!enabled || isBusy)
        .accessibilityLabel(title)
    }

    private func secondarySkipButton(title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(BrandTheme.goldBright)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .disabled(isBusy)
            .accessibilityHint("Skip this step. You can complete it later from Account.")
    }

    private var fieldStroke: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(BrandTheme.gold.opacity(0.15), lineWidth: 1)
    }

    private var canContinueDisplayName: Bool {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= 80 && !isBusy
    }

    // MARK: - Actions

    private func clearMessages() {
        errorMessage = nil
        statusMessage = nil
    }

    @MainActor
    private func loadProfile() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingProfile = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoadingProfile = false }

        do {
            let me = try await APIClient.shared.fetchMe()
            applyProfile(me)
            // Jump past steps that are already complete when opening mid-setup.
            if step == .displayName {
                let nameOK = !(me.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty
                let phoneOK = !(me.phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty
                if nameOK && phoneOK {
                    step = .address
                } else if nameOK {
                    step = .phone
                }
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            profile = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func applyProfile(_ me: UserProfile) {
        profile = me
        if displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            displayName = me.displayName ?? ""
        }
        if phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            phone = me.phone ?? ""
        }
        if let email = me.email, !email.isEmpty, auth.email.isEmpty {
            auth.email = email
        }
    }

    @MainActor
    private func saveDisplayNameAndAdvance() async {
        clearMessages()
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter a display name."
            return
        }
        guard trimmed.count <= 80 else {
            errorMessage = "Display name must be at most 80 characters."
            return
        }

        isBusy = true
        defer { isBusy = false }

        do {
            let updated = try await APIClient.shared.updateMe(displayName: trimmed)
            applyProfile(updated)
            statusMessage = "Display name saved."
            step = .phone
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func sendOTP() async {
        clearMessages()
        let trimmed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter a phone number."
            return
        }

        isBusy = true
        defer { isBusy = false }

        do {
            // Persist phone on profile first, then request OTP (auth-required).
            let updated = try await APIClient.shared.updateMe(phone: trimmed)
            applyProfile(updated)
            try await APIClient.shared.sendPhoneOTP(phone: trimmed)
            otpSent = true
            statusMessage = "Code sent (when SMS is configured). Enter it below or open Verification center."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func verifyOTP() async {
        clearMessages()
        let code = otpCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            errorMessage = "Enter the SMS code."
            return
        }

        isBusy = true
        defer { isBusy = false }

        do {
            try await APIClient.shared.verifyPhone(otpCode: code)
            statusMessage = "Phone verified."
            // Refresh so phoneVerified reflects server state.
            if let me = try? await APIClient.shared.fetchMe() {
                applyProfile(me)
            }
            step = .address
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Continue without requiring OTP if phone was saved, or if user only wants to move on.
    @MainActor
    private func continueFromPhone() async {
        clearMessages()
        let trimmed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            step = .address
            return
        }

        // If phone changed vs profile, save it (OTP is optional here).
        let existing = profile?.phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed != existing {
            isBusy = true
            defer { isBusy = false }
            do {
                let updated = try await APIClient.shared.updateMe(phone: trimmed)
                applyProfile(updated)
                statusMessage = "Phone saved. You can verify anytime from Account."
                step = .address
            } catch let error as APIClientError where error.isUnauthorized {
                needsSignIn = true
            } catch {
                errorMessage = error.localizedDescription
            }
        } else {
            step = .address
        }
    }

    @MainActor
    private func finishProviderStep() async {
        clearMessages()

        if enableProvider, profile?.hasProviderRole != true {
            isBusy = true
            defer { isBusy = false }
            do {
                let updated = try await APIClient.shared.enableRole("provider")
                applyProfile(updated)
                statusMessage = "Provider role enabled."
                step = .done
            } catch let error as APIClientError where error.isUnauthorized {
                needsSignIn = true
            } catch {
                errorMessage = error.localizedDescription
            }
        } else {
            step = .done
        }
    }
}

#Preview {
    NavigationStack {
        OnboardingWizardView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
