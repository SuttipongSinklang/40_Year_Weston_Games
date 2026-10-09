import Foundation
import UIKit
import CoreLocation
import CoreMotion
import Capacitor

/// Singleton outlives any CAPPlugin or WebView; no GPS delivery depends on JS.
final class NativeRunRecorder: NSObject, CLLocationManagerDelegate {
    static let shared = NativeRunRecorder()
    let manager = CLLocationManager()
    private(set) var journal: NativeRunJournal?
    var changed: (() -> Void)?
    private var pendingStart: ((Result<RunSnapshot, Error>) -> Void)?
    private var recording = false
    private var arrival: Double { Date().timeIntervalSince1970 * 1000 }

    private override init() {
        super.init()
        journal = try? NativeRunJournal()
        journal?.changed = { [weak self] in self?.changed?() }
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        // Set before capture. App Info.plist declares UIBackgroundModes/location.
        manager.allowsBackgroundLocationUpdates = true
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    func state() throws -> RunSnapshot {
        guard let journal = journal else { throw RunError.storageUnavailable }
        return journal.state
    }
    func start(_ completion: @escaping (Result<RunSnapshot, Error>) -> Void) {
        guard pendingStart == nil else { completion(.failure(RunError.visibleRequired)); return }
        guard UIApplication.shared.applicationState == .active else { completion(.failure(RunError.visibleRequired)); return }
        guard journal != nil else { completion(.failure(RunError.storageUnavailable)); return }
        guard CLLocationManager.locationServicesEnabled() else { completion(.failure(RunError.locationDisabled)); return }
        if manager.authorizationStatus == .notDetermined {
            pendingStart = completion
            manager.requestWhenInUseAuthorization()
        } else { begin(completion) }
    }
    private func begin(_ completion: (Result<RunSnapshot, Error>) -> Void) {
        do {
            guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else { throw RunError.permissionDenied }
            guard manager.accuracyAuthorization == .fullAccuracy else { throw RunError.preciseRequired }
            guard UIApplication.shared.applicationState == .active else { throw RunError.visibleRequired }
            guard let journal = journal else { throw RunError.storageUnavailable }
            guard NativeTreadmill.shared.state.id == nil else { throw RunError.saveFirst }
            try journal.start()
            if !recording { recording = true; manager.startUpdatingLocation() }
            completion(.success(journal.state))
        } catch { completion(.failure(error)) }
    }
    private func stop() { recording = false; manager.stopUpdatingLocation() }
    func pause() throws -> RunSnapshot {
        stop()
        guard let journal = journal else { throw RunError.storageUnavailable }
        do { try journal.pause(at: arrival, message: "พักการวิ่ง · เวลาและระยะทางหยุดนับ") }
        catch { journal.emergencyPause(message: "บันทึกการพักไม่ได้ หยุด GPS แล้ว"); throw error }
        return journal.state
    }
    func finish() throws -> RunSnapshot {
        stop()
        guard let journal = journal else { throw RunError.storageUnavailable }
        do { try journal.finish(at: arrival) }
        catch { journal.emergencyPause(message: "ยังจบการวิ่งไม่ได้ ข้อมูลเดิมยังอยู่ในเครื่อง กดลองอีกครั้ง"); throw error }
        return journal.state
    }
    func acknowledge(id: String) throws -> RunSnapshot {
        guard let journal = journal else { throw RunError.storageUnavailable }
        try journal.acknowledge(id: id); return journal.state
    }
    private func interrupted(_ message: String) {
        stop()
        guard let journal = journal else { return }
        do { try journal.pause(at: journal.state.lastAt, message: message) }
        catch { journal.emergencyPause(message: message) }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        completePermissionRequest()
        if recording && (manager.authorizationStatus != .authorizedWhenInUse && manager.authorizationStatus != .authorizedAlways
            || manager.accuracyAuthorization != .fullAccuracy) {
            interrupted("สิทธิ์ตำแหน่งถูกปิด เปิดตำแหน่งที่แม่นยำแล้วกดวิ่งต่อ")
        }
    }
    @objc private func appBecameActive() { completePermissionRequest() }
    private func completePermissionRequest() {
        guard let callback = pendingStart, manager.authorizationStatus != .notDetermined else { return }
        // Authorization may arrive while the system permission sheet still makes the app inactive.
        // Wait for visibility before starting location; denials need no active app to report.
        let authorized = manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways
        if authorized && UIApplication.shared.applicationState != .active { return }
        pendingStart = nil; begin(callback)
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard recording, let journal = journal else { return }
        do {
            for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
                if !journal.state.active { break }
                try journal.fix(location, arrival: arrival)
            }
            if !journal.state.active { stop() }
        } catch { interrupted("บันทึก GPS ในเครื่องไม่ได้ หยุดติดตามแล้ว กรุณาเก็บหรือส่งออกข้อมูลก่อนปิดแอป") }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Temporary unavailable locations aren't permission failures; wait for the next fix.
        if (error as? CLError)?.code == .locationUnknown { return }
        interrupted("GPS ไม่พร้อม ตรวจสิทธิ์ตำแหน่งแล้วกดวิ่งต่อ")
    }
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        interrupted("ระบบพัก GPS กดวิ่งต่อเมื่อกลับเข้าแอป")
    }
}

