import SwiftUI

struct RoleSelectionView: View {
    let onSelect: (UserRole) -> Void
    let onDiamondScout: () -> Void

    var body: some View {
        ZStack {
            DugoutTheme.background.ignoresSafeArea()
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("DugoutCall")
                        .font(.system(size: 44, weight: .black, design: .rounded))
                    Text("Use only where permitted by your league/state association. Game Mode is designed for one-way coach-to-catcher communication.")
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal)

                VStack(spacing: 16) {
                    RoleButton(title: "Coach Mode", systemImage: "megaphone.fill") {
                        onSelect(.coach)
                    }
                    RoleButton(title: "Catcher Mode", systemImage: "airpodspro") {
                        onSelect(.catcher)
                    }
                    RoleButton(title: "Diamond Scout", systemImage: "rectangle.stack.person.crop.fill") {
                        onDiamondScout()
                    }
                }
                .padding(.horizontal)
            }
            .foregroundStyle(.white)
        }
    }
}

private struct RoleButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.title2.bold())
                .frame(maxWidth: .infinity, minHeight: 88)
                .background(DugoutTheme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

enum DugoutTheme {
    static let background = Color(red: 0.05, green: 0.07, blue: 0.06)
    static let panel = Color(red: 0.11, green: 0.16, blue: 0.13)
    static let accent = Color(red: 0.84, green: 0.19, blue: 0.14)
    static let grass = Color(red: 0.14, green: 0.35, blue: 0.22)
    static let warning = Color(red: 0.98, green: 0.68, blue: 0.18)
}
