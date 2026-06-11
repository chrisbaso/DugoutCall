import Combine
import Foundation

@MainActor
public final class WebSocketService: NSObject, ObservableObject {
    public enum WebSocketError: LocalizedError {
        case notConnected

        public var errorDescription: String? { "Not connected to the room relay" }
    }

    @Published public private(set) var connectionState: ConnectionState = .idle
    @Published public private(set) var lastError: String?

    public var onMessage: ((DugoutMessage) -> Void)?

    /// Seconds between heartbeat probes while connected.
    public var heartbeatInterval: TimeInterval = 20
    /// Seconds to wait for the server's heartbeat echo before declaring the socket dead.
    public var heartbeatTimeout: TimeInterval = 10
    /// Reconnect backoff cap. Games run 2+ hours, so retries never give up.
    public var maxReconnectDelay: TimeInterval = 30

    private struct JoinContext {
        let serverURL: URL
        let code: String
        let role: UserRole
        let displayName: String?
        let token: String?
    }

    private lazy var session: URLSession = URLSession(
        configuration: .default,
        delegate: self,
        delegateQueue: .main
    )
    private var task: URLSessionWebSocketTask?
    private var joinContext: JoinContext?
    private var hasEverConnected = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var awaitingHeartbeatEcho = false
    // Invalidates receive-loop callbacks from torn-down tasks.
    private var generation = 0

    /// Connects, joins the room, and keeps both alive across network drops
    /// until `disconnect()` is called.
    public func start(serverURL: URL, code: String, role: UserRole, displayName: String?, token: String?) {
        joinContext = JoinContext(
            serverURL: serverURL,
            code: code,
            role: role,
            displayName: displayName,
            token: token
        )
        hasEverConnected = false
        reconnectAttempt = 0
        lastError = nil
        openSocket()
    }

    /// Skips any pending backoff and retries immediately (e.g. on returning to foreground).
    public func reconnectNow() {
        guard joinContext != nil, connectionState != .connected else { return }
        reconnectTask?.cancel()
        reconnectAttempt = 0
        openSocket()
    }

    public func send(_ message: DugoutMessage) async throws {
        guard let task, connectionState == .connected else {
            throw WebSocketError.notConnected
        }
        let data = try JSONEncoder.dugoutCall.encode(message)
        try await task.send(.string(String(decoding: data, as: UTF8.self)))
    }

    public func disconnect() {
        joinContext = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        teardownTask(closeCode: .goingAway)
        if connectionState != .idle {
            connectionState = .disconnected
        }
    }

    // MARK: - Connection lifecycle

    private func openSocket() {
        teardownTask(closeCode: .goingAway)
        guard let context = joinContext else { return }
        connectionState = hasEverConnected ? .reconnecting : .connecting
        generation += 1
        let task = session.webSocketTask(with: context.serverURL.webSocketURL)
        self.task = task
        task.resume()
        receiveLoop(task: task, generation: generation)
    }

    private func teardownTask(closeCode: URLSessionWebSocketTask.CloseCode) {
        stopHeartbeat()
        generation += 1
        let dying = task
        task = nil
        dying?.cancel(with: closeCode, reason: nil)
    }

    private func handleOpen(_ openedTask: URLSessionWebSocketTask) {
        guard openedTask === task, let context = joinContext else { return }
        connectionState = .connected
        hasEverConnected = true
        reconnectAttempt = 0
        lastError = nil
        Task {
            try? await self.send(.joinRoom(
                code: context.code,
                role: context.role,
                displayName: context.displayName,
                token: context.token
            ))
        }
        startHeartbeat()
    }

    private func handleConnectionLoss(reason: String?) {
        if let reason {
            lastError = reason
        }
        teardownTask(closeCode: .abnormalClosure)
        guard joinContext != nil else {
            connectionState = .disconnected
            return
        }
        connectionState = .reconnecting
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectTask?.cancel()
        let delay = min(maxReconnectDelay, pow(2.0, Double(reconnectAttempt)))
        let jitter = Double.random(in: 0...(delay * 0.2))
        reconnectAttempt += 1
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((delay + jitter) * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            self.openSocket()
        }
    }

    // MARK: - Heartbeats

    private func startHeartbeat() {
        stopHeartbeat()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval = self?.heartbeatInterval ?? 20
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard let self, !Task.isCancelled else { return }
                await self.probeHeartbeat()
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        awaitingHeartbeatEcho = false
    }

    private func probeHeartbeat() async {
        guard connectionState == .connected else { return }
        awaitingHeartbeatEcho = true
        try? await send(.heartbeat(timestamp: Int64(Date().timeIntervalSince1970 * 1000)))
        try? await Task.sleep(nanoseconds: UInt64(heartbeatTimeout * 1_000_000_000))
        guard !Task.isCancelled else { return }
        if awaitingHeartbeatEcho && connectionState == .connected {
            // Silent NAT timeout: the socket looks open but nothing comes back.
            handleConnectionLoss(reason: "Connection timed out")
        }
    }

    // MARK: - Receiving

    private func receiveLoop(task: URLSessionWebSocketTask, generation: Int) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, generation == self.generation else { return }
                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receiveLoop(task: task, generation: generation)
                case .failure(let error):
                    self.handleConnectionLoss(reason: error.localizedDescription)
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
            if case .heartbeat = decoded {
                awaitingHeartbeatEcho = false
                return
            }
            onMessage?(decoded)
        } catch {
            lastError = error.localizedDescription
        }
    }
}

extension WebSocketService: URLSessionWebSocketDelegate {
    public nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        Task { @MainActor in
            self.handleOpen(webSocketTask)
        }
    }

    public nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor in
            guard webSocketTask === self.task else { return }
            self.handleConnectionLoss(reason: "Connection closed")
        }
    }

    public nonisolated func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        Task { @MainActor in
            guard task === self.task else { return }
            self.handleConnectionLoss(reason: error?.localizedDescription)
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
