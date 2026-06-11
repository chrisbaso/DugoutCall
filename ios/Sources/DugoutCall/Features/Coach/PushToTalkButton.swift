import SwiftUI

struct PushToTalkButton: View {
    @ObservedObject var pushToTalk: PushToTalkService

    @State private var isPressed = false

    var body: some View {
        Text(pushToTalk.isTransmitting ? "Talking" : "Hold to Talk")
            .font(.headline.bold())
            .frame(maxWidth: .infinity, minHeight: 72)
            .background(pushToTalk.isTransmitting ? DugoutTheme.warning : DugoutTheme.grass)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .gesture(
                // DragGesture(minimumDistance: 0) is the standard hold-button
                // pattern: it does not cancel when the finger drifts mid-press.
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !isPressed else { return }
                        isPressed = true
                        pushToTalk.pressBegan()
                    }
                    .onEnded { _ in
                        isPressed = false
                        pushToTalk.pressEnded()
                    }
            )
    }
}
