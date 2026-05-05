import Combine
import Foundation

@MainActor
public final class PitchCallService: ObservableObject {
    @Published public private(set) var lastCall: PitchCall?
    @Published public private(set) var queuedCall: PitchCall?
    @Published public var isVoiceActive = false

    private let sendMessage: (DugoutMessage) async throws -> Void

    public init(sendMessage: @escaping (DugoutMessage) async throws -> Void) {
        self.sendMessage = sendMessage
    }

    public func send(pitch: PitchType, location: PitchLocation?) async throws {
        try await send(call: PitchCall(pitch: pitch, location: location))
    }

    public func send(call: PitchCall) async throws {
        if isVoiceActive {
            queuedCall = call
            return
        }
        try await sendMessage(.pitchCall(call))
        lastCall = call
    }

    public func repeatLast() async throws {
        guard let lastCall else { return }
        try await send(call: lastCall.repeating())
    }

    public func flushQueuedCall() async throws {
        guard let queuedCall else { return }
        self.queuedCall = nil
        try await send(call: queuedCall)
    }

    public func clearSelection() {}
}
