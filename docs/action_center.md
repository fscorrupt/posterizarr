# Action Center Guide

The **Action Center** is a central hub in the Posterizarr Web UI designed to help you review, manage, and fix issues with your media library assets (Posters, Backgrounds, Season Posters, and Title Cards).

Open it from **Asset Management > Asset Overview** in the left sidebar. After a
run, use its filters to find assets flagged for review; these are curation
suggestions, not necessarily failed jobs.

When Posterizarr runs, it tracks assets that don't meet your ideal configuration—such as missing high-quality sources, incorrect languages, or truncated text. These appear in the Action Center for your review.

---

## Summary Overview

At the top of the Action Center, you'll find summary cards that categorize the types of issues found:

| Card | Description |
| :--- | :--- |
| **Assets with Issues** | The total number of items that are currently "Unresolved" and require your attention. |
| **Missing Assets** | Items where no valid download source (URL) was found during the run. |
| **Missing Assets at Fav Provider** | Items that were found, but not at your preferred provider (e.g., you prefer TMDB but it was only found on Fanart.tv). |
| **Non-Primary Lang** | Assets that are using a language other than your primary preferred language (e.g., an 'it' poster when you prefer 'en'). |
| **Non-Primary Provider** | Assets sourced from a secondary provider instead of your top-tier choice. |
| **Truncated Text** | Items where the applied text (overlays) might have been cut off or looks suboptimal. |

---

## Understanding Asset Tags

Each asset in the list will have one or more tags explaining why it was flagged:

*   `Missing Asset`: No image source URL could be determined.
*   `Missing Link`: The favorite provider link is missing.
*   `Not Primary Provider`: The image comes from a provider lower in your search order.
*   `Logo: Not Primary Provider`: The logo (if applicable) is not from your preferred source.
*   `Logo: [LANG]`: The logo is in a specific language (e.g., Logo: DE).
*   `Logo: Text Fallback`: A text-based logo was generated because no graphical logo was found.
*   `Truncated`: The text on the asset is likely too long for the available space.

---

## Taking Action

For every asset, you have several options to resolve the alert:

### 1. Mark as Resolved / No Edits Needed
If you look at the asset and decide it is "good enough" or exactly what you want, click this button. 
*   **What it does**: Sets the asset status to "Resolved".
*   **Result**: It will no longer appear in the "Unresolved" list or count towards your "Assets with Issues" total.

### 2. Replace
If you don't like the current image, click **Replace**.
*   **What it does**: Opens the **Asset Replacer** window.
*   **Result**: You can manually search and pick a new image from all supported providers. Once replaced, the old alert is automatically cleared.

### 3. Delete (Trash Icon)
If you want to remove the tracking entry entirely.
*   **What it does**: Removes the record from the Posterizarr database.
*   **Result**: The asset will stop appearing in the Action Center until the next time the script identifies it as an issue.

---

## Bulk Actions

Managing hundreds of alerts can be tedious. Use the bulk action buttons at the top of the list:

*   **Select Page**: Selects all currently visible items on the page.
*   **Mark All Resolved**: Resolves all items matching your current filters.
*   **Delete All**: Deletes all items matching your current filters.

!!! tip "Filtering First"
    Use the search bar and dropdown filters (Type, Library, Category) to narrow down the list before using bulk actions. For example, you can filter for all "Title Cards" in your "Anime" library and mark them all as resolved at once.

---

## FAQ

### Why am I getting so many errors/alerts?
Don't panic! "Issues" in the Action Center aren't necessarily system failures. They are simply items where Posterizarr couldn't find a "perfect" match based on your settings (e.g., it found a Spanish poster but you wanted English). It's a tool for you to curate your library.

### Do I have to resolve everything?
No. Your media server will still work fine. The Action Center is there for perfectionists who want to ensure every single poster and logo is exactly right.

### I replaced an image but it still shows the old one in Plex.
Plex often caches images. You may need to "Refresh Metadata" for that specific item in Plex to see the change immediately.
