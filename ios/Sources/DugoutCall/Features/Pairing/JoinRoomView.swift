import SwiftUI

struct JoinRoomView: View {
    @ObservedObject var settings: SettingsStore
    @ObservedObject var webSocket: WebSocketService
    let onJoined: (JoinRoomResponse) -> Void

    @State private var code = ""
    @State private var isJoining = false
    @State private var progressText: String?
    @State private var error: String?

    private let roomService = RoomService()

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            VStack(spacing: 20) {
                Text("Join as Catcher")
                    .font(.largeTitle.bold())
                Text("After joining Game Mode, this device is locked to listen-only receiving.")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                TextField("6-digit code", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .font(.system(size: 38, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .padding()
                    .background(.white)
                    .foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .onChange(of: code) { _, newValue in
                        code = String(newValue.filter(\.isNumber).prefix(6))
                    }

                Button(isJoining ? (progressText ?? "Joining...") : "Join Room") {
                    Task { await joinRoom() }
                }
                .primaryDugoutButton()
                .disabled(code.count != 6 || isJoining)

                if let error {
                    Text(error)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .foregroundStyle(.white)
            .padding()
        }
    }

    private func joinRoom() async {
        guard let url = URL(string: settings.serverURL) else {
            error = "Invalid server URL"
            return
        }
        isJoining = true
        error = nil
        defer {
            isJoining = false
            progressText = nil
        }
        do {
            let joined = try await roomService.joinRoom(
                serverURL: url,
                code: code,
                role: .catcher,
                displayName: "Catcher",
                progress: { status in progressText = status }
            )
            webSocket.start(
                serverURL: url,
                code: joined.code,
                role: .catcher,
                displayName: "Catcher",
                token: joined.token
            )
            onJoined(joined)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
