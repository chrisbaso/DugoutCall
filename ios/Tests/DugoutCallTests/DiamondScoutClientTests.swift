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

        XCTAssertEqual(card.schemaVersion, "2026-08-17")
        XCTAssertEqual(card.opponent.id, 70)
        XCTAssertEqual(card.hitter.displayName, "#4 Isaiah Kelly")
        XCTAssertEqual(card.confidence.key, "high")
        XCTAssertEqual(card.plan.pitchPlan, "Pound away until he adjusts.")
        XCTAssertEqual(card.next.first?.hitterID, 8)
    }

    func testMockLineupSummariesCoverWholeLineupAndCapTags() async throws {
        let client = DiamondScoutMockClient()

        let response = try await client.lineupSummaries(gameID: 101)

        XCTAssertEqual(response.gameID, 101)
        XCTAssertEqual(response.opponentID, 70)
        XCTAssertEqual(response.summaries.count, 4)
        XCTAssertEqual(response.summaries.map(\.slot), [1, 2, 3, 4])
        XCTAssertTrue(response.summaries.allSatisfy { $0.attackTags.count <= 3 })
        XCTAssertEqual(response.summaries.first?.zoneHeat?.wedges.count, 5)

        let noData = response.summaries.first { $0.hitter.id == 23 }
        XCTAssertEqual(noData?.hasScoutingData, false)
        XCTAssertNil(noData?.verdict)
        XCTAssertNil(noData?.zoneHeat)
    }

    func testLineupSummariesDecodeFromContractJSON() throws {
        let json = """
        {
          "game_id": 101,
          "opponent_id": 70,
          "summaries": [
            {
              "slot": 1,
              "hitter": {"id": 4, "name": "Isaiah Kelly", "display_name": "#4 Isaiah Kelly", "jersey": "4", "bats": "R"},
              "verdict": "Dead-red early in counts; chases low-away with two strikes.",
              "attack_tags": ["Start soft", "Climb w/ 2K"],
              "zone_heat": {
                "kind": "field_fan",
                "wedges": [
                  {"location": "left_field", "value": 33},
                  {"location": "center_field", "value": 28}
                ],
                "sample_size": 18,
                "low_sample": false
              }
            },
            {
              "slot": 2,
              "hitter": {"id": 23, "name": "Quinn Walsh", "display_name": "#23 Quinn Walsh", "jersey": "23", "bats": null},
              "verdict": null,
              "attack_tags": [],
              "zone_heat": null
            }
          ]
        }
        """

        let decoded = try JSONDecoder().decode(DiamondScoutLineupSummariesResponse.self, from: Data(json.utf8))

        XCTAssertEqual(decoded.gameID, 101)
        XCTAssertEqual(decoded.opponentID, 70)
        XCTAssertEqual(decoded.summaries.count, 2)
        XCTAssertEqual(decoded.summaries[0].attackTags, ["Start soft", "Climb w/ 2K"])
        XCTAssertEqual(decoded.summaries[0].zoneHeat?.wedges.first?.location, "left_field")
        XCTAssertEqual(decoded.summaries[0].zoneHeat?.sampleSize, 18)
        XCTAssertFalse(decoded.summaries[1].hasScoutingData)
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
