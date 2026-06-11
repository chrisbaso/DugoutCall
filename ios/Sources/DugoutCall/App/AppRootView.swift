import SwiftUI
import UIKit

struct AppRootView: View {
    @Environment(\.scenePhase) private var scenePhase

    @StateObject private var settings: SettingsStore
    @StateObject private var webSocket: WebSocketService
    @StateObject private var audioSession: AudioSessionService
    @StateObject private var routeMonitor: AudioRouteMonitor
    @StateObject private var speech: SpeechPlaybackService
    @StateObject private var pitchService: PitchCallService
    @StateObject private var pushToTalk: PushToTalkService
    @StateObject private var voiceTransport = LiveKitAudioTransport()

    @State private var role: UserRole?
    @State private var room: Room?
    @State private var livekitCredentials: LiveKitVoiceCredentials?
    @State private var catcherConnected = false
    @State private var serverNotice: String?
    @State private var showCatcherReconnectNotice = false
    @State private var showSettings = false

    init() {
        let settings = SettingsStore()
        let webSocket = WebSocketService()
        let audioSession = AudioSessionService()
        _settings = StateObject(wrappedValue: settings)
        _webSocket = StateObject(wrappedValue: webSocket)
        _audioSession = StateObject(wrappedValue: audioSession)
        _routeMonitor = StateObject(wrappedValue: AudioRouteMonitor(audioSessionService: audioSession))
        _speech = StateObject(wrappedValue: SpeechPlaybackService())
        _pitchService = StateObject(wrappedValue: PitchCallService { message in
            try await webSocket.send(message)
        })
        _pushToTalk = StateObject(wrappedValue: PushToTalkService(audioSessionService: audioSession) { message in
            try await webSocket.send(message)
        })
    }

    var body: some View {
        NavigationStack {
            Group {
                if let role, let room {
                    switch role {
                    case .coach:
                        CoachDashboardView(
                            room: room,
                            settings: settings,
                            webSocket: webSocket,
                            routeState: routeMonitor.state,
                            pitchService: pitchService,
                            pushToTalk: pushToTalk,
                            catcherConnected: catcherConnected,
                            voiceStatus: voiceTransport.statusText,
                            serverNotice: serverNotice,
                            onLeave: leaveRoom
                        )
                    case .catcher:
                        CatcherReceiverView(
                            room: room,
                            webSocket: webSocket,
                            routeState: routeMonitor.state,
                            speech: speech,
                            audioSession: audioSession,
                            voiceStatus: voiceTransport.statusText,
                            showReconnectNotice: showCatcherReconnectNotice,
                            disconnect: leaveRoom
                        )
                    }
                } else if role == .coach {
                    CreateRoomView(settings: settings, webSocket: webSocket) { response in
                        livekitCredentials = response.livekit
                        room = Room(code: response.code, mode: response.mode, expiresAt: response.expiresAt, token: response.token)
                    }
                } else if role == .catcher {
                    JoinRoomView(settings: settings, webSocket: webSocket) { response in
                        livekitCredentials = response.livekit
                        room = Room(code: response.code, mode: response.mode, expiresAt: response.expiresAt, token: response.token)
                    }
                } else {
                    RoleSelectionView { selectedRole in
                        role = selectedRole
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape.fill")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(settings: settings)
            }
        }
        .tint(.white)
        .onAppear {
            webSocket.onMessage = handleMessage
            pushToTalk.voiceTransport = voiceTransport
            pushToTalk.onVoiceActiveChanged = { [weak pitchService] active in
                pitchService?.isVoiceActive = active
                if !active {
                    Task { await pitchService?.flushQueuedCall() }
                }
            }
        }
        .onChange(of: room) { _, newRoom in
            // Keep the screen awake for the whole game so iOS never suspends
            // the receiver mid-session; restore normal auto-lock on leave.
            UIApplication.shared.isIdleTimerDisabled = newRoom != nil
            if newRoom != nil, let credentials = livekitCredentials, let role {
                Task { await voiceTransport.connect(credentials: credentials, role: role) }
            } else if newRoom == nil {
                Task { await voiceTransport.disconnect() }
            }
        }
        .onChange(of: webSocket.connectionState) { oldState, newState in
            if newState != .connected {
                pushToTalk.forceStop()
            }
            if newState == .connected,
               oldState == .reconnecting || oldState == .disconnected,
               role == .catcher {
                showCatcherReconnectNotice = true
                Task {
                    try? await Task.sleep(nanoseconds: 6_000_000_000)
                    showCatcherReconnectNotice = false
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, room != nil else { return }
            // Returning to foreground: the socket may have died while suspended.
            webSocket.reconnectNow()
            audioSession.refreshRouteState()
        }
    }

    private func leaveRoom() {
        role = nil
        room = nil
        livekitCredentials = nil
        catcherConnected = false
        serverNotice = nil
        webSocket.disconnect()
        Task { await voiceTransport.disconnect() }
    }

    private func handleMessage(_ message: DugoutMessage) {
        switch message {
        case .pitchCall(let call):
            speech.rate = Float(settings.speechRate)
            speech.volume = Float(settings.speechVolume)
            speech.play(call)
        case .callAck(let id, let recipientCount, _):
            if let uuid = UUID(uuidString: id) {
                pitchService.handleAck(id: uuid, recipientCount: recipientCount)
            }
        case .peerStatus(let peerRole, let connected):
            if peerRole == .catcher {
                catcherConnected = connected
            }
        case .pttStart:
            speech.markReceivingVoice()
        case .pttStop:
            speech.markWaitingForCall()
        case .roomClosed(let reason):
            serverNotice = "Room closed: \(reason)"
            catcherConnected = false
        case .error(let message):
            serverNotice = message
        default:
            break
        }
    }
}
