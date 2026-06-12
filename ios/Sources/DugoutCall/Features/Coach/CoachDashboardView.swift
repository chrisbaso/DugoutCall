import SwiftUI

struct CoachDashboardView: View {
    let room: Room
    @ObservedObject var settings: SettingsStore
    @ObservedObject var webSocket: WebSocketService
    let routeState: AudioRouteState
    @ObservedObject var pitchService: PitchCallService
    @ObservedObject var pushToTalk: PushToTalkService
    @ObservedObject var scouting: DiamondScoutLineupService

    @State private var selectedPitch: PitchType?
    @State private var selectedLocation: PitchLocation?
    @State private var selectedContext: String?

    private let contextButtons = ["0-0", "Ahead", "Behind", "2 Strikes", "Runner On"]

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HitterCardView(scouting: scouting)

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
        .toolbar {
            ToolbarItem(placement: .principal) {
                connectionStatus
            }
        }
        .task {
            await scouting.startGameSession()
        }
    }

    private var connectionStatus: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(connectionColor)
                .frame(width: 10, height: 10)
                .accessibilityLabel("Connection \(webSocket.connectionState.rawValue)")
            Text("Room \(room.code) · \(room.mode.label)")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
            Image(systemName: "airpodspro")
                .font(.caption)
                .foregroundStyle(routeState.isBluetoothActive ? Color.green : Color.secondary)
                .accessibilityLabel(routeState.airPodsStatusText)
            if pushToTalk.isTransmitting {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.caption)
                    .foregroundStyle(DugoutTheme.warning)
                    .accessibilityLabel("Live voice transmitting")
            }
        }
    }

    private var connectionColor: Color {
        switch webSocket.connectionState {
        case .connected:
            return .green
        case .connecting:
            return DugoutTheme.warning
        case .idle, .disconnected:
            return DugoutTheme.accent
        }
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
