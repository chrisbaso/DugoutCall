// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DugoutCall",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .executable(name: "DugoutCall", targets: ["DugoutCall"])
    ],
    dependencies: [
        .package(url: "https://github.com/livekit/client-sdk-swift", from: "2.0.0")
    ],
    targets: [
        .executableTarget(
            name: "DugoutCall",
            dependencies: [
                .product(name: "LiveKit", package: "client-sdk-swift")
            ],
            path: "Sources/DugoutCall",
            resources: []
        ),
        .testTarget(
            name: "DugoutCallTests",
            dependencies: ["DugoutCall"],
            path: "Tests/DugoutCallTests"
        )
    ]
)
