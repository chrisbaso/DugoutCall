import Foundation

public protocol DiamondScoutClient {
    var usesMockData: Bool { get }

    func session() async throws -> DiamondScoutSession
    func opponents() async throws -> [DiamondScoutOpponent]
    func games(opponentID: Int?) async throws -> [DiamondScoutGame]
    func game(id: Int) async throws -> DiamondScoutGameContext
    func currentHitter(gameID: Int) async throws -> DiamondScoutCurrentHitter
    func lineupSummaries(gameID: Int) async throws -> DiamondScoutLineupSummariesResponse
    func hitterCard(opponentID: Int, hitterID: Int, gameID: Int?) async throws -> DiamondScoutHitterCard
    func hitterCardByJersey(opponentID: Int, jersey: String, gameID: Int?) async throws -> DiamondScoutHitterCard
    func postEvents(gameID: Int, events: [DiamondScoutChartingEvent]) async throws -> DiamondScoutEventsResponse
}

public enum DiamondScoutClientFactory {
    public static func make(config: DiamondScoutConfig) -> any DiamondScoutClient {
        if config.usesMockData {
            return DiamondScoutMockClient()
        }
        return DiamondScoutAPIClient(config: config)
    }
}

public final class DiamondScoutAPIClient: DiamondScoutClient {
    public let usesMockData = false

    private let config: DiamondScoutConfig
    private let urlSession: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(config: DiamondScoutConfig, session: URLSession = .shared) {
        self.config = config
        self.urlSession = session
        decoder = JSONDecoder()
        encoder = JSONEncoder()
    }

    public func session() async throws -> DiamondScoutSession {
        try await get("session")
    }

    public func opponents() async throws -> [DiamondScoutOpponent] {
        let response: DiamondScoutOpponentsResponse = try await get("opponents")
        return response.opponents
    }

    public func games(opponentID: Int? = nil) async throws -> [DiamondScoutGame] {
        var query: [URLQueryItem] = []
        if let opponentID {
            query.append(URLQueryItem(name: "opponent_id", value: String(opponentID)))
        }
        let response: DiamondScoutGamesResponse = try await get("games", query: query)
        return response.games
    }

    public func game(id: Int) async throws -> DiamondScoutGameContext {
        try await get("games/\(id)")
    }

    public func currentHitter(gameID: Int) async throws -> DiamondScoutCurrentHitter {
        try await get("games/\(gameID)/current-hitter")
    }

    public func lineupSummaries(gameID: Int) async throws -> DiamondScoutLineupSummariesResponse {
        try await get("games/\(gameID)/lineup-summaries")
    }

    public func hitterCard(opponentID: Int, hitterID: Int, gameID: Int? = nil) async throws -> DiamondScoutHitterCard {
        var query: [URLQueryItem] = []
        if let gameID {
            query.append(URLQueryItem(name: "game_id", value: String(gameID)))
        }
        return try await get("opponents/\(opponentID)/hitters/\(hitterID)/card", query: query)
    }

    public func hitterCardByJersey(opponentID: Int, jersey: String, gameID: Int? = nil) async throws -> DiamondScoutHitterCard {
        var query: [URLQueryItem] = []
        if let gameID {
            query.append(URLQueryItem(name: "game_id", value: String(gameID)))
        }
        return try await get("opponents/\(opponentID)/hitters/by-jersey/\(jersey)/card", query: query)
    }

    public func postEvents(gameID: Int, events: [DiamondScoutChartingEvent]) async throws -> DiamondScoutEventsResponse {
        try await post("games/\(gameID)/events", body: DiamondScoutEventsRequest(events: events))
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var request = try request(path: path, query: query)
        request.httpMethod = "GET"
        return try await send(request)
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        var request = try request(path: path)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        return try await send(request)
    }

