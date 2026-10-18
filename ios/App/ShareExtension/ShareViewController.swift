// 📤 "Share → Goldstone" (Elie 10/18/26). Photos / videos / files shared from
// any app are copied into the shared App Group folder, listed under
// "share-target-data" for @capgo/capacitor-share-target, and the app is opened
// (goldstone://share). The app then asks which property / job and what to do.
// If iOS doesn't let us open the app, it picks the share up the next time it
// comes to the screen.
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    let appGroupId = "group.com.gpflips.app"
    let appURL = "goldstone://share"
    private var files: [[String: Any]] = []
    private var texts: [String] = []
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.72, green: 0.58, blue: 0.25, alpha: 1)
        label.text = "Sending to Goldstone…"
        label.textColor = .white
        label.font = .systemFont(ofSize: 18, weight: .semibold)
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
        Task { await collect() }
    }

    private func folder() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }
        let dir = base.appendingPathComponent("shared", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func collect() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        guard let dir = folder() else { finish(opened: false); return }
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.vCard.identifier) {
                    // A contact shared from the Contacts app → saved as a .vcf for the app's "Add to Contacts".
                    let data: Data? = await withCheckedContinuation { cont in
                        _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.vCard.identifier) { d, _ in cont.resume(returning: d) }
                    }
                    if let data = data {
                        let dest = dir.appendingPathComponent(UUID().uuidString + ".vcf")
                        if (try? data.write(to: dest)) != nil { add(dest, name: (provider.suggestedName ?? "Contact") + ".vcf", mime: "text/vcard") }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                    await copy(provider, UTType.movie, into: dir, fallbackMime: "video/mp4")
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    await copy(provider, UTType.image, into: dir, fallbackMime: "image/jpeg")
                } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                    await copy(provider, UTType.pdf, into: dir, fallbackMime: "application/pdf")
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                        if url.isFileURL { await copyFile(url, into: dir, mime: mimeFor(url.pathExtension)) } else { texts.append(url.absoluteString) }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let s = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { texts.append(s) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
                    await copy(provider, UTType.data, into: dir, fallbackMime: "application/octet-stream")
                }
            }
        }
        let data: [String: Any] = ["title": "", "texts": texts, "files": files]
        let defaults = UserDefaults(suiteName: appGroupId)
        defaults?.set(data, forKey: "share-target-data")
        defaults?.synchronize()
        let opened = open(URL(string: appURL)!)
        finish(opened: opened)
    }

    // Photos may hand over a file, or (screenshots, some apps) just an image.
    private func copy(_ provider: NSItemProvider, _ type: UTType, into dir: URL, fallbackMime: String) async {
        let done: Bool = await withCheckedContinuation { cont in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url = url else { cont.resume(returning: false); return }
                let ok = self.copyNow(url, into: dir, mime: self.mimeFor(url.pathExtension, fallback: fallbackMime), name: provider.suggestedName)
                cont.resume(returning: ok)
            }
        }
        if done || type != UTType.image { return }
        if let img = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) as? UIImage, let jpg = img.jpegData(compressionQuality: 0.9) {
            let dest = dir.appendingPathComponent(UUID().uuidString + ".jpg")
            if (try? jpg.write(to: dest)) != nil { add(dest, name: (provider.suggestedName ?? "photo") + ".jpg", mime: "image/jpeg") }
        }
    }
    private func copyFile(_ url: URL, into dir: URL, mime: String) async {
        let access = url.startAccessingSecurityScopedResource()
        _ = copyNow(url, into: dir, mime: mime, name: nil)
        if access { url.stopAccessingSecurityScopedResource() }
    }
    private func copyNow(_ url: URL, into dir: URL, mime: String, name: String?) -> Bool {
        let ext = url.pathExtension.isEmpty ? "" : "." + url.pathExtension
        let dest = dir.appendingPathComponent(UUID().uuidString + ext)
        do { try FileManager.default.copyItem(at: url, to: dest) } catch { return false }
        var nice = url.lastPathComponent
        if let n = name, !n.isEmpty { nice = n.hasSuffix(ext) ? n : n + ext }
        add(dest, name: nice, mime: mime)
        return true
    }
    private func add(_ dest: URL, name: String, mime: String) {
        files.append(["uri": dest.absoluteString, "name": name, "mimeType": mime])
    }
    private func mimeFor(_ ext: String, fallback: String = "application/octet-stream") -> String {
        if let t = UTType(filenameExtension: ext.lowercased()), let m = t.preferredMIMEType { return m }
        return fallback
    }

    // Extensions can't call UIApplication.shared — walk the responder chain to it.
    private func open(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        let sel = sel_registerName("openURL:options:completionHandler:")
        while let r = responder {
            if let app = r as? UIApplication, app.responds(to: sel) {
                typealias OpenFn = @convention(c) (AnyObject, Selector, URL, NSDictionary, Any?) -> Void
                let fn = unsafeBitCast(app.method(for: sel), to: OpenFn.self)
                fn(app, sel, url, NSDictionary(), nil)
                return true
            }
            responder = r.next
        }
        return false
    }

    private func finish(opened: Bool) {
        DispatchQueue.main.async {
            if !opened { self.label.text = "Saved — open Goldstone to finish." }
            DispatchQueue.main.asyncAfter(deadline: .now() + (opened ? 0.3 : 1.4)) {
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        }
    }
}
