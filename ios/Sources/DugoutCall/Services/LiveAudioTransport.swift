import Foundation

/// One-way live-voice media transport. The relay WebSocket carries only
/// signaling (`ptt_start`/`ptt_stop`); implementations of this protocol
/// carry the actual audio (LiveKit in production).
@MainActor
public protocol LiveAudioTransport: AnyObject {
    var statusText: String { get }
    var isConnected: Bool { get }

    /// Connects to the voice room. Coach connects muted; catcher connects
    /// subscribe-only (the server-issued token enforces this regardless).
    func connect(credentials: LiveKitVoiceCredentials, role: UserRole) async

    /// Coach push-to-talk: enables/disables the local microphone track.
    /// No-op for the catcher role.
    func setMicrophoneEnabled(_ enabled: Bool) async

    func disconnect() async
}