    private func request(path: String, query: [URLQueryItem] = []) throws -> URLRequest {
        guard !config.bearerToken.isEmpty else {
            throw DiamondScoutClientError.missingConfiguration
        }
        guard let baseURL = config.normalizedBaseURL else {
            throw DiamondScoutClientError.invalidURL
        }

        var url = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("v1")
        for component in path.split(separator: "/") {
            url.appendPathComponent(String(component))
        }
        if !query.isEmpty {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = query
            guard let queryURL = components?.url else {
                throw DiamondScoutClientError.invalidURL
            }
            url = queryURL
        }

        var request = URLRequest(url: url)
        request.addValue("Bearer \(config.bearerToken)", forHTTPHeaderField: "Authorization")
        request.addValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await urlSession.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DiamondScoutClientError.apiError("Diamond Scout returned an invalid response.")
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            if let apiError = try? decoder.decode(DiamondScoutErrorResponse.self, from: data) {
                throw DiamondScoutClientError.apiError(apiError.error.message)
            }
            throw DiamondScoutClientError.apiError("Diamond Scout returned HTTP \(httpResponse.statusCode).")
        }
        return try decoder.decode(T.self, from: data)
    }
}

private struct DiamondScoutErrorResponse: Decodable {
    let error: DiamondScoutAPIError
}

private struct DiamondScoutAPIError: Decodable {
    let code: String
    let message: String
    let field: String?
}

public final class DiamondScoutMockClient: DiamondScoutClient {
    public let usesMockData = true

    public init() {}

    public func session() async throws -> DiamondScoutSession {
        DiamondScoutSession(
            schemaVersion: "2026-08-17",
            program: DiamondScoutProgram(name: "Diamond Scout", season: "2026"),
            capabilities: DiamondScoutCapabilities(
                hitterCards: true,
                gameSetup: true,
                eventIngest: true,
                currentHitter: true,
                advance: true,
                offlineEventQueue: true,
                devicePairing: true
            ),
            device: DiamondScoutDevice(id: "dcd_reference", label: "Reference iPhone", platform: "ios", lastUsedAt: nil),
            countRulesVersion: "2026-08-17",
            enums: DiamondScoutEnums(
                pitchResults: ["ball", "called_strike", "swinging_strike", "foul", "foul_bunt", "in_play", "hbp"],
                paActions: ["intentional_walk"],
                paResults: ["walk", "strikeout", "hbp", "single", "double", "triple", "home_run", "field_out", "fielders_choice", "error", "sac_fly", "sac_bunt"],
                pitchLocations: ["inside", "away", "up", "down", "middle", "up_in", "up_away", "down_in", "down_away"],
                runnerResults: ["stolen_base", "caught_stealing"]
            )
        )
    }

    public func opponents() async throws -> [DiamondScoutOpponent] {
        [
            DiamondScoutOpponent(id: 70, name: "Edina Hornets 14AAA", season: "2026", gameCount: 4, hitterCount: 12, chartedGameCount: 2),
            DiamondScoutOpponent(id: 67, name: "Chaska Hawks 14AAA", season: "2026", gameCount: 3, hitterCount: 11, chartedGameCount: 2)
        ]
    }

    public func games(opponentID: Int? = nil) async throws -> [DiamondScoutGame] {
        let games = [
            DiamondScoutGame(id: 101, opponentID: 70, opponentName: "Edina Hornets 14AAA", gameDate: "2026-06-10", homeAway: "Away", location: "Edina Varsity Field", status: "in_progress", chartingSessionID: 55, lineupCount: 9),
            DiamondScoutGame(id: 102, opponentID: 67, opponentName: "Chaska Hawks 14AAA", gameDate: "2026-06-12", homeAway: "Home", location: "DugoutCall Field", status: "scheduled", chartingSessionID: nil, lineupCount: 9)
        ]
        guard let opponentID else { return games }
        return games.filter { $0.opponentID == opponentID }
    }

