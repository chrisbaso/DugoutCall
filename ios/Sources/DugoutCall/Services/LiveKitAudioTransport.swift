import Combine
import Foundation
import LiveKit

/// LiveKit-backed implementation of `LiveAudioTransport`.
///
/// Mirrors the settings proven in the Expo build: the coach connects with the
/// microphone disabled and only unmutes while push-to-talk is held; the
/// catcher subscribes and plays through the system audio route (AirPods when
/// connected). Reconnection during drops is handled by the LiveKit SDK.
@MainActor
public final class LiveKitAudioTransport: ObservableObject, LiveAudioTransport {
    @Published public private(set) var statusText = "Live voice idle"
    @Published public private(set) var isConnected = false

    private var room: LiveKit.Room?
    private var role: UserRole = .coach

    public init() {}

    public func connect(credentials: LiveKitVoiceCredentials, role: UserRole) async {
        await disconnect()
        self.role = role
        guard URL(string: credentials.serverUrl) != nil else {
            statusText = "Live voice unavailable"
            return
        }

        let room = LiveKit.Room()
        room.add(delegate: self)
        self.room = room
        statusText = "Connecting live voice..."
        do {
            try await room.connect(url: credentials.serverUrl, token: credentials.token)
            if role == .coach {
                try await room.localParticipant.setMicrophone(enabled: false)
            }
            isConnected = true
            statusText = readyStatusText()
        } catch {
            self.room = nil
            isConnected = false
            statusText = "Live voice unavailable"
        }
    }

    public func setMicrophoneEnabled(_ enabled: Bool) async {
        guard role == .coach, let room, isConnected else { return }
        do {
            try await room.localParticipant.setMicrophone(enabled: enabled)
            statusText = enabled ? "Transmitting voice" : readyStatusText()
        } catch {
            statusText = "Microphone unavailable"
        }
    }

    public func disconnect() async {
        if let room {
            await room.disconnect()
        }
        room = nil
        isConnected = false
        statusText = "Live voice idle"
    }

    private func readyStatusText() -> String {
        role == .coach ? "Live voice ready" : "Listening for coach voice"
    }
}

extension LiveKitAudioTransport: RoomDelegate {
    public nonisolated func room(
        _ room: LiveKit.Room,
        didUpdateConnectionState connectionState: LiveKit.ConnectionState,
        from oldValue: LiveKit.ConnectionState
    ) {
        Task { @MainActor in
            guard room === self.room else { return }
            switch connectionState {
            case .connected:
                self.isConnected = true
                self.statusText = self.readyStatusText()
            case .reconnecting:
                self.statusText = "Live voice reconnecting..."
            case .connecting:
                self.statusText = "Connecting live voice..."
            case .disconnected:
                self.isConnected = false
                self.statusText = "Live voice disconnected"
            default:
                break
            }
        }
    }
}
