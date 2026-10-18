import AppKit
import WebKit
import Foundation
import Darwin


@MainActor
final class OrbitApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var status: NSTextField!
    private var spinner: NSProgressIndicator!
    private var retry: NSButton!
    private var overlay: NSView!
    private var backend: Process?
    private var log: FileHandle?
    private var timer: Timer?
    private var language = "en"
    private var attempts = 0
    private var probing = false
    private var closing = false
    private let smokeTest = ["--smoke-test", "--smoke-storage-write", "--smoke-storage-read"].contains { CommandLine.arguments.contains($0) }
    private let storageWrite = CommandLine.arguments.contains("--smoke-storage-write")
    private let storageRead = CommandLine.arguments.contains("--smoke-storage-read")
    private let url = URL(string: "http://127.0.0.1:8765/")!

    private var project: URL {
        URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "OrbitProjectDirectory") as! String)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let data = try? Data(contentsOf: project.appendingPathComponent("data/settings.json")),
           let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           settings["language"] as? String == "de" {
            language = "de"
        }
        createMenu()
        createWindow()
        beginStartup()
    }

    private func text(_ english: String, _ german: String) -> String {
        language == "de" ? german : english
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "languageChanged", message.frameInfo.isMainFrame,
              let value = message.body as? String, ["en", "de"].contains(value) else { return }
        language = value
        createMenu()
    }

    private func createMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: text("Quit Orbit Dashboard", "Orbit Dashboard beenden"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)

        let editItem = NSMenuItem()
        editItem.title = text("Edit", "Bearbeiten")
        let edit = NSMenu(title: text("Edit", "Bearbeiten"))
        for (title, selector, key) in [(text("Cut", "Ausschneiden"), "cut:", "x"), (text("Copy", "Kopieren"), "copy:", "c"), (text("Paste", "Einfügen"), "paste:", "v"), (text("Select All", "Alles auswählen"), "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)

        let viewItem = NSMenuItem()
        viewItem.title = text("View", "Darstellung")
        let viewMenu = NSMenu(title: text("View", "Darstellung"))
        let reload = NSMenuItem(title: text("Reload", "Neu laden"), action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        viewMenu.addItem(reload)
        viewItem.submenu = viewMenu
        menu.addItem(viewItem)
        NSApp.mainMenu = menu
    }

    private func createWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1420, height: 940), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Orbit Dashboard"
        window.minSize = NSSize(width: 760, height: 560)
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "languageChanged")
        // Keep browser-local filters and sidebar state when the app is closed.
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView!.addSubview(webView)

        overlay = NSView(frame: window.contentView!.bounds)
        overlay.autoresizingMask = [.width, .height]
        overlay.wantsLayer = true
        // Match the dashboard background while the backend starts, also in dark mode.
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let background = dark ? NSColor(calibratedRed: 0.071, green: 0.094, blue: 0.082, alpha: 1) : NSColor(calibratedRed: 0.96, green: 0.965, blue: 0.945, alpha: 1)
        overlay.layer?.backgroundColor = background.cgColor
        window.contentView!.addSubview(overlay)
        spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimation(nil)
        overlay.addSubview(spinner)
        status = NSTextField(labelWithString: text("Starting Orbit …", "Orbit wird gestartet …"))
        status.font = .systemFont(ofSize: 16)
        status.alignment = .center
        status.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(status)
        retry = NSButton(title: text("Try again", "Erneut versuchen"), target: self, action: #selector(beginStartup))
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.isHidden = true
        overlay.addSubview(retry)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -35),
            status.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            status.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 18),
            retry.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            retry.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 20)
        ])
        window.makeKeyAndOrderFront(nil)
        // The page uses focus events to refresh only while the window is active.
        window.makeFirstResponder(webView)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func beginStartup() {
        attempts = 0
        closing = false
        overlay.isHidden = false
        retry.isHidden = true
        status.stringValue = text("Starting Orbit …", "Orbit wird gestartet …")
        spinner.startAnimation(nil)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            DispatchQueue.main.async { self?.checkBackend() }
        }
        checkBackend()
    }

    private func checkBackend() {
        guard !probing && !closing else { return }
        probing = true
        attempts += 1
        var request = URLRequest(url: url.appendingPathComponent("api/health"))
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let health = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async {
                guard let self else { return }
                self.probing = false
                guard !self.closing else { return }
                if health?["app"] as? String == "Orbit" {
                    self.timer?.invalidate()
                    self.injectActionKey()
                    self.webView.load(URLRequest(url: self.url))
                } else if response != nil {
                    self.fail(self.text("Another service is using the Orbit address.", "Ein anderer Dienst verwendet die Orbit-Adresse."))
                } else if self.backend == nil {
                    self.launchBackend()
                } else if self.attempts >= 100 {
                    self.fail(self.text("Orbit could not start. Please try again.", "Orbit konnte nicht starten. Bitte erneut versuchen."))
                }
            }
        }.resume()
    }

    // Changes in the dashboard need the backend's private action key; reading stays open.
    private func injectActionKey() {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        let file = project.appendingPathComponent("data/action.key")
        guard let key = try? String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              key.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return }
        controller.addUserScript(WKUserScript(source: "window.orbitActionKey = \"\(key)\";", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let active = NSApp.isActive && window.isKeyWindow && !window.isMiniaturized
        controller.addUserScript(WKUserScript(source: "window.orbitWindowActive = \(active);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func launchBackend() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "OrbitPython") as! String)
        process.arguments = [project.appendingPathComponent("server.py").path, "--managed", "--parent-pid", String(ProcessInfo.processInfo.processIdentifier)]
        process.currentDirectoryURL = project
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path
        environment["PYTHONUNBUFFERED"] = "1"
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        do {
            let directory = project.appendingPathComponent("data")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let file = directory.appendingPathComponent("orbit.log")
            if !FileManager.default.fileExists(atPath: file.path) {
                FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            log = try FileHandle(forWritingTo: file)
            try log?.seekToEnd()
            process.standardOutput = log
            process.standardError = log
            process.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self, !self.closing else { return }
                    self.backend = nil
                    self.fail(self.text("The Orbit backend stopped. Please relaunch.", "Der Orbit-Dienst wurde beendet. Bitte erneut starten."))
                }
            }
            try process.run()
            backend = process
        } catch {
            fail(text("Orbit could not start. Check Python and the project directory.", "Orbit konnte nicht gestartet werden. Python und Projektverzeichnis prüfen."))
        }
    }

    private func fail(_ message: String) {
        timer?.invalidate()
        spinner.stopAnimation(nil)
        status.stringValue = message
        overlay.isHidden = false
        retry.isHidden = false
        if smokeTest {
            fputs("Orbit smoke test failed: \(message)\n", stderr)
            stopBackend()
            exit(1)
        }
    }

    private func stopBackend() {
        closing = true
        timer?.invalidate()
        if let process = backend {
            // --managed isolates the server and its collectors in a dedicated process group.
            // This also stops in-flight du, Git and SSH commands when the app quits.
            if kill(-process.processIdentifier, SIGTERM) != 0 && process.isRunning {
                process.terminate()
            }
        }
        backend = nil
        try? log?.close()
    }

    @objc private func reloadPage() {
        injectActionKey()
        webView.reload()
    }

    private func reportWindowActivity() {
        guard webView != nil else { return }
        let active = NSApp.isActive && window.isKeyWindow && !window.isMiniaturized
        webView.evaluateJavaScript("window.orbitWindowActive = \(active); window.dispatchEvent(new Event('orbit-activity'));")
    }

    func applicationDidBecomeActive(_ notification: Notification) { reportWindowActivity() }
    func applicationDidResignActive(_ notification: Notification) { reportWindowActivity() }
    func windowDidBecomeKey(_ notification: Notification) { reportWindowActivity() }
    func windowDidResignKey(_ notification: Notification) { reportWindowActivity() }
    func windowDidMiniaturize(_ notification: Notification) { reportWindowActivity() }
    func windowDidDeminiaturize(_ notification: Notification) { reportWindowActivity() }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { stopBackend() }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        overlay.isHidden = true
        reportWindowActivity()
        if smokeTest { checkUI() }
    }

    private func checkUI(_ remaining: Int = 160) {
        let storageMode = storageWrite ? "write" : storageRead ? "read" : ""
        let script = """
        (() => {
          const storageMode = "\(storageMode)";
          // A test-only marker verifies the real WebKit store across process exits.
          if (storageMode === 'write') {
            localStorage.setItem('orbit-native-storage-check', 'saved');
            return 'ok';
          }
          if (storageMode === 'read') {
            const restored = localStorage.getItem('orbit-native-storage-check') === 'saved';
            localStorage.removeItem('orbit-native-storage-check');
            return restored ? 'ok' : 'browser storage was lost on quit';
          }
          if (!document.querySelector('#project-table tbody .project-path')) return 'waiting';
          if (!/^[0-9a-f]{64}$/.test(window.orbitActionKey || '')) return 'missing action key';
          document.querySelector('nav [data-view="projects"]').click();
          const category = document.querySelector('[data-category]:not([data-category="all"])');
          if (category) category.click();
          return document.querySelector('#project-table tbody .name-button') ? 'ok' : 'filter failed';
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self else { return }
            if result as? String == "ok" {
                print("Orbit native smoke test passed: WebKit, project list, category buttons. Owned backend: \(self.backend != nil)")
                if self.storageWrite {
                    // Let WebKit finish its asynchronous localStorage disk checkpoint.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.terminate(nil) }
                } else {
                    NSApp.terminate(nil)
                }
            } else if (result as? String == "waiting" || error != nil) && remaining > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.checkUI(remaining - 1) }
            } else {
                self.fail(self.text("The dashboard interface could not be verified.", "Die Dashboard-Oberfläche konnte nicht geprüft werden."))
            }
        }
    }

    private func openExternal(_ url: URL) {
        if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url else { decisionHandler(.cancel); return }
        if target.scheme == "http" && target.host == "127.0.0.1" && target.port == 8765 {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            openExternal(target)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let target = action.request.url { openExternal(target) }
        return nil
    }
}


@main
struct OrbitMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = OrbitApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