    public func game(id: Int) async throws -> DiamondScoutGameContext {
        let allGames = try await games(opponentID: nil)
        let selectedGame = allGames.first { $0.id == id } ?? allGames[0]
        return DiamondScoutGameContext(
            game: selectedGame,
            lineup: [
                DiamondScoutLineupHitter(slot: 1, hitterID: 4, jersey: "4", name: "Isaiah Kelly", notes: "Hold runners 1-0."),
                DiamondScoutLineupHitter(slot: 2, hitterID: 8, jersey: "8", name: "Mason Strey", notes: "Late trigger. Challenge in."),
                DiamondScoutLineupHitter(slot: 3, hitterID: 12, jersey: "12", name: "Nolan Price", notes: "Bunt threat."),
                DiamondScoutLineupHitter(slot: 4, hitterID: 23, jersey: "23", name: "Quinn Walsh", notes: nil)
            ],
            eventSummary: DiamondScoutEventSummary(acceptedEvents: 12, plateAppearances: 3, lastEventID: "dc-evt-0012", lastSequence: 12)
        )
    }

    public func currentHitter(gameID: Int) async throws -> DiamondScoutCurrentHitter {
        DiamondScoutCurrentHitter(
            schemaVersion: "2026-08-17",
            gameID: gameID,
            lineupSlot: 4,
            plateAppearanceKey: "g\(gameID)-pa-4",
            hitterID: 4,
            pitcherID: 17,
            paStarted: true,
            pitchSequence: 3,
            lastEventSequence: 4,
            count: DiamondScoutCount(balls: 2, strikes: 1, label: "2-1"),
            card: mockCard(gameID: gameID),
            onDeck: DiamondScoutNextHitter(slot: 5, hitterID: 8, displayName: "#8 Strey")
        )
    }

    public func lineupSummaries(gameID: Int) async throws -> DiamondScoutLineupSummariesResponse {
        DiamondScoutLineupSummariesResponse(
            gameID: gameID,
            opponentID: 70,
            summaries: [
                DiamondScoutHitterSummary(
                    slot: 1,
                    hitter: DiamondScoutHitter(id: 4, name: "Isaiah Kelly", displayName: "#4 Isaiah Kelly", jersey: "4", bats: "R"),
                    verdict: "Dead-red early in counts; chases low-away with two strikes.",
                    attackTags: ["Start soft", "Climb w/ 2K"],
                    zoneHeat: DiamondScoutZoneHeat(
                        kind: "field_fan",
                        wedges: [
                            DiamondScoutHeatWedge(location: "lf_line", value: 12),
                            DiamondScoutHeatWedge(location: "left_field", value: 33),
                            DiamondScoutHeatWedge(location: "center_field", value: 28),
                            DiamondScoutHeatWedge(location: "right_field", value: 18),
                            DiamondScoutHeatWedge(location: "rf_line", value: 9)
                        ],
                        sampleSize: 18,
                        lowSample: false
                    )
                ),
                DiamondScoutHitterSummary(
                    slot: 2,
                    hitter: DiamondScoutHitter(id: 8, name: "Mason Strey", displayName: "#8 Mason Strey", jersey: "8", bats: "L"),
                    verdict: "Late trigger; vulnerable to velocity on the inner half.",
                    attackTags: ["Challenge in", "FB up", "No waste pitches"],
                    zoneHeat: DiamondScoutZoneHeat(
                        kind: "field_fan",
                        wedges: [
                            DiamondScoutHeatWedge(location: "lf_line", value: 8),
                            DiamondScoutHeatWedge(location: "left_field", value: 18),
                            DiamondScoutHeatWedge(location: "center_field", value: 30),
                            DiamondScoutHeatWedge(location: "right_field", value: 28),
                            DiamondScoutHeatWedge(location: "rf_line", value: 16)
                        ],
                        sampleSize: 12,
                        lowSample: false
                    )
                ),
                DiamondScoutHitterSummary(
                    slot: 3,
                    hitter: DiamondScoutHitter(id: 12, name: "Nolan Price", displayName: "#12 Nolan Price", jersey: "12", bats: "R"),
                    verdict: "Bunt threat; slap contact to the left side.",
                    attackTags: ["Crash corners", "Stay low"],
                    zoneHeat: DiamondScoutZoneHeat(
                        kind: "field_fan",
                        wedges: [
                            DiamondScoutHeatWedge(location: "lf_line", value: 25),
                            DiamondScoutHeatWedge(location: "left_field", value: 35),
                            DiamondScoutHeatWedge(location: "center_field", value: 22),
                            DiamondScoutHeatWedge(location: "right_field", value: 12),
                            DiamondScoutHeatWedge(location: "rf_line", value: 6)
                        ],
                        sampleSize: 9,
                        lowSample: true
                    )
                ),
                DiamondScoutHitterSummary(
                    slot: 4,
                    hitter: DiamondScoutHitter(id: 23, name: "Quinn Walsh", displayName: "#23 Quinn Walsh", jersey: "23", bats: nil),
                    verdict: nil,
                    attackTags: [],
                    zoneHeat: nil
                )
            ]
        )
    }

