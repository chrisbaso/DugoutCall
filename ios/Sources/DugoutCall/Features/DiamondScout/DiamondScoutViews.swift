import SwiftUI

struct DiamondScoutHomeView: View {
    @ObservedObject var settings: SettingsStore
    let onExit: () -> Void

    @State private var session: DiamondScoutSession?
    @State private var opponents: [DiamondScoutOpponent] = []
    @State private var games: [DiamondScoutGame] = []
    @State private var error: String?
    @State private var isLoading = false

    private var client: any DiamondScoutClient {
        DiamondScoutClientFactory.make(config: config)
    }

    private var config: DiamondScoutConfig {
        DiamondScoutConfig(
            apiBaseURL: settings.diamondScoutAPIBaseURL,
            bearerToken: settings.diamondScoutBearerToken,
            forceMockMode: settings.diamondScoutMockMode
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Diamond Scout")
                            .font(.largeTitle.bold())
                        Text(session?.program.name ?? "Game-ready scouting cards")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if client.usesMockData {
                        DiamondScoutMockBadge()
                    }
                }

                if let session {
                    DiamondScoutSummaryCard(title: "Session") {
                        Label("\(session.program.season) season", systemImage: "calendar")
                        Label("Count rules \(session.countRulesVersion)", systemImage: "number")
                        Label(session.capabilities.eventIngest ? "Event ingest enabled" : "Event ingest unavailable", systemImage: "square.and.arrow.down")
                    }
                }

                if let error {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.headline)
                }

                VStack(spacing: 10) {
                    NavigationLink {
                        DiamondScoutOpponentListView(client: client)
                    } label: {
                        DiamondScoutRouteTile(title: "Opponents", subtitle: "\(opponents.count) loaded", systemImage: "person.3.fill")
                    }
                    NavigationLink {
                        DiamondScoutGameListView(client: client, opponent: nil)
                    } label: {
                        DiamondScoutRouteTile(title: "Games", subtitle: "\(games.count) visible", systemImage: "sportscourt.fill")
                    }
                    if let firstGame = games.first {
                        NavigationLink {
                            DiamondScoutCurrentHitterView(client: client, game: firstGame)
                        } label: {
                            DiamondScoutRouteTile(title: "Current Hitter", subtitle: firstGame.opponentName, systemImage: "figure.baseball")
                        }
                    }
                }

                Button("Reload Diamond Scout") {
                    Task { await load() }
                }
                .primaryDugoutButton()

