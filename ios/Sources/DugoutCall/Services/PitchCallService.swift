import Combine
import Foundation

@MainActor
public final class PitchCallService: ObservableObject {
    public enum DeliveryState: Equatable {
        case idle
        /// Inside the accidental-call undo window; nothing has been sent yet.
        case pendingUndo(PitchCall)
        case sending(PitchCall)
        case delivered(PitchCall, at: Date)
        case failed(PitchCall, reason: String)
    }

    @Published public private(set) var lastCall: PitchCall?
    @Published public private(set) var queuedCall: PitchCall?
    @Published public private(set) var deliveryState: DeliveryState = .idle
    @Published public var isVoiceActive = false

    /// Accidental-call protection window for one-tap sends (presets, repeat).
    public var undoWindow: TimeInterval = 1.5
    /// How long to wait for the server's call_ack before declaring failure.
    public var ackTimeout: TimeInterval = 3

    private let sendMessage: (DugoutMessage) async throws -> Void
    private var undoTask: Task<Void, Never>?
    private var ackTimeoutTask: Task<Void, Never>?
    private var inFlightCallID: UUID?

    public init(sendMessage: @escaping (DugoutMessage) async throws -> Void) {
        self.sendMessage = sendMessage
    }

    public func send(pitch: PitchType, location: PitchLocation?) async {
        await send(call: PitchCall(pitch: pitch, location: location), undoable: false)
    }

    public func send(call: PitchCall, undoable: Bool = false) async {
        if isVoiceActive {
            queuedCall = call
            return
        }
        undoTask?.cancel()
        guard undoable else {
            await transmit(call)
            return
        }
        deliveryState = .pendingUndo(call)
        undoTask = Task { [weak self] in
            let window = self?.undoWindow ?? 1.5
            try? await Task.sleep(nanoseconds: UInt64(window * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            await self.transmit(call)
        }
    }

    public func cancelPending() {
        guard case .pendingUndo = deliveryState else { return }
        undoTask?.cancel()
        undoTask = nil
        deliveryState = .idle
    }

    public func repeatLast() async {
        guard let lastCall else { return }
        await send(call: lastCall.repeating(), undoable: true)
    }

    public func resendFailed() async {
        guard case .failed(let call, _) = deliveryState else { return }
        await send(call: call.repeating(), undoable: false)
    }

    public func flushQueuedCall() async {
        guard let queuedCall else { return }
        self.queuedCall = nil
        await send(call: queuedCall, undoable: false)
    }

    /// Routes the server's call_ack into delivered/failed state.
    public func handleAck(id: UUID, recipientCount: Int) {
        guard id == inFlightCallID, case .sending(let call) = deliveryState else { return }
        ackTimeoutTask?.cancel()
        inFlightCallID = nil
        if recipientCount >= 1 {
            deliveryState = .delivered(call, at: Date())
        } else {
            deliveryState = .failed(call, reason: "Catcher not connected")
        }
    }

    public func clearSelection() {}

    private func transmit(_ call: PitchCall) async {
        inFlightCallID = call.id
        deliveryState = .sending(call)
        do {
            try await sendMessage(.pitchCall(call))
            lastCall = call
            startAckTimeout(for: call)
        } catch {
            inFlightCallID = nil
            deliveryState = .failed(call, reason: error.localizedDescription)
        }
    }

    private func startAckTimeout(for call: PitchCall) {
        ackTimeoutTask?.cancel()
        ackTimeoutTask = Task { [weak self] in
            let timeout = self?.ackTimeout ?? 3
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            if self.inFlightCallID == call.id, case .sending = self.deliveryState {
                self.inFlightCallID = nil
                self.deliveryState = .failed(call, reason: "No delivery confirmation")
            }
        }
    }
}
