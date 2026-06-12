import SwiftUI

/// Ambient scouting card pinned above the pitch grid. Updates passively as the
/// coach advances batters; never blocks or interrupts pitch calling.
struct HitterCardView: View {
    @ObservedObject var scouting: DiamondScoutLineupService

    @State private var reportHitter: DiamondScoutHitterSummary?

    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .frame(height: 110)
            .background(DugoutTheme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .topTrailing) {
                if scouting.state == .loaded, scouting.client.usesMockData {
                    MockDataBadge()
                        .padding(.top, 6)
                        .padding(.trailing, 64)
                }
            }
            .sheet(item: $reportHitter) { summary in
                reportSheet(summary)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch scouting.state {
        case .idle, .loading:
            HitterCardSkeleton()
        case .unavailable:
            noDataRow(title: "No scouting data", subtitle: "Pitch calling unaffected")
        case .loaded:
            if let summary = scouting.currentSummary {
                loadedRow(summary)
            } else {
                noDataRow(title: "No scouting data", subtitle: "Pitch calling unaffected")
            }
        }
    }

    private func loadedRow(_ summary: DiamondScoutHitterSummary) -> some View {
        HStack(spacing: 0) {
            Button {
                reportHitter = summary
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(identityLine(summary))
                            .font(.headline.bold())
                            .lineLimit(1)
                        if summary.hasScoutingData {
                            Text(summary.verdict ?? "No verdict on file")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                            HStack(spacing: 6) {
                                ForEach(summary.attackTags.prefix(3), id: \.self) { tag in
                                    Text(tag)
                                        .font(.caption2.bold())
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(DugoutTheme.grass)
                                        .clipShape(Capsule())
                                }
                            }
                        } else {
                            Text("No scouting data")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    if let heat = summary.zoneHeat {
                        VStack(spacing: 2) {
                            HeatFanView(heat: heat)
                                .frame(width: 86, height: 58)
                            if heat.lowSample {
                                Text("Low sample")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open full scouting report for \(summary.hitter.displayName)")

            Button {
                scouting.advanceToNextBatter()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title2)
                    Text("Next")
                        .font(.caption2.bold())
                }
                .frame(width: 52)
                .frame(maxHeight: .infinity)
                .background(DugoutTheme.grass.opacity(0.4))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Next batter")
        }
        .foregroundStyle(.white)
    }

    private func noDataRow(title: String, subtitle: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "binoculars")
                .font(.title2)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(12)
    }

    private func identityLine(_ summary: DiamondScoutHitterSummary) -> String {
        if let bats = summary.hitter.bats, !bats.isEmpty {
            return "\(summary.hitter.displayName) · Bats \(bats)"
        }
        return summary.hitter.displayName
    }

    private func reportSheet(_ summary: DiamondScoutHitterSummary) -> some View {
        NavigationStack {
            Group {
                if let game = scouting.game {
                    DiamondScoutHitterCardView(
                        client: scouting.client,
                        opponentID: game.opponentID,
                        hitterID: summary.hitter.id,
                        gameID: game.id
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { reportHitter = nil }
                }
            }
        }
        .tint(.white)
    }
}

/// Compact native rendering of the hitter's spray heat as a field fan, drawn
/// from the contract's JSON `zone_heat.wedges` values (no SVG dependency).
struct HeatFanView: View {
    let heat: DiamondScoutZoneHeat

    var body: some View {
        Canvas { context, size in
            let wedges = heat.wedges
            guard !wedges.isEmpty else { return }
            let apex = CGPoint(x: size.width / 2, y: size.height - 2)
            let radius = min(size.height - 4, size.width / 1.5)
            let maxValue = max(wedges.map(\.value).max() ?? 1, 1)
            let span = 90.0 / Double(wedges.count)

            for (index, wedge) in wedges.enumerated() {
                let start = Angle.degrees(-135 + span * Double(index))
                let end = Angle.degrees(-135 + span * Double(index + 1))
                var path = Path()
                path.move(to: apex)
                path.addArc(center: apex, radius: radius, startAngle: start, endAngle: end, clockwise: false)
                path.closeSubpath()

                let intensity = Double(wedge.value) / Double(maxValue)
                context.fill(path, with: .color(DugoutTheme.warning.opacity(0.12 + 0.88 * intensity)))
                context.stroke(path, with: .color(DugoutTheme.background.opacity(0.9)), lineWidth: 1)
            }
        }
        .accessibilityLabel("Spray heat chart")
    }
}

struct MockDataBadge: View {
    var body: some View {
        Text("MOCK DATA")
            .font(.system(size: 9, weight: .black))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(DugoutTheme.warning)
            .clipShape(Capsule())
    }
}

private struct HitterCardSkeleton: View {
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .frame(width: 150, height: 16)
                RoundedRectangle(cornerRadius: 4)
                    .frame(width: 210, height: 12)
                HStack(spacing: 6) {
                    Capsule().frame(width: 64, height: 20)
                    Capsule().frame(width: 64, height: 20)
                }
            }
            Spacer()
            RoundedRectangle(cornerRadius: 8)
                .frame(width: 86, height: 58)
        }
        .padding(12)
        .foregroundStyle(Color.white.opacity(pulse ? 0.2 : 0.08))
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
