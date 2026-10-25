# Updating Fidra

Fidra can check for stable releases and download the correct installer in the background. It verifies the release announcement and the downloaded installer before offering it to you. Update checks do not send your ledger or Local Sync data anywhere.

## When an update is ready

1. Choose **Open installer** in the update notice or in **Settings → Updates**.
2. Confirm that you are ready to close Fidra. Finish or close any editing dialogs first.
3. Fidra finishes pending saves in all open windows and opens the verified installer. It stays open if a save fails or an unfinished transaction or invoice needs attention.
4. On a Mac, drag the new Fidra app into Applications and choose Replace. On Windows, follow the installer steps.
5. Reopen Fidra. It restores your previous ledger windows where the files are still available. Your ledgers, attachments, identity and Local Sync configuration stay in place.

This release opens the installer for you; it does not replace the app automatically. You can choose **Later** to postpone the notice for 24 hours. **Settings → Updates** always keeps the update controls available.

## Manual updates

Turn off **Download updates automatically** in Settings if you prefer manual checks. You can still choose **Check for updates** and **Download update** whenever you want.

Fidra checks after startup, every six hours while open, and after a long sleep. If the connection fails, keep working and retry later. Offline work never requires an update check.

## If something goes wrong

An unavailable release, failed verification, or interrupted download does not change your installed app or ledger. Retry from Settings. If the saved installer has changed, Fidra refuses to open it and offers a fresh download.

**Official downloads** opens the project's release page if you need to install manually. Older Fidra versions need one manual installation to gain this update experience. Installation warnings on unsigned releases are covered in [Install Notes](../setup/install-notes.md).
