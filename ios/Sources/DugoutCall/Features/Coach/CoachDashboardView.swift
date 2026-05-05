import SwiftUI

struct CoachDashboardView: View {
    let room: Room
    @ObservedObject var settings: SettingsStore
    @ObservedObject var webSocket: WebSocketService
    let routeState: AudioRouteState
    @ObservedObject var pitchService: PitchCallService
    @ObservedObject var pushToTalk: PushToTalkService

    @State private var selectedPitch: PitchType?
    @State private var selectedLocation: PitchLocation?
    @State private var selectedContext: String?

    private let contextButtons = ["0-0", "Ahead", "Behind", "2 Strikes", "Runner On"]

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ConnectionBannerView(
                        room: room,
                        connectionState: webSocket.connectionState,
                        routeState: routeState,
                        isTalking: pushToTalk.isTransmitting
                    )

                    PresetGridView(presets: settings.presets) { preset in
                        Task {
                            try? await pitchService.send(call: preset.pitchCall)
                        }
                    }

                    PitchGridView(selectedPitch: $selectedPitch)
                    LocationGridView(selectedLocation: $selectedLocation)

                    SectionHeader("Count / Context")
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(contextButtons, id: \.self) { label in
                            Button(label) {
                                selectedContext = selectedContext == label ? nil : label
                            }
                            .ruggedTile(isSelected: selectedContext == label)
                        }
                    }

                    actionRow
                }
                .padding()
            }
        }
        .navigationBarBackButtonHidden()
    }

    private var actionRow: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    Task { await sendSelection() }
                } label: {
                    Label("Send", systemImage: "paperplane.fill")
                }
                .primaryDugoutButton()
                .disabled(pushToTalk.isTransmitting || selectedPitch == nil)

                Button {
                    Task { try? await pitchService.repeatLast() }
                } label: {
                    Label("Repeat Last", systemImage: "repeat")
                }
                .ruggedTile()
            }

            HStack(spacing: 10) {
                Button {
                    selectedPitch = nil
                    selectedLocation = nil
                    selectedContext = nil
                } label: {
                    Label("Clear", systemImage: "xmark.circle.fill")
                }
                .ruggedTile()

                PushToTalkButton(pushToTalk: pushToTalk, pitchService: pitchService)
            }
        }
    }

    private func sendSelection() async {
        guard let selectedPitch else { return }
        try? await pitchService.send(pitch: selectedPitch, location: selectedLocation)
    }
}

private struct ConnectionBannerView: View {
    let room: Room
    let connectionState: ConnectionState
    let routeState: AudioRouteState
    let isTalking: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Room \(room.code)")
                    .font(.title2.bold())
                Spacer()
                Text(room.mode.label)
                    .font(.headline.bold())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(DugoutTheme.grass)
                    .clipShape(Capsule())
            }
            HStack {
                Label(connectionState.rawValue.capitalized, systemImage: "network")
                Spacer()
                Label(routeState.airPodsStatusText, systemImage: "airpodspro")
            }
            Text(isTalking ? "Live voice transmitting" : "Catcher connected")
                .font(.headline)
                .foregroundStyle(isTalking ? DugoutTheme.warning : .secondary)
        }
        .padding()
        .background(DugoutTheme.panel)
        .foregroundStyle(.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct SectionHeader: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title.uppercased())
            .font(.caption.bold())
            .foregroundStyle(.secondary)
    }
}