                Button("Back to DugoutCall") {
                    onExit()
                }
                .ruggedTile()
            }
            .padding()
        }
        .background(DugoutTheme.background.ignoresSafeArea())
        .foregroundStyle(.white)
        .navigationTitle("Diamond Scout")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if session == nil {
                await load()
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let loadedSession = client.session()
            async let loadedOpponents = client.opponents()
            async let loadedGames = client.games(opponentID: nil)
            session = try await loadedSession
            opponents = try await loadedOpponents
            games = try await loadedGames
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DiamondScoutOpponentListView: View {
    let client: any DiamondScoutClient
    @State private var opponents: [DiamondScoutOpponent] = []
    @State private var error: String?

    var body: some View {
        List {
            if client.usesMockData {
                DiamondScoutMockBadge()
            }
            if let error {
                Text(error).foregroundStyle(.red)
            }
            ForEach(opponents) { opponent in
                NavigationLink {
                    DiamondScoutGameListView(client: client, opponent: opponent)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(opponent.name).font(.headline)
                        Text("\(opponent.hitterCount) hitters - \(opponent.chartedGameCount) charted games")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Opponents")
        .task { await load() }
    }

    private func load() async {
        do {
            opponents = try await client.opponents()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DiamondScoutGameListView: View {
    let client: any DiamondScoutClient
    let opponent: DiamondScoutOpponent?

    @State private var games: [DiamondScoutGame] = []
    @State private var error: String?

    var body: some View {
        List {
            if client.usesMockData {
                DiamondScoutMockBadge()
            }
            if let error {
                Text(error).foregroundStyle(.red)
            }
            ForEach(games) { game in
                NavigationLink {
                    DiamondScoutGameDetailView(client: client, game: game)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(game.opponentName).font(.headline)
                        Text("\(game.gameDate) - \(game.homeAway) - \(game.status)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let location = game.location {
                            Text(location)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(opponent?.name ?? "Games")
        .task { await load() }
    }

    private func load() async {
        do {
            games = try await client.games(opponentID: opponent?.id)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DiamondScoutGameDetailView: View {
    let client: any DiamondScoutClient
    let game: DiamondScoutGame

    @State private var context: DiamondScoutGameContext?
    @State private var currentHitter: DiamondScoutCurrentHitter?
    @State private var eventResult: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading) {
                        Text(game.opponentName)
                            .font(.title.bold())
                        Text("\(game.gameDate) - \(game.homeAway)")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if client.usesMockData {
                        DiamondScoutMockBadge()
                    }
                }

                if let context {
                    DiamondScoutSummaryCard(title: "Game State") {
                        Label(context.game.status.capitalized, systemImage: "circle.fill")
                        Label("\(context.lineup.count) hitters in lineup", systemImage: "list.number")
                        if let summary = context.eventSummary {
                            Label("\(summary.acceptedEvents) accepted events", systemImage: "checkmark.seal.fill")
                        }
                    }

                    SectionHeader("Lineup")
                    ForEach(context.lineup) { hitter in
                        NavigationLink {
                            DiamondScoutHitterCardView(
                                client: client,
                                opponentID: game.opponentID,
                                hitterID: hitter.hitterID,
                                gameID: game.id
                            )
                        } label: {
                            DiamondScoutRouteTile(
                                title: "#\(hitter.jersey ?? "-") \(hitter.name)",
                                subtitle: hitter.notes ?? "Open hitter card",
                                systemImage: "rectangle.stack.person.crop.fill"
                            )
                        }
                    }
                }

                if let currentHitter {
                    NavigationLink {
                        DiamondScoutCurrentHitterView(client: client, game: game)
                    } label: {
                        DiamondScoutRouteTile(
                            title: "Current: \(currentHitter.card.hitter.displayName)",
                            subtitle: "Count \(currentHitter.count.label)",
                            systemImage: "figure.baseball"
                        )
                    }
                }

                Button("Post Sample Pitch Event") {
                    Task { await postSamplePitch() }
                }
                .primaryDugoutButton()

                if let eventResult {
                    Text(eventResult)
                        .font(.headline)
                        .foregroundStyle(DugoutTheme.warning)
                }

                if let error {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }
            .padding()
        }
        .background(DugoutTheme.background.ignoresSafeArea())
        .foregroundStyle(.white)
        .navigationTitle("Game")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            async let loadedContext = client.game(id: game.id)
            async let loadedCurrentHitter = client.currentHitter(gameID: game.id)
            context = try await loadedContext
            currentHitter = try await loadedCurrentHitter
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func postSamplePitch() async {
        let event = DiamondScoutChartingEvent(
            eventID: "dc-demo-\(UUID().uuidString)",
            sequence: 99,
            type: "pitch",
            paKey: currentHitter?.plateAppearanceKey ?? "g\(game.id)-pa-demo",
            pitchSequence: 1,
            countBefore: currentHitter?.count.label ?? "0-0",
            pitchType: "Fastball",
            pitchLocation: "away",
            result: DiamondScoutEventResult(kind: "called_strike")
        )

        do {
            let response = try await client.postEvents(gameID: game.id, events: [event])
            eventResult = "Accepted \(response.accepted), rejected \(response.rejected.count)"
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DiamondScoutCurrentHitterView: View {
    let client: any DiamondScoutClient
    let game: DiamondScoutGame

    @State private var currentHitter: DiamondScoutCurrentHitter?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if client.usesMockData {
                    DiamondScoutMockBadge()
                }

                if let currentHitter {
                    DiamondScoutHitterHeader(card: currentHitter.card)
                    DiamondScoutSummaryCard(title: "Plate Appearance") {
                        Label("Slot \(currentHitter.lineupSlot)", systemImage: "list.number")
                        Label("Count \(currentHitter.count.label)", systemImage: "number.circle.fill")
                        Label(currentHitter.plateAppearanceKey, systemImage: "key.fill")
                    }
                    NavigationLink {
                        DiamondScoutHitterCardView(
                            client: client,
                            opponentID: game.opponentID,
                            hitterID: currentHitter.hitterID,
                            gameID: game.id
                        )
                    } label: {
                        DiamondScoutRouteTile(title: "Open Full Hitter Card", subtitle: currentHitter.card.hitter.displayName, systemImage: "doc.text.magnifyingglass")
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
        .navigationTitle("Current Hitter")
        .task { await load() }
    }

    private func load() async {
        do {
            currentHitter = try await client.currentHitter(gameID: game.id)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

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

private struct DiamondScoutRouteTile: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.title2.bold())
                .frame(width: 34)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline.bold())
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.headline.bold())
                .foregroundStyle(.secondary)
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
