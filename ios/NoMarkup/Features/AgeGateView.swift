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

/// Host that checks age status for signed-in sessions and presents `AgeGateView`.
struct AgeGateHost: ViewModifier {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var showGate = false
    @State private var didCheck = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if showGate {
                    AgeGateView(isPresented: $showGate)
                        .transition(.opacity)
                        .zIndex(100)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: showGate)
            .task(id: auth.isAuthenticated) {
                await checkAgeStatus()
            }
            .onReceive(NotificationCenter.default.publisher(for: .noMarkupAgeVerified)) { _ in
                showGate = false
            }
            .onChange(of: auth.isAuthenticated) { _, isAuthed in
                if !isAuthed {
                    showGate = false
                    didCheck = false
                }
            }
    }

    @MainActor
    private func checkAgeStatus() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            showGate = false
            return
        }

        do {
            let status = try await APIClient.shared.fetchAgeStatus()
            showGate = !status.isVerified
            didCheck = true
        } catch let error as APIClientError where error.isUnauthorized {
            showGate = false
        } catch {
            // Fail open on network errors so a flaky age endpoint doesn't brick the app.
            // SecuritySettings still surfaces age status for manual verify.
            showGate = false
        }
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