    public func hitterCard(opponentID: Int, hitterID: Int, gameID: Int? = nil) async throws -> DiamondScoutHitterCard {
        mockCard(gameID: gameID)
    }

    public func hitterCardByJersey(opponentID: Int, jersey: String, gameID: Int? = nil) async throws -> DiamondScoutHitterCard {
        mockCard(gameID: gameID)
    }

    public func postEvents(gameID: Int, events: [DiamondScoutChartingEvent]) async throws -> DiamondScoutEventsResponse {
        DiamondScoutEventsResponse(accepted: events.count, rejected: [])
    }

    private func mockCard(gameID: Int?) -> DiamondScoutHitterCard {
        DiamondScoutHitterCard(
            schemaVersion: "2026-08-17",
            opponent: DiamondScoutCardOpponent(id: 70, name: "Edina Hornets 14AAA", season: "2026"),
            gameID: gameID,
            hitter: DiamondScoutHitter(id: 4, name: "Isaiah Kelly", displayName: "#4 Isaiah Kelly", jersey: "4", bats: "R"),
            tier: DiamondScoutTier(key: "t1", label: "Tier 1 - Handle with care"),
            confidence: DiamondScoutConfidence(
                level: "good",
                key: "high",
                label: "Good confidence",
                lowSample: false,
                paSample: 70,
                chartedBIP: 18,
                sprayLevel: "moderate",
                sprayLabel: "Moderate confidence"
            ),
            plan: DiamondScoutPlan(
                outPlan: "Attack the zone; do not give free bases.",
                pitchPlan: "Pound away until he adjusts.",
                coachNote: "Hold runners 1-0."
            ),
            quickStats: DiamondScoutQuickStats(
                pa: "70",
                ab: "60",
                avg: ".333",
                obp: ".421",
                slg: ".500",
                ops: ".921",
                bb: "8",
                k: "10",
                kPct: "14%",
                bbPct: "11%",
                sb: "5",
                cs: "1",
                bunt: "2",
                firstPitch: "40%",
                contact: "GB 40 / FB 35 / LD 20 / PU 5"
            ),
            chips: [
                DiamondScoutChip(text: "K 14%", kind: ""),
                DiamondScoutChip(text: "BB 8", kind: ""),
                DiamondScoutChip(text: "SB 5", kind: "run")
            ],
            defense: DiamondScoutDefense(
                sampleSize: 18,
                confidence: "High",
                confidenceCode: "+",
                gbLCR: [45, 35, 20],
                airLCR: [25, 45, 30],
                ifCall: "SS hole",
                ofCall: "CF shade",
                pullOppo: "Pull",
                fieldFanSVGDark: nil,
                fieldFanSVGLight: nil
            ),
            running: DiamondScoutRunning(speed: "+", stolenBases: 5, bunt: "Y", buntCount: 2),
            next: [
                DiamondScoutNextHitter(slot: 2, hitterID: 8, displayName: "#8 Strey")
            ]
        )
    }
}
