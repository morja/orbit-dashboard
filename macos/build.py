#!/usr/bin/env python3
"""Build and install the local Orbit macOS window around the existing dashboard."""
from pathlib import Path
import argparse
import plistlib
import shutil
import subprocess
import tempfile
import sys


APP = Path(__file__).resolve().parents[1]
DESTINATION = Path.home() / "Applications/Orbit Dashboard.app"
BUNDLE_ID = "one.tearoom.orbit"


def icon(output):
    # Render the existing Orbit mark with macOS's vector drawing tools.
    source = r'''
import AppKit
let set = CommandLine.arguments[1]
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let n = CGFloat(size)
    NSColor(calibratedRed: 0.149, green: 0.247, blue: 0.212, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: n, height: n), xRadius: n * 0.28, yRadius: n * 0.28).fill()
    NSColor(calibratedRed: 0.918, green: 0.941, blue: 0.898, alpha: 1).setStroke()
    let ring = NSBezierPath(ovalIn: NSRect(x: n * 0.235, y: n * 0.235, width: n * 0.53, height: n * 0.53))
    ring.lineWidth = n * 0.078
    ring.stroke()
    NSColor(calibratedRed: 0.745, green: 0.843, blue: 0.588, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: n * 0.656, y: n * 0.609, width: n * 0.188, height: n * 0.188)).fill()
    image.unlockFocus()
    let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
    let png = bitmap.representation(using: .png, properties: [:])!
    if size <= 512 { try png.write(to: URL(fileURLWithPath: "\(set)/icon_\(size)x\(size).png")) }
    if size >= 32 { try png.write(to: URL(fileURLWithPath: "\(set)/icon_\(size / 2)x\(size / 2)@2x.png")) }
}
'''
    swift = output.parent / "Icon.swift"
    swift.write_text(source)
    iconset = output.parent / "Orbit.iconset"
    iconset.mkdir()
    subprocess.run(["xcrun", "swift", str(swift), str(iconset)], check=True)
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(output)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DESTINATION,
                        help='Install location, useful for isolated release verification')
    destination = parser.parse_args().output.expanduser().resolve()
    if destination.exists():
        info = plistlib.loads((destination / "Contents/Info.plist").read_bytes())
        if info.get("CFBundleIdentifier") != BUNDLE_ID:
            raise SystemExit("Another app with this name already exists and is preserved.")
    python = Path(sys.executable).resolve()
    if sys.version_info < (3, 10):
        raise SystemExit("Orbit requires Python 3.10 or newer.")
    with tempfile.TemporaryDirectory(prefix="orbit-build-") as directory:
        staging = Path(directory)
        bundle = staging / "Orbit Dashboard.app"
        contents = bundle / "Contents"
        binary = contents / "MacOS/Orbit"
        binary.parent.mkdir(parents=True)
        resources = contents / "Resources"
        resources.mkdir()
        subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-swift-version", "5", "-O", "-framework", "AppKit", "-framework", "WebKit", str(APP / "macos/Orbit.swift"), "-o", str(binary)], check=True)
        icon(resources / "Orbit.icns")
        info = {
            "CFBundleIdentifier": BUNDLE_ID,
            "CFBundleName": "Orbit Dashboard",
            "CFBundleDisplayName": "Orbit Dashboard",
            "CFBundleExecutable": "Orbit",
            "CFBundlePackageType": "APPL",
            "CFBundleVersion": "1",
            "CFBundleShortVersionString": "1.0",
            "CFBundleIconFile": "Orbit",
            "NSHighResolutionCapable": True,
            "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
            "OrbitProjectDirectory": str(APP),
            "OrbitPython": str(python),
        }
        (contents / "Info.plist").write_bytes(plistlib.dumps(info))
        subprocess.run(["codesign", "--force", "--sign", "-", str(bundle)], check=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Compilation completes before replacing a previous Orbit build.
        backup = staging / "Previous.app"
        if destination.exists():
            destination.rename(backup)
        try:
            shutil.copytree(bundle, destination)
        except Exception:
            if destination.exists():
                shutil.rmtree(destination)
            if backup.exists():
                backup.rename(destination)
            raise
    subprocess.run(["/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", str(destination)], check=True)
    print("Installed:", destination)


if __name__ == "__main__":
    main()
