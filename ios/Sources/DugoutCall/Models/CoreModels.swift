import Foundation

public enum AppMode: String, Codable, CaseIterable, Identifiable {
    case game
    case practice

    public var id: String { rawValue }
    public var label: String { self == .game ? "Game Mode" : "Practice Mode" }
}

public enum UserRole: String, Codable, CaseIterable, Identifiable {
    case coach
    case catcher

    public var id: String { rawValue }
    public var label: String { self == .coach ? "Coach" : "Catcher" }
}

public enum ConnectionState: String, Codable {
    case idle
    case connecting
    case connected
    case disconnected
}

public struct Room: Codable, Equatable, Identifiable {
    public var id: String { code }
    public let code: String
    public let mode: AppMode
    public let expiresAt: Int64
    public let token: String?

    public init(code: String, mode: AppMode = .game, expiresAt: Int64, token: String? = nil) {
        self.code = code
        self.mode = mode
        self.expiresAt = expiresAt
        self.token = token
    }
}

public struct Participant: Codable, Equatable, Identifiable {
    public let id: UUID
    public let role: UserRole
    public let displayName: String?

    public init(id: UUID = UUID(), role: UserRole, displayName: String? = nil) {
        self.id = id
        self.role = role
        self.displayName = displayName
    }
}

public enum PitchType: String, Codable, CaseIterable, Identifiable {
    case fastball = "Fastball"
    case twoSeam = "2-Seam"
    case cutter = "Cutter"
    case slider = "Slider"
    case curveball = "Curveball"
    case changeup = "Changeup"
    case splitter = "Splitter"
    case pitchout = "Pitchout"
    case pickoff = "Pickoff"
    case custom1 = "Custom 1"
    case custom2 = "Custom 2"

    public var id: String { rawValue }
}

public enum PitchLocation: String, Codable, CaseIterable, Identifiable {
    case up = "Up"
    case down = "Down"
    case `in` = "In"
    case away = "Away"
    case middle = "Middle"
    case upIn = "Up/In"
    case upAway = "Up/Away"
    case downIn = "Down/In"
    case downAway = "Down/Away"

    public var id: String { rawValue }

    public var spokenText: String {
        rawValue
            .replacingOccurrences(of: "/", with: " ")
            .lowercased()
    }
}

public struct PitchCall: Codable, Equatable, Identifiable {
    public let id: UUID
    public let pitch: PitchType
    public let location: PitchLocation?
    public let timestamp: Int64

    public init(
        id: UUID = UUID(),
        pitch: PitchType,
        location: PitchLocation? = nil,
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) {
        self.id = id
        self.pitch = pitch
        self.location = location
        self.timestamp = timestamp
    }

    public var spokenText: String {
        guard let location, pitch != .pickoff, pitch != .pitchout else {
            return pitch.rawValue
        }
        return "\(pitch.rawValue) \(location.spokenText)"
    }

    public func repeating() -> PitchCall {
        PitchCall(pitch: pitch, location: location)
    }
}

public struct PresetCall: Codable, Equatable, Identifiable {
    public let id: UUID
    public var label: String
    public var pitch: PitchType
    public var location: PitchLocation?

    public init(id: UUID = UUID(), label: String, pitch: PitchType, location: PitchLocation? = nil) {
        self.id = id
        self.label = label
        self.pitch = pitch
        self.location = location
    }

    public var pitchCall: PitchCall {
        PitchCall(pitch: pitch, location: location)
    }

    public static let defaults: [PresetCall] = [
        PresetCall(label: "FB Away", pitch: .fastball, location: .away),
        PresetCall(label: "FB Up", pitch: .fastball, location: .up),
        PresetCall(label: "Slider Away", pitch: .slider, location: .away),
        PresetCall(label: "Curve Down", pitch: .curveball, location: .down),
        PresetCall(label: "Change Down", pitch: .changeup, location: .down),
        PresetCall(label: "Waste", pitch: .fastball, location: .upAway),
        PresetCall(label: "Pitchout", pitch: .pitchout),
        PresetCall(label: "Pickoff 1B", pitch: .pickoff)
    ]
}

public struct AudioRouteState: Codable, Equatable {
    public var inputRoute: String
    public var outputRoute: String
    public var isBluetoothActive: Bool
    public var isMicrophonePermissionGranted: Bool
    public var isSpeechSynthesisReady: Bool

    public init(
        inputRoute: String = "Unknown",
        outputRoute: String = "Unknown",
        isBluetoothActive: Bool = false,
        isMicrophonePermissionGranted: Bool = false,
        isSpeechSynthesisReady: Bool = true
    ) {
        self.inputRoute = inputRoute
        self.outputRoute = outputRoute
        self.isBluetoothActive = isBluetoothActive
        self.isMicrophonePermissionGranted = isMicrophonePermissionGranted
        self.isSpeechSynthesisReady = isSpeechSynthesisReady
    }

    public var airPodsStatusText: String {
        isBluetoothActive ? "AirPods connected" : "AirPods not detected"
    }
}
