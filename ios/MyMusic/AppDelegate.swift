import AVFoundation
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // .playback keeps audio going with the screen locked or the app in the background
        // (together with the "audio" background mode in Info.plist).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.backgroundColor = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1)
        w.makeKeyAndVisible()
        window = w
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        try? AVAudioSession.sharedInstance().setActive(true)
    }
}
