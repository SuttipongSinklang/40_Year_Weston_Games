import Foundation
import CoreLocation

struct RunEvent: Codable {
    var type: String
    var at: Double
    var timestamp: Double?
    var latitude: Double?
    var longitude: Double?
    var accuracy: Double?
}
struct RunSnapshot: Codable {
    var version = 1
    var id: String?
    var mode = "idle"
    var revision = 0
    var message = "พร้อมวิ่ง · บันทึกต่อได้เมื่อล็อกจอ"
    var events: [RunEvent] = []
    var acquisition_at: Double?
    var active: Bool { mode == "running" || mode == "acquiring" }
    var lastAt: Double { events.last?.at ?? 0 }
    var fixCount: Int { events.reduce(0) { $0 + ($1.type == "fix" ? 1 : 0) } }
    func response() throws -> [String: Any] {
        let data = try JSONEncoder().encode(self)
        guard var result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw RunError.invalidJournal }
        // Codable omits nil optionals, but the shared protocol requires explicit null ID.
        if id == nil { result["id"] = NSNull() }
        return result
    }
}
enum RunError: Error {
    case invalidJournal, permissionDenied, preciseRequired, storageUnavailable, locationDisabled, visibleRequired, saveFirst, full
}

/// All calls and location callbacks are serialized on the main queue.
final class NativeRunJournal {
    private(set) var state = RunSnapshot()
    private let file: URL
    private var diskFailed = false
    var changed: (() -> Void)?

    init() throws {
        let manager = FileManager.default
        var directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("WestonRuns", isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        file = directory.appendingPathComponent("active-v1.json")
        if manager.fileExists(atPath: file.path) {
            state = try JSONDecoder().decode(RunSnapshot.self, from: Data(contentsOf: file))
            try validate()
            if state.active { try pause(at: state.lastAt, message: "การบันทึกถูกขัดจังหวะ กดวิ่งต่อเมื่อพร้อม") }
        }
    }
    private func validate() throws {
        guard state.version == 1, state.revision >= 0, state.events.count <= 40010,
            ["idle", "acquiring", "running", "paused", "finished"].contains(state.mode),
            state.id == nil || UUID(uuidString: state.id ?? "") != nil else { throw RunError.invalidJournal }
        var last = -Double.infinity
        for event in state.events {
            guard event.at.isFinite, event.at >= last, ["fix", "pause", "finish"].contains(event.type) else { throw RunError.invalidJournal }
            last = event.at
        }
    }
    private func commit(_ nextValue: RunSnapshot) throws {
        guard nextValue.events.count <= 40010 else { throw RunError.full }
        var next = nextValue; next.revision = state.revision + 1
        do {
            let data = try JSONEncoder().encode(next)
            // Atomic replacement and protection compatible with location updates while locked.
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { diskFailed = true; throw RunError.storageUnavailable }
        state = next; diskFailed = false; changed?()
    }
    func start() throws {
        guard !diskFailed else { throw RunError.storageUnavailable }
        if state.active { return }
        guard state.mode != "finished" else { throw RunError.saveFirst }
        guard state.fixCount < 10000 else { throw RunError.full }
        guard state.events.count < 40000 else { throw RunError.full }
        var next = state
        if next.id == nil { next.id = UUID().uuidString.lowercased() }
        next.mode = "acquiring"; next.acquisition_at = Date().timeIntervalSince1970 * 1000
        next.message = "กำลังรอ GPS · เวลาเริ่มเมื่อได้ตำแหน่งชัดเจน"
        try commit(next)
    }
    func pause(at: Double, message: String) throws {
        if !state.active { return }
        var next = state
        if state.fixCount == 0 { next = RunSnapshot() }
        else { next.events.append(RunEvent(type: "pause", at: max(state.lastAt, at))); next.mode = "paused" }
        next.acquisition_at = nil; next.message = message; try commit(next)
    }
    func finish(at: Double) throws {
        if state.mode == "finished" || state.id == nil { return }
        var next = state
        if state.fixCount == 0 { next = RunSnapshot() }
        else {
            next.events.append(RunEvent(type: "finish", at: max(state.lastAt, at)))
            next.mode = "finished"; next.message = "จบแล้ว · กดบันทึกเพื่อเก็บเข้าประวัติ"
        }
        next.acquisition_at = nil; try commit(next)
    }
    func acknowledge(id: String) throws {
        if state.mode == "finished" && state.id == id { try commit(RunSnapshot()) }
    }
    func fix(_ location: CLLocation, arrival: Double) throws {
        if !state.active { return }
        let at = location.timestamp.timeIntervalSince1970 * 1000
        let lat = location.coordinate.latitude, lng = location.coordinate.longitude, accuracy = location.horizontalAccuracy
        guard lat.isFinite, lng.isFinite, accuracy.isFinite, at.isFinite, abs(lat) <= 90, abs(lng) <= 180,
            accuracy >= 0, accuracy <= 40, at >= arrival - 15000, at <= arrival + 10000,
            at >= state.lastAt, at >= (state.acquisition_at ?? 0) else { return }
        if let previous = state.events.last(where: { $0.type == "fix" }), at <= (previous.timestamp ?? previous.at) { return }
        var next = state
        next.events.append(RunEvent(type: "fix", at: at, timestamp: at, latitude: lat, longitude: lng, accuracy: accuracy))
        next.mode = "running"; next.message = "กำลังวิ่ง · บันทึกต่อเมื่อล็อกจอ"
        if next.fixCount >= 10000 || next.events.count >= 40000 {
            next.events.append(RunEvent(type: "pause", at: at)); next.mode = "paused"
            next.message = "ถึงขีดจำกัดจุด GPS กรุณาจบและบันทึกรอบนี้"
        }
        try commit(next)
    }
    func emergencyPause(message: String) {
        // Keep the last durable file; runtime accurately reflects that GPS stopped.
        if state.fixCount == 0 { state = RunSnapshot(revision: state.revision + 1) }
        else if state.active { state.events.append(RunEvent(type: "pause", at: state.lastAt)); state.mode = "paused"; state.revision += 1 }
        state.message = message; changed?()
    }
}
