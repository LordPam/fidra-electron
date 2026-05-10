# Install Notes

These notes explain what to expect when installing Fidra outside an app store.

## What to Expect

Fidra is distributed directly rather than through the Mac App Store or Microsoft Store.

That means first-run verification can be stricter than for store-installed apps, especially when:

- the macOS build is not yet Developer ID signed and notarized
- the Windows build is new and has little SmartScreen reputation yet

This does not automatically mean the app is unsafe. It means the operating system has less prior trust information to work with.

## Official Download Source

If you are installing Fidra, download it from the club's official release link or the official GitHub releases page for the project.

If you are not sure whether a download is official, stop there and confirm before opening it.

## macOS

### What macOS may show

macOS can warn when an app:

- is from an unidentified developer
- is not notarized
- cannot be checked the same way as a store or fully verified app

For current official Apple guidance, see:

- [Open a Mac app from an unknown developer](https://support.apple.com/en-gb/guide/mac-help/-mh40616/mac)
- [Safely open apps on your Mac](https://support.apple.com/en-gb/102445)

### What this means for Fidra

If the current build is not yet fully Apple-verified, the normal pattern is:

1. try opening the app once
2. macOS blocks it
3. go to `System Settings -> Privacy & Security`
4. use the option to open it anyway, if you trust the source

After that first approval, macOS usually remembers the exception for that app.

### Do not do this casually

Only override the warning if:

- you expected to install Fidra
- you downloaded it from the official source
- the file has not been modified or repackaged by someone else

If you are installing on a managed organisation Mac, an admin policy may block this entirely.

## Windows

### What Windows may show

Windows may show Microsoft Defender SmartScreen warnings for:

- unsigned downloads
- unrecognized apps
- newly built apps with little download history

Background references:

- [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [App & browser control in the Windows Security app](https://support.microsoft.com/en-us/windows/app-browser-control-in-the-windows-security-app-8f68fb65-ebb4-3cfb-4bd7-ef0f376f3dc3)

### What this means for Fidra

If a Windows build is new or not yet well established, SmartScreen may warn even when the file is legitimate.

Typical user-facing outcomes are:

- a browser download warning
- a SmartScreen "unrecognized app" prompt when launching

If you trust the source, Windows often allows you to continue through the warning flow.

If you are on a managed machine, your organisation may block that override.

## If the App Still Will Not Open

Check these in order:

1. make sure you downloaded the correct package for your platform
2. re-download the installer from the official release source
3. check whether your machine is managed by school, work, or IT policy
4. on macOS, re-check `Privacy & Security`
5. on Windows, check whether SmartScreen or another security policy is blocking the run

## Current Practical Advice for Clubs

- Do the first install on a personal or committee-controlled machine, not a heavily locked-down lab or corporate device.
- Keep a short internal note of the expected first-run behavior for your committee.
- If the club is onboarding several officers, have one person test the exact installer first and document the screens they saw.

## This Page Is About First-Run Trust, Not Updates

These notes are about the first install experience.

Once Fidra has:

- stronger signing/notarization on macOS
- stronger reputation or signing on Windows

the warning experience can become less prominent.
