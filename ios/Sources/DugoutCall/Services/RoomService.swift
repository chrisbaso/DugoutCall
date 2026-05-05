import Foundation

public struct CreateRoomResponse: Codable {
    public let code: String
    public let mode: AppMode
    public let expiresAt: Int64
    public let token: String
}

public struct JoinRoomResponse: Codable {
    public let code: String
    public let role: UserRole
    public let mode: AppMode
    public let expiresAt: Int64
    public let token: String
}

public final class RoomService {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func createRoom(serverURL: URL, coachName: String, teamName: String, mode: AppMode) async throws -> CreateRoomResponse {
        var request = URLRequest(url: serverURL.appendingPathComponent("rooms"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.dugoutCall.encode([
            "coachName": coachName,
            "teamName": teamName,
            "mode": mode.rawValue
        ])

        let (data, _) = try await session.data(for: request)
        return try JSONDecoder.dugoutCall.decode(CreateRoomResponse.self, from: data)
    }

    public func joinRoom(serverURL: URL, code: String, role: UserRole, displayName: String) async throws -> JoinRoomResponse {
        var request = URLRequest(url: serverURL.appendingPathComponent("rooms/\(code)/join"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.dugoutCall.encode([
            "role": role.rawValue,
            "displayName": displayName
        ])

        let (data, _) = try await session.data(for: request)
        return try JSONDecoder.dugoutCall.decode(JoinRoomResponse.self, from: data)
    }
}
