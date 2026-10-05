# Frontend Components Architecture & Documentation

This document provides a technical overview of the React frontend architecture and components within Posterizarr's WebUI. The frontend is built using React (Vite) and styled with Tailwind CSS.

---

## Architecture Overview

The frontend follows a component-based architecture located entirely within `webui/frontend/src/`. It is structured to handle configuration management, live monitoring, media galleries, and triggering backend jobs.

### Directory Structure

- **`components/`**: Reusable React components that make up the UI (pages, modals, forms, galleries).
- **`context/`**: React Context providers for global state management (Theme, Auth, Sidebar, Toast notifications).
- **`locales/`**: Internationalization (i18n) translation files.
- **`utils/`**: Helper functions for API fetching, date formatting, and logging.

---

## Key Components (`src/components/`)

### Layout & Navigation


- **`App.jsx`**: The root component. Handles routing (React Router) and wraps the application in Context providers.
- **`Sidebar.jsx`**: The main side navigation menu.
- **`TopNavbar.jsx`**: The top bar, housing breadcrumbs, user profile, and version badges.
- **`Dashboard.jsx`**: The primary landing page. Aggregates statistics, recent assets, and quick-action buttons.

### Configuration & Settings


- **`ConfigEditor.jsx`**: A dynamic form component for editing the `config.json`. It fetches tooltips from the backend and handles schema validation.
- **`OnboardingModal.jsx`**: The comprehensive first-run setup wizard that guides users through configuring media servers, schedules, libraries, and notifications.
- **`RunModes.jsx`**: Interface for selecting and triggering the various Posterizarr PowerShell modes (Normal, Backup, Sync, etc.).
- **`SchedulerSettings.jsx`**: UI for managing cron jobs and automated schedules, supporting standard PowerShell execution modes as well as lightweight Python-based **Plex Sync** jobs with granular library selection and asset type toggles (collections, posters, seasons, title cards, backgrounds).
- **`Blueprints.jsx`**: Interface for managing layout blueprints and recipes.
- **`LanguageOrderSelector.jsx` & `LanguageSwitcher.jsx`**: Components to handle UI language switching and the priority order of downloaded asset languages.
- **`ProviderOrderSelector.jsx`**: Drag-and-drop interface allowing users to configure the precise fallback order for metadata providers (TMDB, TVDB, Fanart, Plex).
- **`LibraryExclusionSelector.jsx`**: An inline and modal selector used during onboarding and configuration to include or exclude specific libraries from being processed.

### Media & Assets Management

- **`AssetsManager.jsx` & `AssetOverview.jsx`**: High-level views for managing generated posters, local assets, and storage usage.
- **`RecentAssets.jsx`**: Dashboard carousel displaying recently processed assets with direct integration into `AssetReplacer` for instant correction.
- **`GalleryHub.jsx`, `Gallery.jsx`, `SeasonGallery.jsx`, `TitleCardGallery.jsx`, `TestGallery.jsx`**: Interactive grids displaying generated artwork with lazy loading, filtering, pagination, and detailed inspection.
- **`BackgroundsGallery.jsx`**: Specialized gallery for viewing and selecting background source images.
- **`ManualAssets.jsx` & `FolderView.jsx`**: Tree and grid explorer for user-provided images under `/manualassets` that override automated scrapers.
- **`BackupAssets.jsx`**: Gallery view for inspecting and managing original images preserved under `/assetsbackup`.
- **`ImagePreviewModal.jsx`**: A modal component to view full-resolution posters, EXIF metadata, and provider links.
- **`AssetReplacer.jsx`**: Deep inspection and replacement modal for swapping out posters or logos on the fly.
- **`AssetSearchModal.jsx`**: Provider search modal (TMDB, TVDB, Fanart) to find and apply replacement artwork or clearlogos by title or ID.
- **`LogoBrowser.jsx`**: Media server library browser for inspecting, filtering, and uploading missing ClearLogos directly to Plex, Jellyfin, or Emby.
- **`CollectionExplorer.jsx`**: Visual collection manager listing collections across connected media servers. Displays enriched collection metadata (item count and release year ranges, e.g. `12 items • 1979 - 2024`), Asset Details modal inspection (`ImagePreviewModal.jsx`), real-time diff status badges (`In Sync`, `Update Ready`, `Missing on Plex`, `No Local Asset`), quick diff view toggling (`LOCAL` vs `SERVER`), 1-click single-poster push to Plex, batch out-of-sync push, and status filtering.
- **`CollectionLiveEditor.jsx`**: Real-time interactive collection poster designer featuring linear/radial gradients, top/bottom matte fades, vignettes, tiled grain, border radius, typography alignment/drop shadows, preset thumbnails, and direct media server uploads.

