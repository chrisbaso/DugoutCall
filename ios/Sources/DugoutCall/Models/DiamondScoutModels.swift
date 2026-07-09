import Foundation

public struct DiamondScoutConfig: Equatable {
    public let apiBaseURL: String
    public let bearerToken: String
    public let forceMockMode: Bool

    public init(apiBaseURL: String, bearerToken: String, forceMockMode: Bool) {
        self.apiBaseURL = apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        self.bearerToken = bearerToken.trimmingCharacters(in: .whitespacesAndNewlines)
        self.forceMockMode = forceMockMode
    }

    public var usesMockData: Bool {
        forceMockMode || apiBaseURL.isEmpty || bearerToken.isEmpty
    }

    public var normalizedBaseURL: URL? {
        guard !apiBaseURL.isEmpty else { return nil }
        return URL(string: apiBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }
}

public enum DiamondScoutClientError: LocalizedError, Equatable {
    case missingConfiguration
    case invalidURL
    case apiError(String)

    public var errorDescription: String? {
        switch self {
        case .missingConfiguration:
            return "Diamond Scout API base URL and Bearer token are required for live mode."
        case .invalidURL:
            return "Diamond Scout API base URL is invalid."
        case .apiError(let message):
            return message
        }
    }
}

public struct DiamondScoutSession: Codable, Equatable {
    public let schemaVersion: String
    public let program: DiamondScoutProgram
    public let capabilities: DiamondScoutCapabilities
    public let countRulesVersion: String
    public let enums: DiamondScoutEnums

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case program
        case capabilities
        case countRulesVersion = "count_rules_version"
        case enums
    }
}

public struct DiamondScoutProgram: Codable, Equatable {
    public let name: String
    public let season: String
}

public struct DiamondScoutCapabilities: Codable, Equatable {
    public let hitterCards: Bool
    public let gameSetup: Bool
    public let eventIngest: Bool
    public let currentHitter: Bool
    public let advance: Bool
    public let offlineEventQueue: Bool

    enum CodingKeys: String, CodingKey {
        case hitterCards = "hitter_cards"
        case gameSetup = "game_setup"
        case eventIngest = "event_ingest"
        case currentHitter = "current_hitter"
        case advance
        case offlineEventQueue = "offline_event_queue"
    }
}

public struct DiamondScoutEnums: Codable, Equatable {
    public let pitchResults: [String]
    public let paActions: [String]
    public let paResults: [String]
    public let pitchLocations: [String]

    enum CodingKeys: String, CodingKey {
        case pitchResults = "pitch_results"
        case paActions = "pa_actions"
        case paResults = "pa_results"
        case pitchLocations = "pitch_locations"
    }
}

public struct DiamondScoutOpponent: Codable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let season: String
    public let gameCount: Int
    public let hitterCount: Int
    public let chartedGameCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case season
        case gameCount = "game_count"
        case hitterCount = "hitter_count"
        case chartedGameCount = "charted_game_count"
    }
}

public struct DiamondScoutOpponentsResponse: Codable, Equatable {
    public let opponents: [DiamondScoutOpponent]
}

public struct DiamondScoutGame: Codable, Equatable, Identifiable {
    public let id: Int
    public let opponentID: Int
    public let opponentName: String
    public let gameDate: String
    public let homeAway: String
    public let location: String?
    public let status: String
    public let chartingSessionID: Int?
    public let lineupCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case opponentID = "opponent_id"
        case opponentName = "opponent_name"
        case gameDate = "game_date"
        case homeAway = "home_away"
        case location
        case status
        case chartingSessionID = "charting_session_id"
        case lineupCount = "lineup_count"
    }
}

public struct DiamondScoutGamesResponse: Codable, Equatable {
    public let games: [DiamondScoutGame]
}

public struct DiamondScoutGameContext: Codable, Equatable {
    public let game: DiamondScoutGame
    public let lineup: [DiamondScoutLineupHitter]
    public let eventSummary: DiamondScoutEventSummary?

    enum CodingKeys: String, CodingKey {
        case game
        case lineup
        case eventSummary = "event_summary"
    }
}

public struct DiamondScoutLineupHitter: Codable, Equatable, Identifiable {
    public var id: Int { hitterID }
    public let slot: Int
    public let hitterID: Int
    public let jersey: String?
    public let name: String
    public let notes: String?

    enum CodingKeys: String, CodingKey {
        case slot
        case hitterID = "hitter_id"
        case jersey
        case name
        case notes
    }
}

