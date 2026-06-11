import Foundation

public struct CreateRoomResponse: Codable {
    public let code: String
    public let mode: AppMode
    public let expiresAt: Int64
    public let token: String
    public let livekit: LiveKitVoiceCredentials?
}

public struct JoinRoomResponse: Codable {
    public let code: String
    public let role: UserRole
    public let mode: AppMode
    public let expiresAt: Int64
    public let token: String
    public let livekit: LiveKitVoiceCredentials?
}

public enum RoomServiceError: LocalizedError, Equatable {
    /// The server answered with an error body, e.g. "Room not found".
    case server(message: String, status: Int)
    /// A 2xx response whose body could not be decoded.
    case invalidResponse
    /// Transport-level failure (offline, timeout, DNS).
    case network(description: String)

    public var errorDescription: String? {
        switch self {
        case .server(let message, _):
            return message
        case .invalidResponse:
            return "Unexpected response from server"
        case .network(let description):
            return description
        }
    }
}

public final class RoomService {
    private let session: URLSession
    /// Mirrors the Expo client's wake-the-free-tier backoff.
    private let retryDelays: [TimeInterval]

    public init(session: URLSession = .shared, retryDelays: [TimeInterval] = [0, 1.2, 2.5, 5]) {
        self.session = session
        self.retryDelays = retryDelays
    }

    public func createRoom(
        serverURL: URL,
        coachName: String,
        teamName: String,
        mode: AppMode,
        progress: (@MainActor @Sendable (String) -> Void)? = nil
    ) async throws -> CreateRoomResponse {
        var request = URLRequest(url: serverURL.appendingPathComponent("rooms"))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.dugoutCall.encode([
            "coachName": coachName,
            "teamName": teamName,
            "mode": mode.rawValue
        ])
        return try await perform(request, progress: progress)
    }

    public func joinRoom(
        serverURL: URL,
        code: String,
        role: UserRole,
        displayName: String,
        bearerToken: String? = nil,
        progress: (@MainActor @Sendable (String) -> Void)? = nil
    ) async throws -> JoinRoomResponse {
        var request = URLRequest(url: serverURL.appendingPathComponent("rooms/\(code)/join"))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearerToken {
            // Lets the relay resurrect the room after a restart mid-game.
            request.addValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder.dugoutCall.encode([
            "role": role.rawValue,
            "displayName": displayName
        ])
        return try await perform(request, progress: progress)
    }

    // MARK: - Transport

    private struct ErrorBody: Decodable {
        let error: String
    }

    private func perform<T: Decodable>(
        _ request: URLRequest,
        progress: (@MainActor @Sendable (String) -> Void)?
    ) async throws -> T {
        var lastError: RoomServiceError = .network(description: "Network request failed")
        for delay in retryDelays {
            if delay > 0 {
                if let progress {
                    await progress("Waking server...")
                }
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            do {
                return try await attempt(request)
            } catch let error as RoomServiceError {
                switch error {
                case .server(_, let status) where status >= 500:
                    lastError = error
                case .network:
                    lastError = error
                default:
                    // 4xx and undecodable success bodies are not transient.
                    throw error
                }
            }
        }
        throw lastError
    }

    private func attempt<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw RoomServiceError.network(description: error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw RoomServiceError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder.dugoutCall.decode(ErrorBody.self, from: data))?.error
            throw RoomServiceError.server(
                message: message ?? "Server returned \(http.statusCode)",
                status: http.statusCode
            )
        }
        guard let decoded = try? JSONDecoder.dugoutCall.decode(T.self, from: data) else {
            throw RoomServiceError.invalidResponse
        }
        return decoded
    }
}
