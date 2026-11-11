import Foundation
import CoreBluetooth
import WebKit

/// Gives the booth web page a tiny version of Web Bluetooth (navigator.bluetooth),
/// backed by Apple's CoreBluetooth. Only what the booth page needs:
/// find the camera, connect, write bytes, receive bytes, notice disconnects.
final class BLEBridge: NSObject, WKScriptMessageHandler, CBCentralManagerDelegate, CBPeripheralDelegate {

    // Nordic UART Service used by the Polaroid Now+
    static let svcUUID = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    static let rxUUID  = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E") // we write here
    static let txUUID  = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E") // camera talks here

    weak var webView: WKWebView?
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var rx: CBCharacteristic?
    private var tx: CBCharacteristic?

    private var pendingScan: Int?
    private var pendingConnect: Int?
    private var pendingNotify: Int?
    private var waitingForPowerOn: [() -> Void] = []
    private var scanTimer: Timer?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    // MARK: messages from the page

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String,
              let id = (body["id"] as? NSNumber)?.intValue else { return }
        switch cmd {
        case "scan":    whenPoweredOn { self.scan(id) }
        case "connect": whenPoweredOn { self.connect(id) }
        case "notify":  notify(id)
        case "write":
            let bytes = (body["data"] as? [NSNumber])?.map { $0.uint8Value } ?? []
            write(id, Data(bytes))
        default: reply(id, ok: false, "unknown command")
        }
    }

    private func whenPoweredOn(_ work: @escaping () -> Void) {
        if central.state == .poweredOn { work() } else { waitingForPowerOn.append(work) }
    }

    private func scan(_ id: Int) {
        // Reuse a camera we already know about.
        if peripheral != nil { reply(id, ok: true, peripheral?.name ?? "Now+"); return }
        pendingScan = id
        central.scanForPeripherals(withServices: [Self.svcUUID], options: nil)
        scanTimer?.invalidate()
        scanTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            guard let self, let pid = self.pendingScan else { return }
            self.central.stopScan(); self.pendingScan = nil
            self.reply(pid, ok: false, "Camera not found. Turn it on and press the + button.")
        }
    }

    private func connect(_ id: Int) {
        guard let p = peripheral else { reply(id, ok: false, "No camera selected"); return }
        if p.state == .connected, rx != nil, tx != nil { reply(id, ok: true, p.name ?? "Now+"); return }
        pendingConnect = id
        central.connect(p, options: nil)
    }

    private func notify(_ id: Int) {
        guard let p = peripheral, let tx else { reply(id, ok: false, "Not connected"); return }
        if tx.isNotifying { reply(id, ok: true, ""); return }
        pendingNotify = id
        p.setNotifyValue(true, for: tx)
    }

    private func write(_ id: Int, _ data: Data) {
        guard let p = peripheral, p.state == .connected, let rx else { reply(id, ok: false, "Not connected"); return }
        let type: CBCharacteristicWriteType = rx.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        p.writeValue(data, for: rx, type: type)
        reply(id, ok: true, "")
    }

    // MARK: CoreBluetooth

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            let work = waitingForPowerOn; waitingForPowerOn = []
            work.forEach { $0() }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard let id = pendingScan else { return }
        central.stopScan(); scanTimer?.invalidate(); pendingScan = nil
        peripheral = p
        p.delegate = self
        reply(id, ok: true, p.name ?? "Now+")
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        p.discoverServices([Self.svcUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        if let id = pendingConnect { pendingConnect = nil; reply(id, ok: false, error?.localizedDescription ?? "Connect failed") }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        rx = nil; tx = nil
        if let id = pendingConnect { pendingConnect = nil; reply(id, ok: false, "Disconnected") }
        js("window.__bleDisconnected && window.__bleDisconnected()")
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard let svc = p.services?.first(where: { $0.uuid == Self.svcUUID }) else {
            if let id = pendingConnect { pendingConnect = nil; reply(id, ok: false, "Camera service missing") }
            return
        }
        p.discoverCharacteristics([Self.rxUUID, Self.txUUID], for: svc)
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor svc: CBService, error: Error?) {
        for c in svc.characteristics ?? [] {
            if c.uuid == Self.rxUUID { rx = c }
            if c.uuid == Self.txUUID { tx = c }
        }
        guard let id = pendingConnect else { return }
        pendingConnect = nil
        if rx != nil, tx != nil { reply(id, ok: true, p.name ?? "Now+") }
        else { reply(id, ok: false, "Camera channels missing") }
    }

    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor c: CBCharacteristic, error: Error?) {
        guard let id = pendingNotify else { return }
        pendingNotify = nil
        reply(id, ok: error == nil, error?.localizedDescription ?? "")
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard c.uuid == Self.txUUID, let data = c.value else { return }
        let list = data.map { String($0) }.joined(separator: ",")
        js("window.__bleData && window.__bleData([\(list)])")
    }

    // MARK: talking back to the page

    private func reply(_ id: Int, ok: Bool, _ value: String) {
        let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        js("window.__bleReply && window.__bleReply(\(id), \(ok), '\(escaped)')")
    }

    private func js(_ code: String) {
        DispatchQueue.main.async { self.webView?.evaluateJavaScript(code, completionHandler: nil) }
    }

    // MARK: the page-side half

    static let polyfill = #"""
    (function(){
      if (!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ble)) return;
      var post = function(m){ window.webkit.messageHandlers.ble.postMessage(m); };
      var pending = {}, seq = 0;
      function call(cmd, extra){
        return new Promise(function(res, rej){
          var id = ++seq; pending[id] = {res:res, rej:rej};
          var m = {cmd:cmd, id:id}; if (extra) for (var k in extra) m[k] = extra[k];
          post(m);
        });
      }
      window.__bleReply = function(id, ok, val){ var p = pending[id]; if(!p) return; delete pending[id]; ok ? p.res(val) : p.rej(new Error(val)); };
      var charCbs = new Set(), devCbs = new Set();
      function bytes(b){ return Array.from(b instanceof Uint8Array ? b : new Uint8Array(b.buffer || b)); }
      var ch = {
        value: null,
        writeValueWithoutResponse: function(b){ return call('write', {data: bytes(b)}); },
        writeValue: function(b){ return call('write', {data: bytes(b)}); },
        startNotifications: function(){ return call('notify').then(function(){ return ch; }); },
        addEventListener: function(t, cb){ if (t === 'characteristicvaluechanged') charCbs.add(cb); },
        removeEventListener: function(t, cb){ charCbs.delete(cb); }
      };
      window.__bleData = function(arr){ var u = new Uint8Array(arr); ch.value = new DataView(u.buffer); charCbs.forEach(function(cb){ cb({target: ch}); }); };
      var service = { getCharacteristic: function(){ return Promise.resolve(ch); } };
      var server = { connected: false, getPrimaryService: function(){ return Promise.resolve(service); }, disconnect: function(){} };
      server.device = null;
      var device = {
        name: 'Now+',
        gatt: server,
        addEventListener: function(t, cb){ if (t === 'gattserverdisconnected') devCbs.add(cb); }
      };
      server.device = device;
      server.connect = function(){ return call('connect').then(function(n){ if (n) device.name = n; server.connected = true; return server; }); };
      window.__bleDisconnected = function(){ server.connected = false; devCbs.forEach(function(cb){ cb({target: device}); }); };
      Object.defineProperty(navigator, 'bluetooth', { value: {
        requestDevice: function(){ return call('scan').then(function(n){ if (n) device.name = n; return device; }); }
      }, configurable: true });
    })();
    """#
}