public struct DiamondScoutEventSummary: Codable, Equatable {
    public let acceptedEvents: Int
    public let plateAppearances: Int
    public let lastEventID: String?

    enum CodingKeys: String, CodingKey {
        case acceptedEvents = "accepted_events"
        case plateAppearances = "plate_appearances"
        case lastEventID = "last_event_id"
    }
}

public struct DiamondScoutCurrentHitter: Codable, Equatable {
    public let gameID: Int
    public let lineupSlot: Int
    public let plateAppearanceKey: String
    public let hitterID: Int
    public let count: DiamondScoutCount
    public let card: DiamondScoutHitterCard
    public let next: [DiamondScoutNextHitter]

    enum CodingKeys: String, CodingKey {
        case gameID = "game_id"
        case lineupSlot = "lineup_slot"
        case plateAppearanceKey = "plate_appearance_key"
        case hitterID = "hitter_id"
        case count
        case card
        case next
    }
}

public struct DiamondScoutCount: Codable, Equatable {
    public let balls: Int
    public let strikes: Int
    public let label: String
}

public struct DiamondScoutHitterCard: Codable, Equatable, Identifiable {
    public var id: Int { hitter.id }
    public let schemaVersion: String
    public let opponent: DiamondScoutCardOpponent
    public let gameID: Int?
    public let hitter: DiamondScoutHitter
    public let tier: DiamondScoutTier
    public let confidence: DiamondScoutConfidence
    public let plan: DiamondScoutPlan
    public let quickStats: DiamondScoutQuickStats
    public let chips: [DiamondScoutChip]
    public let defense: DiamondScoutDefense
    public let running: DiamondScoutRunning
    public let next: [DiamondScoutNextHitter]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case opponent
        case gameID = "game_id"
        case hitter
        case tier
        case confidence
        case plan
        case quickStats = "quick_stats"
        case chips
        case defense
        case running
        case next
    }
}

public struct DiamondScoutCardOpponent: Codable, Equatable {
    public let id: Int
    public let name: String
    public let season: String
}

public struct DiamondScoutHitter: Codable, Equatable {
    public let id: Int
    public let name: String
    public let displayName: String
    public let jersey: String?
    public let bats: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case displayName = "display_name"
        case jersey
        case bats
    }
}

public struct DiamondScoutTier: Codable, Equatable {
    public let key: String
    public let label: String
}

public struct DiamondScoutConfidence: Codable, Equatable {
    public let level: String
    public let key: String
    public let label: String
    public let lowSample: Bool
    public let paSample: Int
    public let chartedBIP: Int
    public let sprayLevel: String
    public let sprayLabel: String

    enum CodingKeys: String, CodingKey {
        case level
        case key
        case label
        case lowSample = "low_sample"
        case paSample = "pa_sample"
        case chartedBIP = "charted_bip"
        case sprayLevel = "spray_level"
        case sprayLabel = "spray_label"
    }
}

public struct DiamondScoutPlan: Codable, Equatable {
    public let outPlan: String?
    public let pitchPlan: String?
    public let coachNote: String?

    enum CodingKeys: String, CodingKey {
        case outPlan = "out_plan"
        case pitchPlan = "pitch_plan"
        case coachNote = "coach_note"
    }
}

public struct DiamondScoutQuickStats: Codable, Equatable {
    public let pa: String?
    public let ab: String?
    public let avg: String?
    public let obp: String?
    public let slg: String?
    public let ops: String?
    public let bb: String?
    public let k: String?
    public let kPct: String?
    public let bbPct: String?
    public let sb: String?
    public let cs: String?
    public let bunt: String?
    public let firstPitch: String?
    public let contact: String?

    enum CodingKeys: String, CodingKey {
        case pa
        case ab
        case avg
        case obp
        case slg
        case ops
        case bb
        case k
        case kPct = "k_pct"
        case bbPct = "bb_pct"
        case sb
        case cs
        case bunt
        case firstPitch = "first_pitch"
        case contact
    }
}

public struct DiamondScoutChip: Codable, Equatable, Identifiable {
    public var id: String { "\(text)-\(kind)" }
    public let text: String
    public let kind: String
}

public struct DiamondScoutDefense: Codable, Equatable {
    public let sampleSize: Int
    public let confidence: String
    public let confidenceCode: String
    public let gbLCR: [Int]
    public let airLCR: [Int]
    public let ifCall: String?
    public let ofCall: String?
    public let pullOppo: String?
    public let fieldFanSVGDark: String?
    public let fieldFanSVGLight: String?

