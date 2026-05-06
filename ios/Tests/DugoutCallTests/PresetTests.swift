import XCTest
@testable import DugoutCall

final class PresetTests: XCTestCase {
    func testDefaultPresetsMatchGameDayVocabulary() {
        let presets = PresetCall.defaults

        XCTAssertEqual(presets.map(\.label), [
            "FB Away",
            "FB Up",
            "Curve Down",
            "Curve Away",
            "Change Down",
            "Change Away",
            "Pitchout",
            "Pickoff 1B"
        ])
    }

    func testPitchGridUsesMinimalFieldVocabulary() {
        XCTAssertEqual(PitchType.pitchGridCases, [.fastball, .curveball, .changeup])
    }
}
