# Shared Folders in OneDrive and SharePoint

Back to [Docs Index](../README.md)

This page exists because Local Sync needs a real folder on your computer, not just a folder you can see in a browser tab.

That distinction is easy to miss.

## What Fidra Needs

For Local Sync, Fidra needs a folder that:

- appears in Finder or File Explorer
- stays synced by OneDrive
- behaves like a normal local folder path when you select it in Fidra

A folder that only exists on `onedrive.com` or in a SharePoint web page is not enough on its own.

## The Key Idea

You are not trying to give Fidra a website.

You are trying to give Fidra a local path that OneDrive keeps in sync with the cloud behind the scenes.

## Typical Working Setup

The common pattern is:

1. install and sign in to the OneDrive desktop app
2. make the shared folder appear in your OneDrive locally
3. confirm the folder shows up in Finder or File Explorer
4. choose that local folder in Fidra as the Local Sync folder

## If the Folder Was Shared With You

If someone shared a folder with you directly, the usual route is:

1. open OneDrive on the web
2. go to `Shared` or `Shared > With you`
3. find the shared folder
4. choose `Add shortcut to My files`
5. let OneDrive sync it to your computer

Microsoft's guidance for this flow:

- [Add shortcuts to shared folders in OneDrive](https://support.microsoft.com/en-gb/office/add-shortcuts-to-shared-folders-in-onedrive-d66b1347-99b7-4470-9360-ffc048d35a33)

## If It Is a SharePoint Library or Team Files Area

If the folder lives in a SharePoint document library or a Team's Files area, the common routes are:

1. use `Add shortcut to My files` for the folder or library
2. or use `Sync` from the SharePoint library

Microsoft's guidance for this flow:

- [Sync SharePoint files and folders](https://support.microsoft.com/en-us/office/sync-sharepoint-files-and-folders-87a96948-4dd7-43e4-aca1-53f3e18bea9b)

## How To Check That It Worked

### On Windows

Open File Explorer and look for the synced location under your OneDrive or organisation area.

Microsoft reference:

- [Work with synced files in File Explorer](https://support.microsoft.com/en-us/office/work-with-synced-files-in-file-explorer-8d9b1c45-4a3f-4fa8-a55b-fd0635e77d4d)

### On macOS

Open Finder and confirm the folder appears through OneDrive Finder integration.

Microsoft reference:

- [Sync files with OneDrive on macOS](https://support.microsoft.com/en-us/office/sync-files-with-onedrive-on-macos-d11b9f29-00bb-4172-be39-997da46f913f)

## What You Should Hand To Fidra

In Fidra, choose the actual local synced folder path.

Examples:

```text
/Users/your-name/Library/CloudStorage/OneDrive-Organisation/Fidra Sync
```

or on Windows:

```text
C:\Users\YourName\Organisation\Fidra Sync
```

The exact path name can vary. That is fine.

What matters is that it is a real local folder kept in sync by OneDrive.

## Common Mistakes

### Mistake 1: using a browser URL

If you are looking at a SharePoint or OneDrive web address and thinking "this is the folder", you are still one step too early.

Fidra needs the synced local version of that folder.

### Mistake 2: using the wrong subfolder

Once synced, choose the real Local Sync root, not one of Fidra's transport subfolders.

You want the parent that contains:

```text
sync/
snapshots/
attachments/
invites/
```

### Mistake 3: assuming everyone sees the exact same path

Different users can have different local path names.

That is normal.

They do not need identical path strings. They need local folders that are all synced to the same shared content.

## If OneDrive Adds a Web Shortcut Instead of a Real Folder

Microsoft currently notes that some shared-folder shortcuts can temporarily appear as `.url` internet shortcuts instead of as real folders.

If that happens:

- the shortcut may open a webpage instead of a local folder
- Fidra cannot use that as a Local Sync folder

Practical next steps:

1. try the SharePoint `Sync` route instead of only the shortcut route
2. confirm OneDrive has finished syncing
3. check whether the folder now appears as a normal local folder in Finder or File Explorer

## Recommended Club Instruction

If your club expects people to use OneDrive or SharePoint for Local Sync, write the instruction like this:

`Use the shared OneDrive/SharePoint folder only after it appears as a local folder in Finder or File Explorer.`

That is much clearer than just saying "use the SharePoint folder".
