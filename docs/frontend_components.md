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
- **`SchedulerSettings.jsx`**: UI for managing cron jobs and automated schedules.
- **`Blueprints.jsx`**: Interface for managing layout blueprints and recipes.
- **`LanguageOrderSelector.jsx` & `LanguageSwitcher.jsx`**: Components to handle UI language switching and the priority order of downloaded asset languages.
- **`ProviderOrderSelector.jsx`**: Drag-and-drop interface allowing users to configure the precise fallback order for metadata providers (TMDB, TVDB, Fanart, Plex).
- **`LibraryExclusionSelector.jsx`**: An inline and modal selector used during onboarding and configuration to include or exclude specific libraries from being processed.

### Media & Assets Management


- **`AssetsManager.jsx` & `AssetOverview.jsx`**: High-level views for managing generated posters, local assets, and storage usage.
- **`GalleryHub.jsx`, `Gallery.jsx`, `SeasonGallery.jsx`, `TitleCardGallery.jsx`**: Interactive grids displaying generated artwork. They handle lazy loading, filtering, and detailed inspection.
- **`ImagePreviewModal.jsx`**: A modal component to view full-resolution posters.
- **`AssetReplacer.jsx`**: Interface for manually overriding or replacing specific assets.
- **`LogoBrowser.jsx`**: A dedicated browser for exploring your media server libraries and checking for missing or existing clearlogos.
- **`LogoSearchModal.jsx`**: A search interface to fetch replacement clearlogos from providers (TMDB, TVDB, Fanart) via text or ID and upload them directly to the media server.
- **`BackgroundsGallery.jsx`**: Specialized gallery for viewing and selecting background source images.

### Monitoring & Status


- **`LogViewer.jsx`**: A real-time terminal-like component that connects to the backend WebSocket to stream Posterizarr execution logs.
- **`QueueView.jsx`**: Displays the status of backend tasks (running, pending, failed).
- **`RuntimeStats.jsx` & `RuntimeHistory.jsx`**: Charts and tables displaying historical execution data, durations, and success rates.
- **`SystemInfo.jsx`**: Displays host system resources (CPU, Memory, versions).

### Integrations & Export


- **`PlexExport.jsx` & `JellyfinEmbyExport.jsx`**: Interfaces dedicated to managing metadata and artwork sync for specific media servers.
- **`AutoTriggers.jsx`**: UI to configure webhooks from Radarr, Sonarr, or Tautulli.

### Utility & Feedback Components


- **`ConfirmDialog.jsx` & `ToastNotification.jsx`**: Reusable components for user feedback and destructive action confirmation.
- **`DangerZone.jsx`**: A section component for high-risk actions (factory reset, wipe database).
- **`ImageSizeSlider.jsx` & `CompactImageSizeSlider.jsx`**: UI controls for adjusting the size of items in gallery grids.

---

## Global State (`src/context/`)

- **`AuthContext.jsx`**: Manages user login tokens and session state.
- **`ThemeContext.jsx`**: Toggles between light and dark modes (or system default) using Tailwind classes.
- **`ToastContext.jsx`**: Exposes a hook (`useToast`) to fire non-blocking notification popups from anywhere in the app.
- **`SidebarContext.jsx`**: Manages the open/collapsed state of the navigation sidebar.

---

## Contribution Guidelines
When making a Pull Request to the React frontend:

- **Styling**: Always use Tailwind CSS utility classes. Avoid creating custom CSS in `index.css` unless absolutely necessary.
- **API Calls**: Use the pre-configured wrappers in `src/utils/fetchInterceptor.js` for API requests to ensure Auth headers and error handling are uniformly applied.
- **New Pages**: If you create a new page component, be sure to add the route in `App.jsx` and the navigation link in `Sidebar.jsx`.
- **Localization**: Do not hardcode user-facing strings. Use the `useTranslation` hook and add keys to the JSON files in `src/locales/`.
