import XCTest
@testable import DugoutCall

final class DiamondScoutClientTests: XCTestCase {
    func testConfigUsesMockDataWhenBaseURLOrTokenIsMissing() {
        XCTAssertTrue(DiamondScoutConfig(apiBaseURL: "", bearerToken: "", forceMockMode: false).usesMockData)
        XCTAssertTrue(DiamondScoutConfig(apiBaseURL: "https://diamond.example", bearerToken: "", forceMockMode: false).usesMockData)
        XCTAssertTrue(DiamondScoutConfig(apiBaseURL: "", bearerToken: "token", forceMockMode: false).usesMockData)
        XCTAssertTrue(DiamondScoutConfig(apiBaseURL: "https://diamond.example", bearerToken: "token", forceMockMode: true).usesMockData)
        XCTAssertFalse(DiamondScoutConfig(apiBaseURL: "https://diamond.example", bearerToken: "token", forceMockMode: false).usesMockData)
    }

    func testFactoryDefaultsToMockClientWhenConfigIsIncomplete() {
        let client = DiamondScoutClientFactory.make(
            config: DiamondScoutConfig(apiBaseURL: "", bearerToken: "", forceMockMode: false)
        )

        XCTAssertTrue(client.usesMockData)
    }

    func testMockClientReturnsContractShapedHitterCard() async throws {
        let client = DiamondScoutMockClient()

        let card = try await client.hitterCard(opponentID: 70, hitterID: 4, gameID: 101)

        XCTAssertEqual(card.schemaVersion, "2026-06-10")
        XCTAssertEqual(card.opponent.id, 70)
        XCTAssertEqual(card.hitter.displayName, "#4 Isaiah Kelly")
        XCTAssertEqual(card.confidence.key, "high")
        XCTAssertEqual(card.plan.pitchPlan, "Pound away until he adjusts.")
        XCTAssertEqual(card.next.first?.hitterID, 8)
    }

    func testMockEventIngestAcceptsPostedPitchEvents() async throws {
        let client = DiamondScoutMockClient()
        let event = DiamondScoutChartingEvent(
            eventID: "dc-test-1",
            sequence: 1,
            type: "pitch",
            paKey: "g101-pa-1",
            pitchSequence: 1,
            countBefore: "0-0",
            pitchType: "Fastball",
            pitchLocation: "away",
            result: DiamondScoutEventResult(kind: "called_strike")
        )

        let response = try await client.postEvents(gameID: 101, events: [event])

        XCTAssertEqual(response.accepted, 1)
        XCTAssertTrue(response.rejected.isEmpty)
    }
}
