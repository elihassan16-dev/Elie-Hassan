// 📱 "Text from my phone" inside the Goldstone app (Elie 10/18/26): opens the
// iPhone's own Messages compose sheet over the app, prefilled, and tells the
// web code whether it was actually sent (so the thread only logs real texts).
import Foundation
import Capacitor
import MessageUI

@objc(TextComposePlugin)
public class TextComposePlugin: CAPPlugin, CAPBridgedPlugin, MFMessageComposeViewControllerDelegate {
    public let identifier = "TextComposePlugin"
    public let jsName = "TextCompose"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "canSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compose", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?

    @objc func canSend(_ call: CAPPluginCall) {
        call.resolve(["value": MFMessageComposeViewController.canSendText()])
    }

    @objc func compose(_ call: CAPPluginCall) {
        let to = (call.getArray("to") ?? []).compactMap { $0 as? String }
        let body = call.getString("body") ?? ""
        DispatchQueue.main.async {
            guard MFMessageComposeViewController.canSendText() else {
                call.reject("This phone can't send text messages.")
                return
            }
            let vc = MFMessageComposeViewController()
            vc.recipients = to
            vc.body = body
            vc.messageComposeDelegate = self
            self.pending = call
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    public func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) {
        controller.dismiss(animated: true)
        let value: String
        switch result {
        case .sent: value = "sent"
        case .cancelled: value = "cancelled"
        default: value = "failed"
        }
        pending?.resolve(["result": value])
        pending = nil
    }
}
