import SwiftUI

struct CatcherReceiverView: View {
    let room: Room
    @ObservedObject var webSocket: WebSocketService
    let routeState: AudioRouteState
    @ObservedObject var speech: SpeechPlaybackService
    @ObservedObject var audioSession: AudioSessionService
    let voiceStatus: String
    let showReconnectNotice: Bool
    let disconnect: () -> Void

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            VStack(spacing: 24) {
                if showReconnectNotice {
                    Text("Reconnected — calls during the gap were missed")
                        .font(.headline.bold())
                        .foregroundStyle(.black)
                        .padding(10)
                        .frame(maxWidth: .infinity)
                        .background(DugoutTheme.warning)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Text(statusText)
                    .font(.system(size: 42, weight: .black, design: .rounded))
                    .multilineTextAlignment(.center)
                Text(routeState.airPodsStatusText)
                    .font(.title2.bold())
                    .foregroundStyle(routeState.isBluetoothActive ? .green : DugoutTheme.warning)
                Text(voiceStatus)
                    .font(.headline)
                    .foregroundStyle(.white)
                Text("Room \(room.code) - \(room.mode.label)")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text("Keep this screen on during the game — lower brightness to save battery.")
                    .font(.footnote.bold())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Text("Use only where permitted by your league/state association. Game Mode is designed for one-way coach-to-catcher communication.")
                    .font(.footnote.bold())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                if room.mode != .game {
                    Button("Play test audio") {
                        speech.playTestAudio()
                    }
                    .primaryDugoutButton()
                }

                Button(role: .destructive) {
                    disconnect()
                } label: {
                    Label("Emergency Disconnect", systemImage: "phone.down.fill")
                }
                .ruggedTile()
            }
            .padding()
            .foregroundStyle(.white)
        }
        .navigationBarBackButtonHidden()
        .task {
            try? audioSession.configureForCatcherPlayback()
            if room.mode == .game {
                speech.playTestAudio()
            }
        }
    }

    private var statusText: String {
        switch webSocket.connectionState {
        case .connected:
            return speech.statusText
        case .connecting:
            return "Connecting"
        case .reconnecting:
            return "Reconnecting"
        case .idle:
            return "Waiting for call"
        case .disconnected:
            return "Disconnected"
        }
    }
}
