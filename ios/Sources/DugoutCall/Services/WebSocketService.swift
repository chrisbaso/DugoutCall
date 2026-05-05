import Combine
import Foundation

@MainActor
public final class WebSocketService: ObservableObject {
    @Published public private(set) var connectionState: ConnectionState = .idle
    @Published public private(set) var lastError: String?

    public var onMessage: ((DugoutMessage) -> Void)?

    private var task: URLSessionWebSocketTask?
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func connect(serverURL: URL) {
        disconnect()
        connectionState = .connecting
        let webSocketURL = serverURL.webSocketURL
        let task = session.webSocketTask(with: webSocketURL)
        self.task = task
        task.resume()
        connectionState = .connected
        receiveLoop()
    }

    public func join(code: String, role: UserRole, displayName: String? = nil) async throws {
        try await send(.joinRoom(code: code, role: role, displayName: displayName))
    }

    public func send(_ message: DugoutMessage) async throws {
        let data = try JSONEncoder.dugoutCall.encode(message)
        let string = String(decoding: data, as: UTF8.self)
        try await task?.send(.string(string))
    }

    public func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        if connectionState != .idle {
            connectionState = .disconnected
        }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receiveLoop()
                case .failure(let error):
                    self.lastError = error.localizedDescription
                    self.connectionState = .disconnected
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        do {
            let data: Data
            switch message {
            case .string(let string):
                data = Data(string.utf8)
            case .data(let messageData):
                data = messageData
            @unknown default:
                return
            }
            let decoded = try JSONDecoder.dugoutCall.decode(DugoutMessage.self, from: data)
            onMessage?(decoded)
        } catch {
            lastError = error.localizedDescription
        }
    }
}

private extension URL {
    var webSocketURL: URL {
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)
        components?.scheme = scheme == "https" ? "wss" : "ws"
        components?.path = ""
        return components?.url ?? self
    }
}
