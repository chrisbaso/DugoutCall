import Combine
import Foundation

@MainActor
public final class AudioRouteMonitor: ObservableObject {
    @Published public private(set) var state: AudioRouteState = AudioRouteState()

    private let audioSessionService: AudioSessionService
    private var cancellable: AnyCancellable?

    public init(audioSessionService: AudioSessionService) {
        self.audioSessionService = audioSessionService
        cancellable = audioSessionService.$routeState.sink { [weak self] state in
            self?.state = state
        }
    }
}
