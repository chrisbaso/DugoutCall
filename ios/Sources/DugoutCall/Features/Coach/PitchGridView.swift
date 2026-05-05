import SwiftUI

struct PitchGridView: View {
    @Binding var selectedPitch: PitchType?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Pitch")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(PitchType.allCases) { pitch in
                    Button(pitch.rawValue) {
                        selectedPitch = selectedPitch == pitch ? nil : pitch
                    }
                    .ruggedTile(isSelected: selectedPitch == pitch)
                }
            }
        }
    }
}
