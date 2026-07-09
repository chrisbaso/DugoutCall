import Combine
import Foundation

/// Holds the opposing lineup's scouting summaries for the active game session.
///
/// Fetch strategy (built for spotty field LTE):
/// - Game start: one batch `lineup-summaries` call caches the whole lineup
///   in memory and on disk.
/// - At-bat advance: the next hitter renders from cache immediately; a single
///   throttled batch refresh in the background re-fetches the current hitter
///   and prefetches the on-deck hitter (and the rest of the lineup) in one
///   round trip.
/// - Every network failure degrades silently to cache; pitch calling is never
///   blocked.
@MainActor
public final class DiamondScoutLineupService: ObservableObject {
    public enum State: Equatable {
        case idle
        case loading
        case loaded
        case unavailable
    }

    @Published public private(set) var state: State = .idle
    @Published public private(set) var game: DiamondScoutGame?
    @Published public private(set) var summaries: [DiamondScoutHitterSummary] = []
    @Published public private(set) var currentIndex = 0

    private let clientProvider: @MainActor () -> any DiamondScoutClient
    private let defaults: UserDefaults
    private let cacheTTL: TimeInterval
    private let refreshThrottle: TimeInterval
    private let now: () -> Date
    private var lastRefreshAt: Date?

    public convenience init(settings: SettingsStore) {
        self.init(clientProvider: {
            DiamondScoutClientFactory.make(
                config: DiamondScoutConfig(
                    apiBaseURL: settings.diamondScoutAPIBaseURL,
                    bearerToken: settings.diamondScoutBearerToken,
                    forceMockMode: settings.diamondScoutMockMode
                )
            )
        })
    }

    public init(
        clientProvider: @escaping @MainActor () -> any DiamondScoutClient,
        defaults: UserDefaults = .standard,
        cacheTTL: TimeInterval = 6 * 60 * 60,
        refreshThrottle: TimeInterval = 15,
        now: @escaping () -> Date = Date.init
    ) {
        self.clientProvider = clientProvider
        self.defaults = defaults
        self.cacheTTL = cacheTTL
        self.refreshThrottle = refreshThrottle
        self.now = now
    }

    public var client: any DiamondScoutClient {
        clientProvider()
    }

    public var currentSummary: DiamondScoutHitterSummary? {
        summaries.indices.contains(currentIndex) ? summaries[currentIndex] : nil
    }

    public var onDeckSummary: DiamondScoutHitterSummary? {
        guard !summaries.isEmpty else { return nil }
        return summaries[(currentIndex + 1) % summaries.count]
    }

    /// Batch-fetches the opposing lineup's summaries for the active game and
    /// caches them. Called when the coach enters the dashboard at game start.
    public func startGameSession() async {
        guard state != .loading else { return }
        if state == .loaded, game != nil { return }
        state = .loading

        let client = clientProvider()
        do {
            let games = try await client.games(opponentID: nil)
            guard let selected = games.first(where: { $0.status == "in_progress" }) ?? games.first else {
                restoreFromCacheOrMarkUnavailable()
                return
            }
            let response = try await client.lineupSummaries(gameID: selected.id)
            apply(summaries: response.summaries, game: selected)
            persistCache()
        } catch {
            restoreFromCacheOrMarkUnavailable()
        }
    }

    /// Moves the card to the next batter. The new hitter renders from cache
    /// with zero delay; a throttled background batch refresh keeps the current
    /// and on-deck hitters fresh.
    public func advanceToNextBatter() {
        guard !summaries.isEmpty else { return }
        currentIndex = (currentIndex + 1) % summaries.count
        Task { await refreshInBackground() }
    }

    /// One batch call refreshes the current hitter and prefetches the on-deck
    /// hitter (plus the rest of the lineup). Failures are silent: the cached
    /// summaries keep rendering.
    public func refreshInBackground() async {
        guard let game else { return }
        if let lastRefreshAt, now().timeIntervalSince(lastRefreshAt) < refreshThrottle {
            return
        }
        lastRefreshAt = now()
        do {
            let response = try await clientProvider().lineupSummaries(gameID: game.id)
            apply(summaries: response.summaries, game: game)
            persistCache()
        } catch {
            // Degrade silently to cache.
        }
    }

    private func apply(summaries: [DiamondScoutHitterSummary], game: DiamondScoutGame) {
        self.game = game
        self.summaries = summaries.sorted { $0.slot < $1.slot }
        if !self.summaries.indices.contains(currentIndex) {
            currentIndex = 0
        }
        state = self.summaries.isEmpty ? .unavailable : .loaded
    }

    private func restoreFromCacheOrMarkUnavailable() {
        guard let cached = loadCache(), now().timeIntervalSince(cached.fetchedAt) < cacheTTL else {
            if summaries.isEmpty {
                state = .unavailable
            }
            return
        }
        apply(summaries: cached.summaries, game: cached.game)
    }

    // MARK: - Persistence

    private static let cacheKey = "diamondScoutLineupCacheV1"

    private struct LineupCache: Codable {
        let game: DiamondScoutGame
        let opponentID: Int
        let fetchedAt: Date
        let summaries: [DiamondScoutHitterSummary]
    }

    private func persistCache() {
        guard let game else { return }
        let cache = LineupCache(game: game, opponentID: game.opponentID, fetchedAt: now(), summaries: summaries)
        if let data = try? JSONEncoder().encode(cache) {
            defaults.set(data, forKey: Self.cacheKey)
        }
    }

    private func loadCache() -> LineupCache? {
        guard let data = defaults.data(forKey: Self.cacheKey) else { return nil }
        return try? JSONDecoder().decode(LineupCache.self, from: data)
    }
}
