import SwiftUI

struct LocationGridView: View {
    @Binding var selectedLocation: PitchLocation?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Location")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(PitchLocation.allCases) { location in
                    Button(location.rawValue) {
                        selectedLocation = selectedLocation == location ? nil : location
                    }
                    .ruggedTile(isSelected: selectedLocation == location)
                }
            }
        }
    }
}
