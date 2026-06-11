import Foundation

public enum DugoutMessage: Equatable {
    case createRoom(coachName: String?, teamName: String?)
    case joinRoom(code: String, role: UserRole, displayName: String?, token: String?)
    case roleAssigned(code: String, role: UserRole, mode: AppMode, expiresAt: Int64)
    case pitchCall(PitchCall)
    case pttStart(timestamp: Int64)
    case pttStop(timestamp: Int64)
    case heartbeat(timestamp: Int64)
    case callAck(id: String, recipientCount: Int, timestamp: Int64)
    case peerStatus(role: UserRole, connected: Bool)
    case roomClosed(reason: String)
    case error(message: String)
}

extension DugoutMessage: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case code
        case role
        case mode
        case expiresAt
        case coachName
        case teamName
        case displayName
        case token
        case id
        case pitch
        case location
        case spokenText
        case timestamp
        case recipientCount
        case connected
        case reason
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "create_room":
            self = .createRoom(
                coachName: try container.decodeIfPresent(String.self, forKey: .coachName),
                teamName: try container.decodeIfPresent(String.self, forKey: .teamName)
            )
        case "join_room":
            self = .joinRoom(
                code: try container.decode(String.self, forKey: .code),
                role: try container.decode(UserRole.self, forKey: .role),
                displayName: try container.decodeIfPresent(String.self, forKey: .displayName),
                token: try container.decodeIfPresent(String.self, forKey: .token)
            )
        case "role_assigned":
            self = .roleAssigned(
                code: try container.decode(String.self, forKey: .code),
                role: try container.decode(UserRole.self, forKey: .role),
                mode: try container.decode(AppMode.self, forKey: .mode),
                expiresAt: try container.decode(Int64.self, forKey: .expiresAt)
            )
        case "pitch_call":
            let id = UUID(uuidString: try container.decode(String.self, forKey: .id)) ?? UUID()
            self = .pitchCall(PitchCall(
                id: id,
                pitch: try container.decode(PitchType.self, forKey: .pitch),
                location: try container.decodeIfPresent(PitchLocation.self, forKey: .location),
                timestamp: try container.decode(Int64.self, forKey: .timestamp)
            ))
        case "ptt_start":
            self = .pttStart(timestamp: try container.decode(Int64.self, forKey: .timestamp))
        case "ptt_stop":
            self = .pttStop(timestamp: try container.decode(Int64.self, forKey: .timestamp))
        case "heartbeat":
            self = .heartbeat(timestamp: try container.decode(Int64.self, forKey: .timestamp))
        case "call_ack":
            self = .callAck(
                id: try container.decode(String.self, forKey: .id),
                recipientCount: try container.decode(Int.self, forKey: .recipientCount),
                timestamp: try container.decode(Int64.self, forKey: .timestamp)
            )
        case "peer_status":
            self = .peerStatus(
                role: try container.decode(UserRole.self, forKey: .role),
                connected: try container.decode(Bool.self, forKey: .connected)
            )
        case "room_closed":
            self = .roomClosed(reason: try container.decode(String.self, forKey: .reason))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unsupported message type \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .createRoom(let coachName, let teamName):
            try container.encode("create_room", forKey: .type)
            try container.encodeIfPresent(coachName, forKey: .coachName)
            try container.encodeIfPresent(teamName, forKey: .teamName)
        case .joinRoom(let code, let role, let displayName, let token):
            try container.encode("join_room", forKey: .type)
            try container.encode(code, forKey: .code)
            try container.encode(role, forKey: .role)
            try container.encodeIfPresent(displayName, forKey: .displayName)
            try container.encodeIfPresent(token, forKey: .token)
        case .roleAssigned(let code, let role, let mode, let expiresAt):
            try container.encode("role_assigned", forKey: .type)
            try container.encode(code, forKey: .code)
            try container.encode(role, forKey: .role)
            try container.encode(mode, forKey: .mode)
            try container.encode(expiresAt, forKey: .expiresAt)
        case .pitchCall(let call):
            try container.encode("pitch_call", forKey: .type)
            try container.encode(call.id.uuidString, forKey: .id)
            try container.encode(call.pitch, forKey: .pitch)
            try container.encodeIfPresent(call.location, forKey: .location)
            try container.encode(call.spokenText, forKey: .spokenText)
            try container.encode(call.timestamp, forKey: .timestamp)
        case .pttStart(let timestamp):
            try container.encode("ptt_start", forKey: .type)
            try container.encode(timestamp, forKey: .timestamp)
        case .pttStop(let timestamp):
            try container.encode("ptt_stop", forKey: .type)
            try container.encode(timestamp, forKey: .timestamp)
        case .heartbeat(let timestamp):
            try container.encode("heartbeat", forKey: .type)
            try container.encode(timestamp, forKey: .timestamp)
        case .callAck(let id, let recipientCount, let timestamp):
            try container.encode("call_ack", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(recipientCount, forKey: .recipientCount)
            try container.encode(timestamp, forKey: .timestamp)
        case .peerStatus(let role, let connected):
            try container.encode("peer_status", forKey: .type)
            try container.encode(role, forKey: .role)
            try container.encode(connected, forKey: .connected)
        case .roomClosed(let reason):
            try container.encode("room_closed", forKey: .type)
            try container.encode(reason, forKey: .reason)
        case .error(let message):
            try container.encode("error", forKey: .type)
            try container.encode(message, forKey: .message)
        }
    }
}

public extension JSONEncoder {
    static var dugoutCall: JSONEncoder {
        JSONEncoder()
    }
}

public extension JSONDecoder {
    static var dugoutCall: JSONDecoder {
        JSONDecoder()
    }
}
