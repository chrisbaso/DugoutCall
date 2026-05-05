import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

struct CreateRoomView: View {
    @ObservedObject var settings: SettingsStore
    @ObservedObject var webSocket: WebSocketService
    let onCreated: (CreateRoomResponse) -> Void

    @State private var isCreating = false
    @State private var response: CreateRoomResponse?
    @State private var error: String?

    private let roomService = RoomService()

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            VStack(spacing: 18) {
                Text("Create Game Room")
                    .font(.largeTitle.bold())
                Text("Game Mode is one-way only. The catcher receiver is listen-only after joining.")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                if let response {
                    Text(response.code)
                        .font(.system(size: 64, weight: .black, design: .monospaced))
                        .padding(.top)
                    QRCodeView(text: response.code)
                        .frame(width: 190, height: 190)
                    Text("Share this code or QR with the catcher.")
                        .foregroundStyle(.secondary)
                    Button("Enter Coach Dashboard") {
                        onCreated(response)
                    }
                    .primaryDugoutButton()
                } else {
                    Button(isCreating ? "Creating..." : "Create Room") {
                        Task { await createRoom() }
                    }
                    .primaryDugoutButton()
                    .disabled(isCreating)
                }

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

    private func createRoom() async {
        guard let url = URL(string: settings.serverURL) else {
            error = "Invalid server URL"
            return
        }
        isCreating = true
        defer { isCreating = false }
        do {
            let created = try await roomService.createRoom(
                serverURL: url,
                coachName: settings.coachName,
                teamName: settings.teamName,
                mode: settings.mode
            )
            response = created
            webSocket.connect(serverURL: url)
            try await webSocket.join(code: created.code, role: .coach, displayName: settings.coachName)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct QRCodeView: View {
    let text: String
    private let context = CIContext()
    private let filter = CIFilter.qrCodeGenerator()

    var body: some View {
        if let image = qrImage {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private var qrImage: UIImage? {
        filter.message = Data(text.utf8)
        guard let output = filter.outputImage,
              let cgImage = context.createCGImage(output.transformed(by: CGAffineTransform(scaleX: 8, y: 8)), from: output.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}
