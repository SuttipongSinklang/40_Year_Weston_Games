import Foundation
import CoreMotion
import UIKit

struct TreadmillSnapshot: Codable {
    var version = 1
    var revision = 0
    var id: String?
    var mode = "idle"
    var message = "พร้อมวิ่งบนลู่ · รวมก้าวหลังปลดล็อกจอ"
    var started_at: Double = 0
    var updated_at: Double = 0
    var ended_at: Double?
    var resumed_at: Double?
    var elapsed_ms: Double = 0
    var steps = 0
    var segment_steps = 0
    var distance_source = "phone_steps"
    var stride_m: Double?
    var distance_m: Double = 0
    var active: Bool { mode == "running" }
    func response() throws -> [String: Any] {
        var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as! [String: Any]
        if id == nil { value["id"] = NSNull() }
        if resumed_at == nil { value["resumed_at"] = NSNull() }
        if ended_at == nil { value["ended_at"] = NSNull() }
        if stride_m == nil { value["stride_m"] = NSNull() }
        return value
    }
}

/// The OS motion cache keeps steps while suspended; query an exact active interval.
/// Replacing cumulative interval totals (never adding callbacks) prevents double-counting.
final class NativeTreadmill {
    static let shared = NativeTreadmill()
    private(set) var state = TreadmillSnapshot()
    private let pedometer = CMPedometer()
    private var file: URL?
    private var busy = false
    private var generation = 0
    private var failed = false
    var changed: (() -> Void)?
    private var now: Double { Date().timeIntervalSince1970 * 1000 }
    private init() {
        do {
            var directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("WestonRuns", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
            file = directory.appendingPathComponent("treadmill-v1.json")
            if let file = file, FileManager.default.fileExists(atPath: file.path) {
                state = try JSONDecoder().decode(TreadmillSnapshot.self, from: Data(contentsOf: file))
                guard state.version == 1, state.revision >= 0, state.steps >= 0, state.steps <= 1000000,
                    ["idle", "running", "paused", "finished"].contains(state.mode),
                    state.id == nil || UUID(uuidString: state.id ?? "") != nil else { throw RunError.invalidJournal }
                if state.active {
                    var next = state
                    next.elapsed_ms += max(0, next.updated_at - (next.resumed_at ?? next.updated_at))
                    next.resumed_at = nil; next.mode = "paused"
                    next.message = "การบันทึกถูกขัดจังหวะ กู้ถึงข้อมูลล่าสุด กดวิ่งต่อเมื่อพร้อม"
                    try commit(next)
                }
            }
        } catch { failed = true }
    }
    private func commit(_ value: TreadmillSnapshot) throws {
        guard let file = file else { throw RunError.storageUnavailable }
        var next = value; next.revision = state.revision + 1
        do { try JSONEncoder().encode(next).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        catch { failed = true; throw RunError.storageUnavailable }
        state = next; failed = false; changed?()
    }
    private func stopUpdates() { generation += 1; pedometer.stopUpdates() }
    private func emergencyPause() {
        stopUpdates()
        if state.active {
            var next = state; next.elapsed_ms += max(0, next.updated_at - (next.resumed_at ?? next.updated_at))
            next.mode = "paused"; next.resumed_at = nil; next.message = "อ่านหรือเก็บก้าวไม่ได้ กู้ถึงข้อมูลล่าสุดแล้วพักการวิ่ง"
            do { try commit(next) } catch { state = next; changed?() }
        }
    }
    private func updates() {
        guard state.active, state.distance_source == "phone_steps", let start = state.resumed_at else { return }
        stopUpdates(); let token = generation
        pedometer.startUpdates(from: Date(timeIntervalSince1970: start / 1000)) { [weak self] data, error in
            DispatchQueue.main.async {
                guard let self = self, token == self.generation, self.state.active, !self.busy else { return }
                if error != nil { self.emergencyPause(); return }
                if let data = data {
                    do { try self.merge(data.numberOfSteps.intValue, at: data.endDate.timeIntervalSince1970 * 1000) }
                    catch { self.emergencyPause() }
                }
            }
        }
    }
    private func merge(_ count: Int, at: Double) throws {
        guard count >= 0, count >= state.segment_steps, count <= 1000000,
            let start = state.resumed_at, at >= start else { return }
        let total = state.steps - state.segment_steps + count
        guard total <= 1000000, Double(total) * (state.stride_m ?? 0) <= 200000 else { throw RunError.full }
        var next = state; next.steps = total; next.segment_steps = count
        next.distance_m = Double(total) * (next.stride_m ?? 0); next.updated_at = max(at, next.updated_at)
        try commit(next)
    }
    func command(_ action: String, automatic: Bool = true, stride: Double = 0.75,
                 id: String? = nil, distance: Double? = nil,
                 completion: @escaping (Result<TreadmillSnapshot, Error>) -> Void) {
        guard !busy, !failed else { completion(.failure(RunError.storageUnavailable)); return }
        busy = true
        var boundary = now
        func done(_ result: Result<TreadmillSnapshot, Error>) { self.busy = false; completion(result) }
        func apply() {
            do {
                var next = self.state
                switch action {
                case "start":
                    boundary = self.now
                    guard UIApplication.shared.applicationState == .active else { throw RunError.visibleRequired }
                    guard try NativeRunRecorder.shared.state().id == nil else { throw RunError.saveFirst }
                    guard next.mode != "finished" else { throw RunError.saveFirst }
                    if next.active { done(.success(next)); return }
                    if next.id == nil {
                        guard !automatic || (stride.isFinite && stride >= 0.3 && stride <= 2) else { throw RunError.invalidJournal }
                        next = TreadmillSnapshot(); next.id = UUID().uuidString.lowercased(); next.started_at = boundary
                        next.distance_source = automatic ? "phone_steps" : "manual"; next.stride_m = automatic ? stride : nil
                    }
                    next.mode = "running"; next.resumed_at = boundary; next.updated_at = boundary; next.segment_steps = 0
                    next.message = "กำลังวิ่งบนลู่ · ล็อกจอได้ · รวมก้าวเมื่อกลับเข้าแอป"
                case "pause", "finish":
                    self.stopUpdates()
                    if next.active { next.elapsed_ms += max(0, boundary - (next.resumed_at ?? boundary)); next.resumed_at = nil }
                    if next.id != nil {
                        next.mode = action == "finish" ? "finished" : "paused"; next.updated_at = boundary
                        next.message = action == "finish" ? "จบแล้ว · บันทึกเพื่อเก็บประวัติ" : "พักการวิ่ง · ไม่นับก้าวและเวลาพัก"
                        if action == "finish" && next.ended_at == nil { next.ended_at = boundary }
                    }
                case "ack":
                    if next.mode == "finished" && next.id == id { next = TreadmillSnapshot() }
                case "distance":
                    guard next.id != nil, next.distance_source == "manual", next.mode != "finished",
                        let distance = distance, distance.isFinite, distance >= 0, distance <= 200000 else { throw RunError.invalidJournal }
                    next.distance_m = distance
                default: break
                }
                if action == "read" && next.active && next.distance_source == "manual" { next.updated_at = boundary }
                if action != "read" || (next.active && next.distance_source == "manual") { try self.commit(next) }
                if action == "start" { self.updates() }
                done(.success(self.state))
            } catch { if action == "pause" || action == "finish" { self.emergencyPause() }; done(.failure(error)) }
        }
        if action == "start" && state.id == nil && automatic {
            guard CMPedometer.isStepCountingAvailable() else { done(.failure(RunError.permissionDenied)); return }
            pedometer.queryPedometerData(from: Date().addingTimeInterval(-1), to: Date()) { _, error in
                DispatchQueue.main.async {
                    guard error == nil, CMPedometer.authorizationStatus() == .authorized else { done(.failure(RunError.permissionDenied)); return }
                    apply()
                }
            }
        } else if state.active && state.distance_source == "phone_steps", let start = state.resumed_at {
            // Reject expired cache instead of claiming missing historical steps are zero.
            guard boundary - start < 6 * 86400000 else { emergencyPause(); done(.failure(RunError.full)); return }
            pedometer.queryPedometerData(from: Date(timeIntervalSince1970: start / 1000), to: Date(timeIntervalSince1970: boundary / 1000)) { data, error in
                DispatchQueue.main.async {
                    guard error == nil, let data = data else { self.emergencyPause(); done(.failure(RunError.permissionDenied)); return }
                    do { try self.merge(data.numberOfSteps.intValue, at: boundary); apply() }
                    catch { self.emergencyPause(); done(.failure(error)) }
                }
            }
        } else { apply() }
    }
}
