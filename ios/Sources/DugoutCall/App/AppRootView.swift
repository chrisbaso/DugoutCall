import SwiftUI

struct AppRootView: View {
    @StateObject private var settings: SettingsStore
    @StateObject private var webSocket: WebSocketService
    @StateObject private var audioSession: AudioSessionService
    @StateObject private var routeMonitor: AudioRouteMonitor
    @StateObject private var speech: SpeechPlaybackService
    @StateObject private var pitchService: PitchCallService
    @StateObject private var pushToTalk: PushToTalkService

    @State private var role: UserRole?
    @State private var room: Room?
    @State private var showSettings = false
    @State private var showDiamondScout = false

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
                if showDiamondScout {
                    DiamondScoutHomeView(settings: settings) {
                        showDiamondScout = false
                    }
                } else if let role, let room {
                    switch role {
                    case .coach:
                        CoachDashboardView(
                            room: room,
                            settings: settings,
                            webSocket: webSocket,
                            routeState: routeMonitor.state,
                            pitchService: pitchService,
                            pushToTalk: pushToTalk
                        )
                    case .catcher:
                        CatcherReceiverView(
                            room: room,
                            webSocket: webSocket,
                            routeState: routeMonitor.state,
                            speech: speech,
                            audioSession: audioSession
                        ) {
                            self.role = nil
                            self.room = nil
                            webSocket.disconnect()
                        }
                    }
                } else if role == .coach {
                    CreateRoomView(settings: settings, webSocket: webSocket) { response in
                        room = Room(code: response.code, mode: response.mode, expiresAt: response.expiresAt, token: response.token)
                    }
                } else if role == .catcher {
                    JoinRoomView(settings: settings, webSocket: webSocket) { response in
                        room = Room(code: response.code, mode: response.mode, expiresAt: response.expiresAt, token: response.token)
                    }
                } else {
                    RoleSelectionView(
                        onSelect: { selectedRole in
                            role = selectedRole
                        },
                        onDiamondScout: {
                            showDiamondScout = true
                        }
                    )
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
        }
    }

    private func handleMessage(_ message: DugoutMessage) {
        switch message {
        case .pitchCall(let call):
            speech.rate = Float(settings.speechRate)
            speech.volume = Float(settings.speechVolume)
            speech.play(call)
        case .pttStart(_):
            speech.markReceivingVoice()
        case .pttStop(_):
            speech.markWaitingForCall()
            Task { try? await pitchService.flushQueuedCall() }
        case .error(let message):
            print("DugoutCall error: \(message)")
        default:
            break
        }
    }
}
