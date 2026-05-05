import XCTest
@testable import DugoutCall

final class PresetTests: XCTestCase {
    func testDefaultPresetsMatchGameDayVocabulary() {
        let presets = PresetCall.defaults

        XCTAssertEqual(presets.map(\.label), [
            "FB Away",
            "FB Up",
            "Slider Away",
            "Curve Down",
            "Change Down",
            "Waste",
            "Pitchout",
            "Pickoff 1B"
        ])
    }
}
