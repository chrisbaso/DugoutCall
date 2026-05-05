import Combine
import Foundation

@MainActor
public final class PushToTalkService: ObservableObject {
    @Published public private(set) var isTransmitting = false
    @Published public private(set) var lastError: String?

    private let audioSessionService: AudioSessionService
    private let sendMessage: (DugoutMessage) async throws -> Void

    public init(audioSessionService: AudioSessionService, sendMessage: @escaping (DugoutMessage) async throws -> Void) {
        self.audioSessionService = audioSessionService
        self.sendMessage = sendMessage
    }

    public func start() async {
        guard !isTransmitting else { return }
        do {
            try audioSessionService.configureForCoachPushToTalk()
            try await sendMessage(.pttStart(timestamp: Int64(Date().timeIntervalSince1970 * 1000)))
            isTransmitting = true
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func stop() async {
        guard isTransmitting else { return }
        do {
            try await sendMessage(.pttStop(timestamp: Int64(Date().timeIntervalSince1970 * 1000)))
        } catch {
            lastError = error.localizedDescription
        }
        isTransmitting = false
    }
}
