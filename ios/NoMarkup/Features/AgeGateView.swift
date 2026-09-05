import SwiftUI

/// Full-screen age verification gate (18+). Shown to authenticated users when
/// `GET /api/v1/me/age-status` returns `{ verified: false }`.
///
/// Client age math is UX-only — the gateway parses the DOB and validates ≥18
/// server-side. DOB is never returned by the API after submit.
struct AgeGateView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @Binding var isPresented: Bool

    @State private var dobDate = Calendar.current.date(byAdding: .year, value: -21, to: Date()) ?? Date()
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Color.black.opacity(0.72)
                .ignoresSafeArea()
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 16) {
                Label("Verify your age", systemImage: "person.badge.shield.checkmark.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .accessibilityAddTraits(.isHeader)

                Text("NoMarkup requires all users to be at least \(AgeGateMath.minimumAgeYears) years old. Your date of birth is stored securely and never shown publicly.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                DatePicker(
                    "Date of birth",
                    selection: $dobDate,
                    in: ...Date(),
                    displayedComponents: .date
                )
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Date of birth")

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isStaticText)
                }

                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(isSubmitting ? "Verifying…" : "Continue")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isSubmitting || auth.isScaffoldSession)
                .accessibilityHint("Submits your date of birth. The server verifies you are at least 18.")
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(BrandTheme.navyElevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(BrandTheme.gold.opacity(0.25), lineWidth: 1)
                    )
            )
            .padding(.horizontal, 24)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ageGate.dialog")
        }
        .accessibilityAddTraits(.isModal)
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            errorMessage = "Sign in required to verify age."
            return
        }

        if let years = AgeGateMath.ageYears(dob: dobDate), years < AgeGateMath.minimumAgeYears {
            errorMessage = "You must be at least \(AgeGateMath.minimumAgeYears) to use NoMarkup."
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            _ = try await APIClient.shared.setDateOfBirth(AgeGateMath.yyyyMMdd(dobDate))
            isPresented = false
            NotificationCenter.default.post(name: .noMarkupAgeVerified, object: nil)
        } catch let error as APIClientError where error.isUnauthorized {
            errorMessage = "Session expired. Sign in again to verify your age."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

extension AgeGateMath {
    /// Fail-closed presentation for `GET /api/v1/me/age-status`.
    enum Decision: Equatable, Sendable {
        /// Unsigned-in, DEBUG scaffold, 401, or already verified — do not block.
        case hide
        /// Signed-in user is not age-verified — collect DOB via `AgeGateView`.
        case collectDateOfBirth
        /// Age status could not be fetched — block until retry succeeds.
        case retryRequired
    }

    /// Maps session + age-status result to a blocking presentation.
    ///
    /// Fail closed: any error other than unauthorized blocks the catalog.
    /// Unsigned-in and DEBUG scaffold sessions hide the gate (no production guest browse).
    static func decision(
        isAuthenticated: Bool,
        isScaffoldSession: Bool,
        result: Result<Bool, Error>
    ) -> Decision {
        guard isAuthenticated, !isScaffoldSession else { return .hide }
        switch result {
        case .success(let isVerified):
            return isVerified ? .hide : .collectDateOfBirth
        case .failure(let error):
            if (error as? APIClientError)?.isUnauthorized == true {
                return .hide
            }
            return .retryRequired
        }
    }
}

/// Host that checks age status for signed-in sessions and presents `AgeGateView`.
/// Network / server errors fail closed with a retry overlay — never browse UGC unsigned-age.
struct AgeGateHost: ViewModifier {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var showGate = false
    @State private var showCheckError = false
    @State private var showChecking = false
    @State private var isChecking = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if showCheckError {
                    AgeStatusBlockedView(failed: true, isRetrying: isChecking) {
                        Task { await checkAgeStatus() }
                    }
                    .transition(.opacity)
                    .zIndex(100)
                } else if showGate {
                    AgeGateView(isPresented: $showGate)
                        .transition(.opacity)
                        .zIndex(100)
                } else if showChecking {
                    AgeStatusBlockedView(failed: false, isRetrying: true, onRetry: {})
                        .transition(.opacity)
                        .zIndex(100)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: showGate)
            .animation(.easeInOut(duration: 0.2), value: showCheckError)
            .animation(.easeInOut(duration: 0.2), value: showChecking)
            .task(id: auth.isAuthenticated) {
                await checkAgeStatus()
            }
            .onReceive(NotificationCenter.default.publisher(for: .noMarkupAgeVerified)) { _ in
                apply(.hide)
            }
            .onChange(of: auth.isAuthenticated) { _, isAuthed in
                if !isAuthed {
                    apply(.hide)
                    showChecking = false
                }
            }
    }

    @MainActor
    private func apply(_ decision: AgeGateMath.Decision) {
        switch decision {
        case .hide:
            showGate = false
            showCheckError = false
        case .collectDateOfBirth:
            showGate = true
            showCheckError = false
        case .retryRequired:
            showGate = false
            showCheckError = true
        }
    }

    @MainActor
    private func checkAgeStatus() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            apply(.hide)
            showChecking = false
            return
        }

        if !showGate && !showCheckError {
            showChecking = true
        }
        isChecking = true
        defer {
            isChecking = false
            showChecking = false
        }

        let result: Result<Bool, Error>
        do {
            let status = try await APIClient.shared.fetchAgeStatus()
            result = .success(status.isVerified)
        } catch {
            result = .failure(error)
        }
        apply(
            AgeGateMath.decision(
                isAuthenticated: auth.isAuthenticated,
                isScaffoldSession: auth.isScaffoldSession,
                result: result
            )
        )
    }
}