@objc(WestonRunningPlugin)
public final class WestonRunningPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WestonRunningPlugin"
    public let jsName = "WestonRunning"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTreadmillState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTreadmill", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseTreadmill", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTreadmill", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeTreadmill", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTreadmillDistance", returnType: CAPPluginReturnPromise)
    ]
    private var recorder: NativeRunRecorder { NativeRunRecorder.shared }
    private let pedometer = CMPedometer()
    private var stepGeneration = 0
    @objc private func stopPhoneSteps() { stepGeneration += 1; pedometer.stopUpdates() }
    @objc func startSteps(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard CMPedometer.isStepCountingAvailable(), UIApplication.shared.applicationState == .active else {
                call.reject("Phone step sensor unavailable"); return
            }
            self.stopPhoneSteps()
            let request = self.stepGeneration
            let instant = Date()
            // Ask Motion & Fitness permission. Historical data is discarded, never stored or uploaded.
            self.pedometer.queryPedometerData(from: instant.addingTimeInterval(-1), to: instant) { _, error in
                DispatchQueue.main.async {
                    guard request == self.stepGeneration else { call.reject("Motion cancelled"); return }
                    guard error == nil, CMPedometer.authorizationStatus() == .authorized,
                          UIApplication.shared.applicationState == .active else {
                        call.reject("Motion permission denied or app hidden"); return
                    }
                    self.pedometer.startUpdates(from: Date()) { value, error in
                        DispatchQueue.main.async {
                            guard request == self.stepGeneration else { return }
                            if error != nil {
                                self.stopPhoneSteps()
                                self.notifyListeners("stepProgress", data: ["error": "Motion unavailable"])
                            } else if let value = value {
                                self.notifyListeners("stepProgress", data: ["steps": value.numberOfSteps.intValue])
                            }
                        }
                    }
                    call.resolve()
                }
            }
        }
    }
    @objc func stopSteps(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.stopPhoneSteps(); call.resolve() }
    }
    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(stopPhoneSteps),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.recorder.changed = { [weak self] in self?.notifyListeners("stateChanged", data: [:]) }
            NativeTreadmill.shared.changed = { [weak self] in self?.notifyListeners("treadmillStateChanged", data: [:]) }
        }
    }
    private func errorMessage(_ error: Error) -> String {
        switch error {
        case RunError.permissionDenied: return "Location permission denied"
        case RunError.preciseRequired: return "Precise location permission required"
        case RunError.locationDisabled: return "Location services disabled"
        case RunError.visibleRequired: return "Start requires visible app"
        case RunError.saveFirst: return "Save finished run first"
        case RunError.full: return "Run journal full; finish recording"
        default: return "Native recording unavailable; existing journal retained"
        }
    }
    private func perform(_ call: CAPPluginCall, action: @escaping () throws -> RunSnapshot) {
        DispatchQueue.main.async {
            do { call.resolve(try action().response()) }
            catch { call.reject(self.errorMessage(error)) }
        }
    }
    @objc func getState(_ call: CAPPluginCall) { perform(call) { try self.recorder.state() } }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.recorder.start { result in
                switch result {
                case .success(let state):
                    do { call.resolve(try state.response()) } catch { call.reject(self.errorMessage(error)) }
                case .failure(let error): call.reject(self.errorMessage(error))
                }
            }
        }
    }
    @objc func pause(_ call: CAPPluginCall) { perform(call) { try self.recorder.pause() } }
    @objc func finish(_ call: CAPPluginCall) { perform(call) { try self.recorder.finish() } }
    @objc func acknowledge(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("Missing run ID"); return }
        perform(call) { try self.recorder.acknowledge(id: id) }
    }
    private func treadmillCommand(_ call: CAPPluginCall, action: String) {
        DispatchQueue.main.async {
            NativeTreadmill.shared.command(action, automatic: call.getBool("automatic") ?? true,
                stride: call.getDouble("stride_m") ?? 0.75, id: call.getString("id"), distance: call.getDouble("distance_m")) { result in
                switch result {
                case .success(let state):
                    do { call.resolve(try state.response()) } catch { call.reject("Treadmill storage unavailable") }
                case .failure: call.reject("Motion permission, native storage or recording conflict; existing data retained")
                }
            }
        }
    }
    @objc func getTreadmillState(_ call: CAPPluginCall) { treadmillCommand(call, action: "read") }
    @objc func startTreadmill(_ call: CAPPluginCall) { treadmillCommand(call, action: "start") }
    @objc func pauseTreadmill(_ call: CAPPluginCall) { treadmillCommand(call, action: "pause") }
    @objc func finishTreadmill(_ call: CAPPluginCall) { treadmillCommand(call, action: "finish") }
    @objc func acknowledgeTreadmill(_ call: CAPPluginCall) { treadmillCommand(call, action: "ack") }
    @objc func setTreadmillDistance(_ call: CAPPluginCall) { treadmillCommand(call, action: "distance") }
    // No application background observer stops location capture. Force-quit/restart is recovered paused.
    deinit { pedometer.stopUpdates(); NotificationCenter.default.removeObserver(self) }
}
