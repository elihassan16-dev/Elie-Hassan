// The app's web view controller — registers Goldstone's own native plugins
// (the ones that live in this project instead of an npm package).
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TextComposePlugin())
    }
}
