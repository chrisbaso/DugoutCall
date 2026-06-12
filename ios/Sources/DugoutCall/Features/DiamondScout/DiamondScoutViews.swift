import SwiftUI

/// Full scouting report for one hitter. Presented as a sheet from the ambient
/// HitterCardView on the coach dashboard for between-innings reading.
struct DiamondScoutHitterCardView: View {
    let client: any DiamondScoutClient
    let opponentID: Int
    let hitterID: Int
    let gameID: Int?

    @State private var card: DiamondScoutHitterCard?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if client.usesMockData {
                    DiamondScoutMockBadge()
                }

                if let card {
                    DiamondScoutHitterHeader(card: card)

                    DiamondScoutSummaryCard(title: "Plan") {
                        Text(card.plan.outPlan ?? "No out plan")
                        Text(card.plan.pitchPlan ?? "No pitch plan")
                        if let coachNote = card.plan.coachNote {
                            Text(coachNote).foregroundStyle(DugoutTheme.warning)
                        }
                    }

                    DiamondScoutSummaryCard(title: "Quick Stats") {
                        Text("AVG \(card.quickStats.avg ?? "-") / OBP \(card.quickStats.obp ?? "-") / OPS \(card.quickStats.ops ?? "-")")
                        Text("K \(card.quickStats.kPct ?? "-") / BB \(card.quickStats.bbPct ?? "-") / SB \(card.quickStats.sb ?? "-")")
                        Text(card.quickStats.contact ?? "No contact profile")
                    }

                    DiamondScoutSummaryCard(title: "Defense") {
                        Text("Infield: \(card.defense.ifCall ?? "-")")
                        Text("Outfield: \(card.defense.ofCall ?? "-")")
                        Text("GB L/C/R: \(card.defense.gbLCR.map(String.init).joined(separator: " / "))")
                        Text("Air L/C/R: \(card.defense.airLCR.map(String.init).joined(separator: " / "))")
                    }

                    DiamondScoutSummaryCard(title: "Running") {
                        Text("Speed \(card.running.speed ?? "-")")
                        Text("SB \(card.running.stolenBases) / Bunt \(card.running.bunt ?? "-")")
                    }
                }

                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .padding()
        }
        .background(DugoutTheme.background.ignoresSafeArea())
        .foregroundStyle(.white)
        .navigationTitle("Hitter Card")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            card = try await client.hitterCard(opponentID: opponentID, hitterID: hitterID, gameID: gameID)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct DiamondScoutHitterHeader: View {
    let card: DiamondScoutHitterCard

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(card.hitter.displayName)
                .font(.system(size: 34, weight: .black, design: .rounded))
            Text(card.tier.label)
                .font(.headline)
                .foregroundStyle(DugoutTheme.warning)
            HStack {
                Text(card.confidence.label)
                Text(card.confidence.lowSample ? "Limited sample" : "\(card.confidence.paSample) PA")
            }
            .font(.subheadline.bold())
            .foregroundStyle(.secondary)
            HStack {
                ForEach(card.chips) { chip in
                    Text(chip.text)
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(DugoutTheme.grass)
                        .clipShape(Capsule())
                }
            }
        }
        .padding()
        .background(DugoutTheme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct DiamondScoutSummaryCard<Content: View>: View {
    let title: String
    private let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title)
            content
                .font(.subheadline.bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(DugoutTheme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct DiamondScoutMockBadge: View {
    var body: some View {
        Text("MOCK DATA")
            .font(.caption.bold())
            .foregroundStyle(.black)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(DugoutTheme.warning)
            .clipShape(Capsule())
    }
}
