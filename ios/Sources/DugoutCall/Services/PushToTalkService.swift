import Combine
import Foundation

@MainActor
public final class PushToTalkService: ObservableObject {
    @Published public private(set) var isTransmitting = false
    @Published public private(set) var lastError: String?

    /// Optional live-voice transport (LiveKit). PTT signals are sent regardless,
    /// so the catcher status UI works even when voice is unavailable.
    public var voiceTransport: LiveAudioTransport?
    public var onVoiceActiveChanged: ((Bool) -> Void)?

    private let audioSessionService: AudioSessionService
    private let sendMessage: (DugoutMessage) async throws -> Void

    // Desired-state reconciliation: press/release set the desired state and
    // enqueue a sync. The serialized queue guarantees a release that arrives
    // while a start is still in flight always results in a stop — the
    // "stuck transmitting" race cannot occur.
    private var desiredTransmitting = false
    private var serialTask: Task<Void, Never>?

    public init(audioSessionService: AudioSessionService, sendMessage: @escaping (DugoutMessage) async throws -> Void) {
        self.audioSessionService = audioSessionService
        self.sendMessage = sendMessage
    }

    public func pressBegan() {
        desiredTransmitting = true
        onVoiceActiveChanged?(true)
        enqueueReconcile()
    }

    public func pressEnded() {
        desiredTransmitting = false
        onVoiceActiveChanged?(false)
        enqueueReconcile()
    }

    /// Safety hatch: ends transmission regardless of gesture state
    /// (e.g. when the room socket drops mid-press).
    public func forceStop() {
        guard desiredTransmitting || isTransmitting else { return }
        desiredTransmitting = false
        onVoiceActiveChanged?(false)
        enqueueReconcile()
    }

    private func enqueueReconcile() {
        let previous = serialTask
        serialTask = Task { [weak self] in
            await previous?.value
            await self?.reconcile()
        }
    }

    private func reconcile() async {
        if desiredTransmitting && !isTransmitting {
            do {
                try audioSessionService.configureForCoachPushToTalk()
                await voiceTransport?.setMicrophoneEnabled(true)
                try await sendMessage(.pttStart(timestamp: Int64(Date().timeIntervalSince1970 * 1000)))
                isTransmitting = true
                lastError = nil
            } catch {
                lastError = error.localizedDescription
                desiredTransmitting = false
                await voiceTransport?.setMicrophoneEnabled(false)
            }
        } else if !desiredTransmitting && isTransmitting {
            await voiceTransport?.setMicrophoneEnabled(false)
            do {
                try await sendMessage(.pttStop(timestamp: Int64(Date().timeIntervalSince1970 * 1000)))
            } catch {
                lastError = error.localizedDescription
            }
            isTransmitting = false
        }
    }
}