### Monitoring & Status

- **`LogViewer.jsx`**: A real-time terminal-like component that connects to the backend WebSocket to stream Posterizarr execution logs.
- **`QueueView.jsx`**: Displays backend task queue states (running, pending, completed, failed) with abort controls.
- **`RuntimeStats.jsx` & `RuntimeHistory.jsx`**: Charts and tables displaying historical execution metrics, processing durations, and asset counts.
- **`SystemInfo.jsx`**: Displays host system resources (CPU, Memory, Alpine/Docker environment, versions).
- **`AssetsStats.jsx`**: Real-time counter widgets for library folders, poster counts, and total asset sizes.

### Integrations & Export

- **`PlexExport.jsx` & `JellyfinEmbyExport.jsx`**: Interfaces dedicated to managing metadata and artwork sync for specific media servers.
- **`AutoTriggers.jsx`**: UI to configure automated webhooks from Radarr, Sonarr, or Tautulli.
- **`PlexOAuthButton.jsx`**: Interactive OAuth component allowing users to log into Plex and automatically retrieve their server token.

### Utility, Feedback & Modal Components

- **`ConfirmDialog.jsx` & `ToastNotification.jsx`**: Reusable components for user feedback and destructive action confirmation.
- **`DangerZone.jsx`**: A section component for high-risk actions (factory reset, wipe database).
- **`RestoreModeModal.jsx`**: Targeted restore modal allowing users to restore artwork filtered by library, item title/folder, and asset type.
- **`ValidateButton.jsx`**: Triggers backend configuration validation (`CheckJson`) with status feedback.
- **`VersionBadge.jsx` & `ReleasesSection.jsx`**: Visual version indicators and GitHub release notes viewer.
- **`ImageSizeSlider.jsx` & `CompactImageSizeSlider.jsx`**: UI controls for adjusting the size of items in gallery grids.
- **`ScrollToButtons.jsx`**: Floating helper to quickly navigate to the top or bottom of extensive media libraries.

---

## Global State (`src/context/`)

- **`AuthContext.jsx`**: Manages user authentication tokens, basic auth states, and session persistence.
- **`ThemeContext.jsx`**: Toggles between light, dark, and system color palettes using Tailwind CSS variables.
- **`ToastContext.jsx`**: Exposes a hook (`useToast`) to fire non-blocking notification alerts throughout the UI.
- **`SidebarContext.jsx`**: Manages responsive expansion/collapse states for the navigation sidebar.
- **`DashboardLoadingContext.jsx`**: Coordinates startup loading transitions, dashboard data prefetching, and splash screens.

---

## Contribution Guidelines
When making a Pull Request to the React frontend:

- **Styling**: Always use Tailwind CSS utility classes. Avoid creating custom CSS in `index.css` unless absolutely necessary.
- **API Calls**: Use the pre-configured wrappers in `src/utils/fetchInterceptor.js` for API requests to ensure Auth headers and error handling are uniformly applied.
- **New Pages**: If you create a new page component, be sure to add the route in `App.jsx` and the navigation link in `Sidebar.jsx`.
- **Localization**: Do not hardcode user-facing strings. Use the `useTranslation` hook and add keys to the JSON files in `src/locales/`.
