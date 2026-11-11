import SwiftUI
import WebKit

@main
struct BoothApp: App {
    var body: some Scene {
        WindowGroup {
            BoothWebView()
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}

/// Full-screen web view that shows the booth page and gives it Bluetooth.
struct BoothWebView: UIViewRepresentable {
    static let remoteURL = URL(string: "https://mikeandxan.com/polaroid/")!

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let bridge = context.coordinator.bridge
        config.userContentController.add(bridge, name: "ble")
        config.userContentController.addUserScript(
            WKUserScript(source: BLEBridge.polyfill, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.allowsInlineMediaPlayback = true

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.945, green: 0.345, blue: 0.149, alpha: 1)
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = context.coordinator
        bridge.webView = web

        var req = URLRequest(url: Self.remoteURL)
        req.cachePolicy = .reloadRevalidatingCacheData
        req.timeoutInterval = 8
        web.load(req)
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let bridge = BLEBridge()
        private var usedFallback = false

        // No internet at the venue? Use the copy built into the app.
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            loadBundled(webView)
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            loadBundled(webView)
        }
        private func loadBundled(_ webView: WKWebView) {
            guard !usedFallback, let file = Bundle.main.url(forResource: "booth", withExtension: "html") else { return }
            usedFallback = true
            webView.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        }
    }
}
