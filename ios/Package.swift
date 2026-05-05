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
    targets: [
        .executableTarget(
            name: "DugoutCall",
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
