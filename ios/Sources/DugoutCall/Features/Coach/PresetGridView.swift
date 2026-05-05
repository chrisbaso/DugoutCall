import SwiftUI

struct PresetGridView: View {
    let presets: [PresetCall]
    let onTap: (PresetCall) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("One-Tap Presets")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(presets) { preset in
                    Button(preset.label) {
                        onTap(preset)
                    }
                    .ruggedTile()
                }
            }
        }
    }
}
