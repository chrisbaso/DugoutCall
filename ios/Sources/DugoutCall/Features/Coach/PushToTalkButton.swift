import SwiftUI

struct PushToTalkButton: View {
    @ObservedObject var pushToTalk: PushToTalkService
    @ObservedObject var pitchService: PitchCallService

    var body: some View {
        Text(pushToTalk.isTransmitting ? "Talking" : "Hold to Talk")
            .font(.headline.bold())
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(pushToTalk.isTransmitting ? DugoutTheme.warning : DugoutTheme.grass)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .onLongPressGesture(minimumDuration: 0, maximumDistance: 40) {
            } onPressingChanged: { isPressing in
                Task {
                    pitchService.isVoiceActive = isPressing
                    if isPressing {
                        await pushToTalk.start()
                    } else {
                        await pushToTalk.stop()
                        try? await pitchService.flushQueuedCall()
                    }
                }
            }
    }
}
