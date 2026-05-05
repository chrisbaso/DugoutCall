import SwiftUI

struct AudioDiagnosticsView: View {
    let routeState: AudioRouteState
    let onTestSpeech: () -> Void

    var body: some View {
        List {
            LabeledContent("Input route", value: routeState.inputRoute)
            LabeledContent("Output route", value: routeState.outputRoute)
            LabeledContent("Bluetooth audio", value: routeState.isBluetoothActive ? "Active" : "Inactive")
            LabeledContent("Microphone permission", value: routeState.isMicrophonePermissionGranted ? "Granted" : "Not granted")
            LabeledContent("Speech synthesis", value: routeState.isSpeechSynthesisReady ? "Ready" : "Unavailable")
            Button("Play speech test", action: onTestSpeech)
        }
        .navigationTitle("Audio Diagnostics")
    }
}
