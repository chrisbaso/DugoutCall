import XCTest
@testable import DugoutCall

final class StubURLProtocol: URLProtocol {
    static var responses: [(status: Int, body: String)] = []
    static var requestCount = 0
    static var lastRequest: URLRequest?

    static func reset() {
        responses = []
        requestCount = 0
        lastRequest = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        let index = min(Self.requestCount, Self.responses.count - 1)
        Self.requestCount += 1
        guard index >= 0 else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let stub = Self.responses[index]
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: stub.status,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class RoomServiceTests: XCTestCase {
    private var service: RoomService!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        service = RoomService(
            session: URLSession(configuration: configuration),
            retryDelays: [0, 0.01, 0.01]
        )
    }

    private let serverURL = URL(string: "http://localhost:8787")!

    func testSurfacesServerErrorMessageOn4xx() async {
        StubURLProtocol.responses = [(400, #"{"error":"Room not found"}"#)]

        do {
            _ = try await service.joinRoom(serverURL: serverURL, code: "000000", role: .catcher, displayName: "Catcher")
            XCTFail("Expected a server error")
        } catch let error as RoomServiceError {
            XCTAssertEqual(error, .server(message: "Room not found", status: 400))
            XCTAssertEqual(error.localizedDescription, "Room not found")
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.requestCount, 1, "4xx must not be retried")
    }

    func testRetriesOn5xxThenSucceeds() async throws {
        let success = #"{"code":"123456","role":"catcher","mode":"game","expiresAt":99,"token":"abc.def","livekit":null}"#
        StubURLProtocol.responses = [(500, #"{"error":"boom"}"#), (200, success)]

        let joined = try await service.joinRoom(serverURL: serverURL, code: "123456", role: .catcher, displayName: "Catcher")

        XCTAssertEqual(joined.code, "123456")
        XCTAssertEqual(joined.token, "abc.def")
        XCTAssertNil(joined.livekit)
        XCTAssertEqual(StubURLProtocol.requestCount, 2)
    }

    func testDecodesLiveKitCredentialsWhenPresent() async throws {
        let body = """
        {"code":"123456","mode":"game","expiresAt":99,"token":"abc.def",
         "livekit":{"serverUrl":"wss://example.livekit.cloud","token":"jwt","roomName":"dugoutcall-123456"}}
        """
        StubURLProtocol.responses = [(201, body)]

        let created = try await service.createRoom(serverURL: serverURL, coachName: "Coach", teamName: "Team", mode: .game)

        XCTAssertEqual(created.livekit?.serverUrl, "wss://example.livekit.cloud")
        XCTAssertEqual(created.livekit?.roomName, "dugoutcall-123456")
    }

    func testSendsBearerTokenForRejoin() async throws {
        let success = #"{"code":"123456","role":"coach","mode":"game","expiresAt":99,"token":"abc.def","livekit":null}"#
        StubURLProtocol.responses = [(200, success)]

        _ = try await service.joinRoom(
            serverURL: serverURL,
            code: "123456",
            role: .coach,
            displayName: "Coach",
            bearerToken: "abc.def"
        )

        XCTAssertEqual(
            StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"),
            "Bearer abc.def"
        )
    }

    func testUndecodableSuccessBodyIsInvalidResponse() async {
        StubURLProtocol.responses = [(200, "not json")]

        do {
            _ = try await service.joinRoom(serverURL: serverURL, code: "123456", role: .catcher, displayName: "Catcher")
            XCTFail("Expected invalidResponse")
        } catch let error as RoomServiceError {
            XCTAssertEqual(error, .invalidResponse)
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.requestCount, 1, "Decode failures must not be retried")
    }
}
