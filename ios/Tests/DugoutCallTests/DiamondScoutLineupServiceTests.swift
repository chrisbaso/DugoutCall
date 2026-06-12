import XCTest
@testable import DugoutCall

final class DiamondScoutLineupServiceTests: XCTestCase {
    private func makeDefaults() -> UserDefaults {
        let suiteName = "DiamondScoutLineupServiceTests"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }

    @MainActor
    func testStartGameSessionPrefersInProgressGameAndLoadsLineup() async {
        let defaults = makeDefaults()
        let stub = StubDiamondScoutClient()
        let service = DiamondScoutLineupService(clientProvider: { stub }, defaults: defaults)

        await service.startGameSession()

        XCTAssertEqual(service.state, .loaded)
        XCTAssertEqual(service.game?.id, 101)
        XCTAssertEqual(service.summaries.map(\.slot), [1, 2])
        XCTAssertEqual(service.currentSummary?.hitter.id, 4)
        XCTAssertEqual(service.onDeckSummary?.hitter.id, 8)
        XCTAssertNotNil(defaults.data(forKey: "diamondScoutLineupCacheV1"))
    }

    @MainActor
    func testAdvanceCyclesThroughLineupFromCache() async {
        let defaults = makeDefaults()
        let stub = StubDiamondScoutClient()
        let service = DiamondScoutLineupService(clientProvider: { stub }, defaults: defaults)
        await service.startGameSession()

        service.advanceToNextBatter()
        XCTAssertEqual(service.currentSummary?.hitter.id, 8)

        service.advanceToNextBatter()
        XCTAssertEqual(service.currentSummary?.hitter.id, 4)
    }

    @MainActor
    func testNetworkFailureFallsBackToPersistedCache() async {
        let defaults = makeDefaults()
        let workingStub = StubDiamondScoutClient()
        let seeder = DiamondScoutLineupService(clientProvider: { workingStub }, defaults: defaults)
        await seeder.startGameSession()
        XCTAssertEqual(seeder.state, .loaded)

        let failingStub = StubDiamondScoutClient()
        failingStub.shouldFail = true
        let offline = DiamondScoutLineupService(clientProvider: { failingStub }, defaults: defaults)

        await offline.startGameSession()

        XCTAssertEqual(offline.state, .loaded)
        XCTAssertEqual(offline.summaries.map { $0.hitter.id }, [4, 8])
        XCTAssertEqual(offline.game?.id, 101)
    }

    @MainActor
    func testExpiredCacheBecomesUnavailable() async {
        let defaults = makeDefaults()
        let start = Date()
        let workingStub = StubDiamondScoutClient()
        let seeder = DiamondScoutLineupService(
            clientProvider: { workingStub },
            defaults: defaults,
            now: { start }
        )
        await seeder.startGameSession()

        let failingStub = StubDiamondScoutClient()
        failingStub.shouldFail = true
        let later = DiamondScoutLineupService(
            clientProvider: { failingStub },
            defaults: defaults,
            cacheTTL: 60,
            now: { start.addingTimeInterval(120) }
        )

        await later.startGameSession()

        XCTAssertEqual(later.state, .unavailable)
        XCTAssertTrue(later.summaries.isEmpty)
    }

    @MainActor
    func testBackgroundRefreshIsThrottled() async {
        let defaults = makeDefaults()
        let fixedNow = Date()
        let stub = StubDiamondScoutClient()
        let service = DiamondScoutLineupService(
            clientProvider: { stub },
            defaults: defaults,
            refreshThrottle: 15,
            now: { fixedNow }
        )
        await service.startGameSession()
        XCTAssertEqual(stub.lineupSummariesCallCount, 1)

        await service.refreshInBackground()
        XCTAssertEqual(stub.lineupSummariesCallCount, 2)

        await service.refreshInBackground()
        XCTAssertEqual(stub.lineupSummariesCallCount, 2)
    }

    @MainActor
    func testRefreshFailureKeepsCachedSummaries() async {
        let defaults = makeDefaults()
        let stub = StubDiamondScoutClient()
        let service = DiamondScoutLineupService(clientProvider: { stub }, defaults: defaults)
        await service.startGameSession()

        stub.shouldFail = true
        await service.refreshInBackground()

        XCTAssertEqual(service.state, .loaded)
        XCTAssertEqual(service.summaries.count, 2)
    }
}

private final class StubDiamondScoutClient: DiamondScoutClient {
    let usesMockData = true
    var shouldFail = false
    private(set) var lineupSummariesCallCount = 0

    private let game = DiamondScoutGame(
        id: 101,
        opponentID: 70,
        opponentName: "Edina Hornets 14AAA",
        gameDate: "2026-06-10",
        homeAway: "Away",
        location: nil,
        status: "in_progress",
        chartingSessionID: nil,
        lineupCount: 2
    )

    private let scheduledGame = DiamondScoutGame(
        id: 102,
        opponentID: 67,
        opponentName: "Chaska Hawks 14AAA",
        gameDate: "2026-06-12",
        homeAway: "Home",
        location: nil,
        status: "scheduled",
        chartingSessionID: nil,
        lineupCount: nil
    )

    func games(opponentID: Int?) async throws -> [DiamondScoutGame] {
        try failIfNeeded()
        return [scheduledGame, game]
    }

    func lineupSummaries(gameID: Int) async throws -> DiamondScoutLineupSummariesResponse {
        try failIfNeeded()
        lineupSummariesCallCount += 1
        return DiamondScoutLineupSummariesResponse(
            gameID: gameID,
            opponentID: 70,
            summaries: [
                DiamondScoutHitterSummary(
                    slot: 2,
                    hitter: DiamondScoutHitter(id: 8, name: "Mason Strey", displayName: "#8 Mason Strey", jersey: "8", bats: "L"),
                    verdict: "Late trigger.",
                    attackTags: ["Challenge in"],
                    zoneHeat: nil
                ),
                DiamondScoutHitterSummary(
                    slot: 1,
                    hitter: DiamondScoutHitter(id: 4, name: "Isaiah Kelly", displayName: "#4 Isaiah Kelly", jersey: "4", bats: "R"),
                    verdict: "Dead-red early.",
                    attackTags: ["Start soft"],
                    zoneHeat: nil
                )
            ]
        )
    }

    func session() async throws -> DiamondScoutSession {
        throw DiamondScoutClientError.apiError("unused")
    }

    func opponents() async throws -> [DiamondScoutOpponent] {
        throw DiamondScoutClientError.apiError("unused")
    }

    func game(id: Int) async throws -> DiamondScoutGameContext {
        throw DiamondScoutClientError.apiError("unused")
    }

    func currentHitter(gameID: Int) async throws -> DiamondScoutCurrentHitter {
        throw DiamondScoutClientError.apiError("unused")
    }

    func hitterCard(opponentID: Int, hitterID: Int, gameID: Int?) async throws -> DiamondScoutHitterCard {
        throw DiamondScoutClientError.apiError("unused")
    }

    func hitterCardByJersey(opponentID: Int, jersey: String, gameID: Int?) async throws -> DiamondScoutHitterCard {
        throw DiamondScoutClientError.apiError("unused")
    }

    func postEvents(gameID: Int, events: [DiamondScoutChartingEvent]) async throws -> DiamondScoutEventsResponse {
        throw DiamondScoutClientError.apiError("unused")
    }

    private func failIfNeeded() throws {
        if shouldFail {
            throw DiamondScoutClientError.apiError("Simulated network failure")
        }
    }
}
