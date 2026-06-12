import Combine
import Foundation

@MainActor
public final class SettingsStore: ObservableObject {
    @Published public var teamName: String {
        didSet { defaults.set(teamName, forKey: Keys.teamName) }
    }
    @Published public var coachName: String {
        didSet { defaults.set(coachName, forKey: Keys.coachName) }
    }
    @Published public var serverURL: String {
        didSet { defaults.set(serverURL, forKey: Keys.serverURL) }
    }
    @Published public var speechRate: Double {
        didSet { defaults.set(speechRate, forKey: Keys.speechRate) }
    }
    @Published public var speechVolume: Double {
        didSet { defaults.set(speechVolume, forKey: Keys.speechVolume) }
    }
    @Published public var mode: AppMode {
        didSet { defaults.set(mode.rawValue, forKey: Keys.mode) }
    }
    @Published public var confirmBeforeGameMode: Bool {
        didSet { defaults.set(confirmBeforeGameMode, forKey: Keys.confirmBeforeGameMode) }
    }
    @Published public var localPitchHistoryEnabled: Bool {
        didSet { defaults.set(localPitchHistoryEnabled, forKey: Keys.localPitchHistoryEnabled) }
    }
    @Published public var diamondScoutAPIBaseURL: String {
        didSet { defaults.set(diamondScoutAPIBaseURL, forKey: Keys.diamondScoutAPIBaseURL) }
    }
    @Published public var diamondScoutBearerToken: String {
        didSet { defaults.set(diamondScoutBearerToken, forKey: Keys.diamondScoutBearerToken) }
    }
    @Published public var diamondScoutMockMode: Bool {
        didSet { defaults.set(diamondScoutMockMode, forKey: Keys.diamondScoutMockMode) }
    }
    @Published public var presets: [PresetCall] {
        didSet {
            if let data = try? JSONEncoder().encode(presets) {
                defaults.set(data, forKey: Keys.presets)
            }
        }
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        teamName = defaults.string(forKey: Keys.teamName) ?? ""
        coachName = defaults.string(forKey: Keys.coachName) ?? ""
        serverURL = defaults.string(forKey: Keys.serverURL) ?? "http://localhost:8787"
        speechRate = defaults.object(forKey: Keys.speechRate) as? Double ?? 0.48
        speechVolume = defaults.object(forKey: Keys.speechVolume) as? Double ?? 1.0
        mode = AppMode(rawValue: defaults.string(forKey: Keys.mode) ?? "") ?? .game
        confirmBeforeGameMode = defaults.object(forKey: Keys.confirmBeforeGameMode) as? Bool ?? true
        localPitchHistoryEnabled = defaults.object(forKey: Keys.localPitchHistoryEnabled) as? Bool ?? false
        diamondScoutAPIBaseURL = defaults.string(forKey: Keys.diamondScoutAPIBaseURL) ?? ""
        diamondScoutBearerToken = defaults.string(forKey: Keys.diamondScoutBearerToken) ?? ""
        diamondScoutMockMode = defaults.object(forKey: Keys.diamondScoutMockMode) as? Bool ?? true
        if let data = defaults.data(forKey: Keys.presets),
           let decoded = try? JSONDecoder().decode([PresetCall].self, from: data) {
            presets = decoded
        } else {
            presets = PresetCall.defaults
        }
    }

    private enum Keys {
        static let teamName = "teamName"
        static let coachName = "coachName"
        static let serverURL = "serverURL"
        static let speechRate = "speechRate"
        static let speechVolume = "speechVolume"
        static let mode = "mode"
        static let confirmBeforeGameMode = "confirmBeforeGameMode"
        static let localPitchHistoryEnabled = "localPitchHistoryEnabled"
        static let diamondScoutAPIBaseURL = "diamondScoutAPIBaseURL"
        static let diamondScoutBearerToken = "diamondScoutBearerToken"
        static let diamondScoutMockMode = "diamondScoutMockMode"
        static let presets = "presets"
    }
}