    enum CodingKeys: String, CodingKey {
        case sampleSize = "sample_size"
        case confidence
        case confidenceCode = "confidence_code"
        case gbLCR = "gb_lcr"
        case airLCR = "air_lcr"
        case ifCall = "if_call"
        case ofCall = "of_call"
        case pullOppo = "pull_oppo"
        case fieldFanSVGDark = "field_fan_svg_dark"
        case fieldFanSVGLight = "field_fan_svg_light"
    }
}

public struct DiamondScoutRunning: Codable, Equatable {
    public let speed: String?
    public let stolenBases: Int
    public let bunt: String?
    public let buntCount: Int

    enum CodingKeys: String, CodingKey {
        case speed
        case stolenBases = "stolen_bases"
        case bunt
        case buntCount = "bunt_count"
    }
}

public struct DiamondScoutNextHitter: Codable, Equatable, Identifiable {
    public var id: Int { hitterID }
    public let slot: Int
    public let hitterID: Int
    public let displayName: String

    enum CodingKeys: String, CodingKey {
        case slot
        case hitterID = "hitter_id"
        case displayName = "display_name"
    }
}

public struct DiamondScoutLineupSummariesResponse: Codable, Equatable {
    public let gameID: Int
    public let opponentID: Int
    public let summaries: [DiamondScoutHitterSummary]

    enum CodingKeys: String, CodingKey {
        case gameID = "game_id"
        case opponentID = "opponent_id"
        case summaries
    }
}

public struct DiamondScoutHitterSummary: Codable, Equatable, Identifiable {
    public var id: Int { hitter.id }
    public let slot: Int
    public let hitter: DiamondScoutHitter
    public let verdict: String?
    public let attackTags: [String]
    public let zoneHeat: DiamondScoutZoneHeat?

    public var hasScoutingData: Bool {
        verdict != nil || !attackTags.isEmpty || zoneHeat != nil
    }

    enum CodingKeys: String, CodingKey {
        case slot
        case hitter
        case verdict
        case attackTags = "attack_tags"
        case zoneHeat = "zone_heat"
    }
}

public struct DiamondScoutZoneHeat: Codable, Equatable {
    public let kind: String
    public let wedges: [DiamondScoutHeatWedge]
    public let sampleSize: Int
    public let lowSample: Bool

    enum CodingKeys: String, CodingKey {
        case kind
        case wedges
        case sampleSize = "sample_size"
        case lowSample = "low_sample"
    }
}

public struct DiamondScoutHeatWedge: Codable, Equatable, Identifiable {
    public var id: String { location }
    public let location: String
    public let value: Int
}

public struct DiamondScoutEventsRequest: Codable, Equatable {
    public let events: [DiamondScoutChartingEvent]
}

public struct DiamondScoutChartingEvent: Codable, Equatable {
    public let eventID: String
    public let sequence: Int
    public let type: String
    public let paKey: String
    public let pitchSequence: Int?
    public let countBefore: String?
    public let pitchType: String?
    public let pitchLocation: String?
    public let result: DiamondScoutEventResult?

    public init(
        eventID: String,
        sequence: Int,
        type: String,
        paKey: String,
        pitchSequence: Int? = nil,
        countBefore: String? = nil,
        pitchType: String? = nil,
        pitchLocation: String? = nil,
        result: DiamondScoutEventResult? = nil
    ) {
        self.eventID = eventID
        self.sequence = sequence
        self.type = type
        self.paKey = paKey
        self.pitchSequence = pitchSequence
        self.countBefore = countBefore
        self.pitchType = pitchType
        self.pitchLocation = pitchLocation
        self.result = result
    }

    enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case sequence
        case type
        case paKey = "pa_key"
        case pitchSequence = "pitch_sequence"
        case countBefore = "count_before"
        case pitchType = "pitch_type"
        case pitchLocation = "pitch_location"
        case result
    }
}

public struct DiamondScoutEventResult: Codable, Equatable {
    public let kind: String
}

public struct DiamondScoutEventsResponse: Codable, Equatable {
    public let accepted: Int
    public let rejected: [DiamondScoutRejectedEvent]
}

public struct DiamondScoutRejectedEvent: Codable, Equatable, Identifiable {
    public var id: String { eventID }
    public let eventID: String
    public let index: Int?
    public let reason: String

    enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case index
        case reason
    }
}
