import MediaPlayer
import UIKit
import WebKit

/// My Music: a thin native shell around https://bot.text.bz/listen.
/// The web player does everything; the shell adds background playback,
/// lock-screen / Control Centre / headset controls and a Safari hand-off
/// for any link that is not the player itself.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private static let host = "bot.text.bz"
    private static let home = URL(string: "https://bot.text.bz/listen")!
    private var web: WKWebView!
    private var artTask: URLSessionDataTask?
    private var artURL: String = ""
    private var artwork: MPMediaItemArtwork?

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        // Same contract as the Android app: window.AndroidMusic.state(playing, title, artist, cover).
        let shim = """
        window.AndroidMusic = { state: function (p, t, a, c) { window.webkit.messageHandlers.music.postMessage({ playing: !!p, title: t || '', artist: a || '', cover: c || '' }); } };
        """
        cfg.userContentController.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController.add(self, name: "music")

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true // the web app closes sheets/pages on history back
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.backgroundColor = view.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        setupRemoteCommands()
        web.load(URLRequest(url: Self.home))
    }

    // MARK: web -> native

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "music", let d = message.body as? [String: Any] else { return }
        let playing = d["playing"] as? Bool ?? false
        let title = d["title"] as? String ?? ""
        let artist = d["artist"] as? String ?? ""
        let cover = d["cover"] as? String ?? ""
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title.isEmpty ? "My Music" : title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
        if let art = artwork, cover == artURL { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = title.isEmpty ? nil : info
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
        if !cover.isEmpty && cover != artURL { loadArtwork(cover, title: title, artist: artist, playing: playing) }
    }

    private func loadArtwork(_ url: String, title: String, artist: String, playing: Bool) {
        artURL = url
        artwork = nil
        artTask?.cancel()
        guard let u = URL(string: url) else { return }
        artTask = URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
            guard let self, let data, let image = UIImage(data: data), self.artURL == url else { return }
            let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                self.artwork = art
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = art
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artTask?.resume()
    }

    // MARK: native -> web

    private func send(_ cmd: String) {
        web.evaluateJavaScript("window.__nativeCmd&&window.__nativeCmd('\(cmd)')", completionHandler: nil)
    }

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.send("play"); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.send("pause"); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.send("toggle"); return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.send("next"); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.send("prev"); return .success }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.allow); return }
        if url.scheme == "https", url.host == Self.host { decisionHandler(.allow); return }
        if ["about", "blob", "data"].contains(url.scheme ?? "") { decisionHandler(.allow); return }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // window.open / target=_blank → same view for our own pages, Safari for everything else.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == Self.host { webView.load(URLRequest(url: url)) } else { UIApplication.shared.open(url) }
        }
        return nil
    }
}
