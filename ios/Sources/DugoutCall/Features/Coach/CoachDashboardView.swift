import SwiftUI
import UIKit

struct CoachDashboardView: View {
    let room: Room
    @ObservedObject var settings: SettingsStore
    @ObservedObject var webSocket: WebSocketService
    let routeState: AudioRouteState
    @ObservedObject var pitchService: PitchCallService
    @ObservedObject var pushToTalk: PushToTalkService
    let catcherConnected: Bool
    let voiceStatus: String
    let serverNotice: String?
    let onLeave: () -> Void

    @State private var selectedPitch: PitchType?
    @State private var selectedLocation: PitchLocation?
    @State private var selectedContext: String?
    @State private var contextExpanded = false
    @State private var showLeaveConfirmation = false

    private let contextButtons = ["0-0", "Ahead", "Behind", "2 Strikes", "Runner On"]

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ConnectionBannerView(
                        room: room,
                        connectionState: webSocket.connectionState,
                        catcherConnected: catcherConnected,
                        routeState: routeState,
                        isTalking: pushToTalk.isTransmitting,
                        voiceStatus: voiceStatus
                    )

                    if let notice = serverNotice ?? webSocket.lastError {
                        Text(notice)
                            .font(.headline.bold())
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(DugoutTheme.warning.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    PresetGridView(presets: settings.presets) { preset in
                        Task {
                            await pitchService.send(call: preset.pitchCall, undoable: true)
                        }
                    }

                    PitchGridView(selectedPitch: $selectedPitch)
                    LocationGridView(selectedLocation: $selectedLocation)

                    DisclosureGroup(isExpanded: $contextExpanded) {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                            ForEach(contextButtons, id: \.self) { label in
                                Button(label) {
                                    selectedContext = selectedContext == label ? nil : label
                                }
                                .ruggedTile(isSelected: selectedContext == label)
                            }
                        }
                        .padding(.top, 8)
                    } label: {
                        SectionHeader("Count / Context")
                    }
                    .tint(.white)
                }
                .padding()
            }
        }
        .safeAreaInset(edge: .bottom) {
            actionBar
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Leave") {
                    showLeaveConfirmation = true
                }
                .foregroundStyle(.white)
            }
        }
        .confirmationDialog("Leave this room?", isPresented: $showLeaveConfirmation, titleVisibility: .visible) {
            Button("Leave Room", role: .destructive, action: onLeave)
            Button("Stay", role: .cancel) {}
        } message: {
            Text("The catcher will lose the connection. You will need a new room code to re-pair.")
        }
        .onChange(of: pitchService.deliveryState) { _, newState in
            let haptics = UINotificationFeedbackGenerator()
            switch newState {
            case .delivered:
                haptics.notificationOccurred(.success)
            case .failed:
                haptics.notificationOccurred(.error)
            default:
                break
            }
        }
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            deliveryStatusStrip

            HStack(spacing: 10) {
                Button {
                    Task { await sendSelection() }
                } label: {
                    Label("Send", systemImage: "paperplane.fill")
                }
                .primaryDugoutButton()
                .disabled(pushToTalk.isTransmitting || selectedPitch == nil)

                Button {
                    Task { await pitchService.repeatLast() }
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

                PushToTalkButton(pushToTalk: pushToTalk)
            }
        }
        .padding(.horizontal)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(DugoutTheme.panel)
    }

    @ViewBuilder
    private var deliveryStatusStrip: some View {
        switch pitchService.deliveryState {
        case .idle:
            EmptyView()
        case .pendingUndo(let call):
            HStack {
                Text("Sending: \(call.spokenText)")
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                Spacer()
                Button("CANCEL") {
                    pitchService.cancelPending()
                }
                .font(.title3.bold())
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(DugoutTheme.warning)
                .foregroundStyle(.black)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        case .sending(let call):
            Text("Sending \(call.spokenText)…")
                .font(.title3.bold())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .delivered(let call, let at):
            Label("Delivered \(call.spokenText) \(at.formatted(date: .omitted, time: .standard))", systemImage: "checkmark.circle.fill")
                .font(.title3.bold())
                .foregroundStyle(.green)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .failed(let call, let reason):
            HStack {
                Label("NOT DELIVERED: \(call.spokenText) — \(reason)", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                Spacer()
                Button("Resend") {
                    Task { await pitchService.resendFailed() }
                }
                .font(.headline.bold())
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.white)
                .foregroundStyle(DugoutTheme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(8)
            .background(DugoutTheme.accent)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private func sendSelection() async {
        guard let selectedPitch else { return }
        await pitchService.send(pitch: selectedPitch, location: selectedLocation)
    }
}

private struct ConnectionBannerView: View {
    let room: Room
    let connectionState: ConnectionState
    let catcherConnected: Bool
    let routeState: AudioRouteState
    let isTalking: Bool
    let voiceStatus: String

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
            Text(statusText)
                .font(.title3.bold())
                .foregroundStyle(statusColor)
            Text(voiceStatus)
                .font(.headline)
                .foregroundStyle(.white)
        }
        .padding()
        .background(DugoutTheme.panel)
        .foregroundStyle(.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var statusText: String {
        if isTalking { return "Live voice transmitting" }
        switch connectionState {
        case .connected:
            return catcherConnected ? "Catcher connected" : "Waiting for catcher"
        case .reconnecting:
            return "Reconnecting…"
        case .connecting:
            return "Connecting…"
        case .disconnected:
            return "Disconnected"
        case .idle:
            return "Not connected"
        }
    }

    private var statusColor: Color {
        if isTalking { return DugoutTheme.warning }
        switch connectionState {
        case .connected:
            return catcherConnected ? .green : DugoutTheme.warning
        default:
            return DugoutTheme.warning
        }
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
            .foregroundStyle(.white.opacity(0.7))
    }
}
