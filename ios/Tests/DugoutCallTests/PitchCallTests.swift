import XCTest
@testable import DugoutCall

final class PitchCallTests: XCTestCase {
    func testFastballAwayPhrase() {
        let call = PitchCall(pitch: .fastball, location: .away)

        XCTAssertEqual(call.spokenText, "Fastball away")
    }

    func testCurveballDownAwayPhrase() {
        let call = PitchCall(pitch: .curveball, location: .downAway)

        XCTAssertEqual(call.spokenText, "Curveball down away")
    }

    func testPickoffDoesNotRequireLocation() {
        let call = PitchCall(pitch: .pickoff, location: nil)

        XCTAssertEqual(call.spokenText, "Pickoff")
    }

    func testRepeatLastCreatesNewIdentifier() {
        let original = PitchCall(pitch: .changeup, location: .down)
        let repeated = original.repeating()

        XCTAssertEqual(repeated.spokenText, "Change-up down")
        XCTAssertNotEqual(repeated.id, original.id)
    }
}
