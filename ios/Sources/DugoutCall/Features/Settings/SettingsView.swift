import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Team") {
                    TextField("Team name", text: $settings.teamName)
                    TextField("Coach name", text: $settings.coachName)
                    TextField("Server URL", text: $settings.serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                }

                Section("Mode") {
                    Picker("App mode", selection: $settings.mode) {
                        ForEach(AppMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    Toggle("Confirm before entering Game Mode", isOn: $settings.confirmBeforeGameMode)
                    Toggle("Local-only pitch history", isOn: $settings.localPitchHistoryEnabled)
                }

                Section("Diamond Scout Debug") {
                    Toggle("Use mock Diamond Scout data", isOn: $settings.diamondScoutMockMode)
                    TextField("API base URL", text: $settings.diamondScoutAPIBaseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("Bearer token", text: $settings.diamondScoutBearerToken)
                        .textInputAutocapitalization(.never)
                        .textContentType(.password)
                    Text(diamondScoutModeText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Speech") {
                    Slider(value: $settings.speechRate, in: 0.35...0.62) {
                        Text("Speech rate")
                    }
                    Slider(value: $settings.speechVolume, in: 0.2...1.0) {
                        Text("Speech volume")
                    }
                }

                Section("Pre-game AirPods checklist") {
                    Label("Close music apps", systemImage: "checkmark.circle")
                    Label("Lock AirPods to this iPhone", systemImage: "airpodspro")
                    Label("Test audio route before game", systemImage: "speaker.wave.2.fill")
                }

                Section("Compliance") {
                    Text("Use only where permitted by your league/state association. Game Mode is designed for one-way coach-to-catcher communication.")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var diamondScoutModeText: String {
        let config = DiamondScoutConfig(
            apiBaseURL: settings.diamondScoutAPIBaseURL,
            bearerToken: settings.diamondScoutBearerToken,
            forceMockMode: settings.diamondScoutMockMode
        )
        return config.usesMockData
            ? "Diamond Scout will show MOCK DATA until mock mode is off and both API base URL and Bearer token are set."
            : "Diamond Scout will call \(settings.diamondScoutAPIBaseURL)/api/v1 with Authorization: Bearer <token>."
    }
}
