import SwiftUI

struct PresetGridView: View {
    let presets: [PresetCall]
    let onTap: (PresetCall) -> Void

    private var standardPresets: [PresetCall] {
        presets.filter { $0.pitch != .pitchout && $0.pitch != .pickoff }
    }

    private var specialPresets: [PresetCall] {
        presets.filter { $0.pitch == .pitchout || $0.pitch == .pickoff }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("One-Tap Presets")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(standardPresets) { preset in
                    Button(preset.label) {
                        onTap(preset)
                    }
                    .ruggedTile()
                }
            }

            if !specialPresets.isEmpty {
                SectionHeader("Special Calls")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2), spacing: 8) {
                    ForEach(specialPresets) { preset in
                        Button(preset.label) {
                            onTap(preset)
                        }
                        .specialCallTile()
                    }
                }
            }
        }
    }
}
