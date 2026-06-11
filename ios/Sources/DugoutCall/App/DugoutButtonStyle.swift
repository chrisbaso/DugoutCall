import SwiftUI

extension View {
    func primaryDugoutButton() -> some View {
        self
            .font(.title3.bold())
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(DugoutTheme.accent)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func ruggedTile(isSelected: Bool = false) -> some View {
        self
            .font(.headline.bold())
            .minimumScaleFactor(0.72)
            .lineLimit(2)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(isSelected ? DugoutTheme.accent : DugoutTheme.panel)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    /// High-consequence one-tap calls (Pitchout/Pickoff): visually distinct
    /// from ordinary presets so they are hard to hit by accident.
    func specialCallTile() -> some View {
        self
            .font(.headline.bold())
            .minimumScaleFactor(0.72)
            .lineLimit(2)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(DugoutTheme.accent)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
