import XCTest
@testable import DugoutCall

final class MessageCodingTests: XCTestCase {
    func testPitchCallMessageEncodesServerShape() throws {
        let call = PitchCall(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                             pitch: .fastball,
                             location: .away,
                             timestamp: 123456789)

        let message = DugoutMessage.pitchCall(call)
        let data = try JSONEncoder.dugoutCall.encode(message)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["type"] as? String, "pitch_call")
        XCTAssertEqual(object?["pitch"] as? String, "Fastball")
        XCTAssertEqual(object?["location"] as? String, "Away")
        XCTAssertEqual(object?["spokenText"] as? String, "Fastball away")
    }

    func testRoleAssignedDecodesFromServer() throws {
        let json = """
        {"type":"role_assigned","code":"123456","role":"catcher","mode":"game","expiresAt":123456789}
        """.data(using: .utf8)!

        let message = try JSONDecoder.dugoutCall.decode(DugoutMessage.self, from: json)

        XCTAssertEqual(message, .roleAssigned(code: "123456", role: .catcher, mode: .game, expiresAt: 123456789))
    }

    func testJoinRoomEncodesToken() throws {
        let message = DugoutMessage.joinRoom(code: "123456", role: .coach, displayName: "Coach", token: "abc.def")
        let data = try JSONEncoder.dugoutCall.encode(message)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["type"] as? String, "join_room")
        XCTAssertEqual(object?["token"] as? String, "abc.def")
    }

    func testCallAckDecodesFromServer() throws {
        let json = """
        {"type":"call_ack","id":"call-1","recipientCount":1,"timestamp":123}
        """.data(using: .utf8)!

        let message = try JSONDecoder.dugoutCall.decode(DugoutMessage.self, from: json)

        XCTAssertEqual(message, .callAck(id: "call-1", recipientCount: 1, timestamp: 123))
    }

    func testPeerStatusDecodesFromServer() throws {
        let json = """
        {"type":"peer_status","role":"catcher","connected":true}
        """.data(using: .utf8)!

        let message = try JSONDecoder.dugoutCall.decode(DugoutMessage.self, from: json)

        XCTAssertEqual(message, .peerStatus(role: .catcher, connected: true))
    }
}
