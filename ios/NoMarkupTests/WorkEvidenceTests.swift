import XCTest
@testable import NoMarkup

final class WorkEvidenceTests: XCTestCase {
    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    func testDecodesNotReadyPack() throws {
        let json = """
        {
          "ready_for_release": false,
          "missing": ["check_in", "after_photo"],
          "sessions": [],
          "photos": []
        }
        """.data(using: .utf8)!
        let pack = try decoder.decode(ContractWorkEvidence.self, from: json)
        XCTAssertFalse(pack.readyForRelease)
        XCTAssertEqual(pack.missing, ["check_in", "after_photo"])
        XCTAssertTrue(pack.sessions.isEmpty)
        XCTAssertTrue(pack.photos.isEmpty)
    }

    func testDecodesReadyPackWithSessionAndPhoto() throws {
        let json = """
        {
          "ready_for_release": true,
          "missing": [],
          "sessions": [
            {
              "checked_in_at": "2026-04-10T14:00:00Z",
              "checked_out_at": "2026-04-10T16:30:00Z",
              "duration_minutes": 150
            }
          ],
          "photos": [
            {
              "phase": "after",
              "url": "https://picsum.photos/id/1/200/200",
              "uploaded_at": "2026-04-10T16:00:00Z"
            }
          ]
        }
        """.data(using: .utf8)!
        let pack = try decoder.decode(ContractWorkEvidence.self, from: json)
        XCTAssertTrue(pack.readyForRelease)
        XCTAssertEqual(pack.sessions.count, 1)
        XCTAssertEqual(pack.sessions[0].durationMinutes, 150)
        XCTAssertEqual(pack.sessions[0].displayDuration, "2h 30m")
        XCTAssertEqual(pack.photos.count, 1)
        XCTAssertEqual(pack.photos[0].displayPhase, "After")
        XCTAssertNotNil(pack.photos[0].safeImageURL)
    }

    func testOpenSessionIsInProgress() throws {
        let json = """
        {
          "checked_in_at": "2026-04-10T14:00:00Z",
          "checked_out_at": null,
          "duration_minutes": 0
        }
        """.data(using: .utf8)!
        let session = try decoder.decode(ContractWorkEvidenceSession.self, from: json)
        XCTAssertTrue(session.isOpen)
        XCTAssertEqual(session.displayDuration, "In progress")
    }

    func testRejectsNonAllowlistedPhotoHost() throws {
        let json = """
        {
          "phase": "after",
          "url": "https://evil.example.com/tracker.jpg",
          "uploaded_at": "2026-04-10T16:00:00Z"
        }
        """.data(using: .utf8)!
        let photo = try decoder.decode(ContractWorkEvidencePhoto.self, from: json)
        XCTAssertNil(photo.safeImageURL)
    }

    func testBlockedCopyNamesBothRequirements() {
        XCTAssertEqual(
            ProofOfWorkCopy.releaseBlockedMessage(missing: ["check_in", "after_photo"]),
            "Need check-in and an after photo before funds release"
        )
        XCTAssertEqual(
            ProofOfWorkCopy.releaseBlockedMessage(missing: ["after_photo"]),
            "Need an after photo before funds release"
        )
        XCTAssertEqual(
            ProofOfWorkCopy.releaseBlockedMessage(missing: []),
            "Need check-in and an after photo before funds release"
        )
    }

    func testListLabels() {
        XCTAssertEqual(ProofOfWorkCopy.listLabel(for: "check_in"), "Check-in at the job site")
        XCTAssertEqual(ProofOfWorkCopy.listLabel(for: "after_photo"), "After photo of completed work")
    }
}