/// Blocking overlay: in-flight age check or a failed check that must be retried.
/// Not dismissible into jobs / listings / photos.
private struct AgeStatusBlockedView: View {
    var failed: Bool
    var isRetrying: Bool
    var onRetry: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.72)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 16) {
                Label {
                    Text(failed ? "We couldn’t verify your age" : "Confirming your age")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                } icon: {
                    Image(systemName: failed ? "exclamationmark.triangle.fill" : "person.badge.shield.checkmark.fill")
                        .foregroundStyle(failed ? BrandTheme.warning : BrandTheme.accent)
                }
                .accessibilityAddTraits(.isHeader)

                if failed {
                    Text("Try again to confirm you’re at least \(AgeGateMath.minimumAgeYears) before using NoMarkup. You can’t browse until this succeeds.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isStaticText)

                    Button {
                        BrandHaptics.light()
                        onRetry()
                    } label: {
                        HStack {
                            if isRetrying {
                                ProgressView()
                                    .tint(BrandTheme.ctaLabelOnGold)
                            }
                            Text(isRetrying ? "Trying again…" : "Try again")
                                .frame(maxWidth: .infinity)
                        }
                        .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isRetrying)
                    .accessibilityIdentifier("ageGate.retry")
                    .accessibilityHint("Retries age verification. You cannot browse until it succeeds.")
                } else {
                    Text("Please wait while we confirm you’re at least \(AgeGateMath.minimumAgeYears).")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                        .accessibilityLabel("Checking age")
                }
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(BrandTheme.navyElevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(BrandTheme.gold.opacity(0.25), lineWidth: 1)
                    )
            )
            .padding(.horizontal, 24)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(failed ? "ageGate.checkError" : "ageGate.checking")
        }
        .accessibilityAddTraits(.isModal)
        .allowsHitTesting(true)
    }
}

extension View {
    /// Present the global 18+ age gate when the signed-in user is not age-verified.
    func ageGateWhenNeeded() -> some View {
        modifier(AgeGateHost())
    }
}

#Preview {
    AgeGateView(isPresented: .constant(true))
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
