import AVFoundation
import Combine
import Foundation

@MainActor
public final class SpeechPlaybackService: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published public private(set) var statusText = "Waiting for call"

    private let synthesizer = AVSpeechSynthesizer()
    private var queue: [PitchCall] = []
    private var lastStartedAt: Date?

    public var rate: Float = 0.48
    public var volume: Float = 1.0

    public override init() {
        super.init()
        synthesizer.delegate = self
    }

    public func play(_ call: PitchCall) {
        if let lastStartedAt, Date().timeIntervalSince(lastStartedAt) < 2 {
            queue.removeAll()
            synthesizer.stopSpeaking(at: .immediate)
        }

        queue.append(call)
        speakNextIfNeeded()
    }

    public func playTestAudio() {
        speak("DugoutCall connected.")
    }

    public func markReceivingVoice() {
        statusText = "Receiving voice"
    }

    public func markWaitingForCall() {
        statusText = "Waiting for call"
    }

    private func speakNextIfNeeded() {
        guard !synthesizer.isSpeaking, let next = queue.first else { return }
        queue.removeFirst()
        statusText = "Receiving voice"
        speak(next.spokenText)
    }

    private func speak(_ text: String) {
        lastStartedAt = Date()
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = rate
        utterance.volume = volume
        utterance.prefersAssistiveTechnologySettings = false
        synthesizer.speak(utterance)
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            statusText = "Waiting for call"
            speakNextIfNeeded()
        }
    }
}
