import AVFoundation
import Combine
import Foundation

@MainActor
public final class AudioSessionService: ObservableObject {
    @Published public private(set) var routeState = AudioRouteState()

    private let session = AVAudioSession.sharedInstance()

    public init() {
        refreshRouteState()
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: session,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshRouteState() }
        }
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshRouteState() }
        }
    }

    public func configureForCoachPushToTalk() throws {
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP, .duckOthers])
        try session.setActive(true)
        refreshRouteState()
    }

    public func configureForCatcherPlayback() throws {
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true)
        refreshRouteState()
    }

    public func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            session.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    public func refreshRouteState() {
        let inputs = session.currentRoute.inputs.map(\.portName).joined(separator: ", ")
        let outputs = session.currentRoute.outputs.map(\.portName).joined(separator: ", ")
        let bluetoothOutputs: Set<AVAudioSession.Port> = [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE]
        let isBluetooth = session.currentRoute.outputs.contains { bluetoothOutputs.contains($0.portType) }
        let permission = session.recordPermission == .granted
        routeState = AudioRouteState(
            inputRoute: inputs.isEmpty ? "None" : inputs,
            outputRoute: outputs.isEmpty ? "None" : outputs,
            isBluetoothActive: isBluetooth,
            isMicrophonePermissionGranted: permission,
            isSpeechSynthesisReady: true
        )
    }
}
