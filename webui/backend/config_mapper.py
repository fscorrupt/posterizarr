"""
Config Mapper - Transforms between grouped and flat config structures
Author: Posterizarr

Usage in Backend:
    from config_mapper import flatten_config, unflatten_config, get_display_name, get_tooltip

    # When loading config
    grouped_config = json.load(f)
    flat_config = flatten_config(grouped_config)

    # When saving config
    grouped_config = unflatten_config(flat_config)
    json.dump(grouped_config, f)

    # Get tooltip for a config key
    tooltip = get_tooltip("tmdbtoken")
"""

import logging

logger = logging.getLogger(__name__)

# Tooltips are now handled in the frontend (ConfigEditor.jsx) with multi-language support
CONFIG_TOOLTIPS = {}


# =============================================================================
# ORIGINAL KEY MAPPINGS - Preserves exact case from config.json
# =============================================================================

ORIGINAL_KEYS = {
    # PosterOverlayPart
    "PosterFontAllCaps": "fontAllCaps",
    "PosterAddBorder": "AddBorder",
    "PosterAddText": "AddText",
    "PosterAddTextStroke": "AddTextStroke",
    "PosterStrokecolor": "strokecolor",
    "PosterStrokewidth": "strokewidth",
    "PosterAddOverlay": "AddOverlay",
    "PosterFontcolor": "fontcolor",
    "PosterBordercolor": "bordercolor",
    "PosterMinPointSize": "minPointSize",
    "PosterMaxPointSize": "maxPointSize",
    "PosterBorderwidth": "borderwidth",
    "PosterMaxWidth": "MaxWidth",
    "PosterMaxHeight": "MaxHeight",
    "PosterTextOffset": "text_offset",
    "PosterLineSpacing": "lineSpacing",
    "PosterTextGravity": "TextGravity",
    # SeasonPosterOverlayPart
    "SeasonPosterFontAllCaps": "fontAllCaps",
    "SeasonPosterShowFallback": "ShowFallback",
    "SeasonPosterOverrideSeasonName": "OverrideSeasonName",
    "SeasonPosterSeasonOverrideText": "SeasonOverrideText",
    "SeasonPosterSpecialSeasonOverrideText": "SpecialSeasonOverrideText",
    "SeasonPosterAddBorder": "AddBorder",
    "SeasonPosterAddText": "AddText",
    "SeasonPosterAddTextStroke": "AddTextStroke",
    "SeasonPosterStrokecolor": "strokecolor",
    "SeasonPosterStrokewidth": "strokewidth",
    "SeasonPosterAddOverlay": "AddOverlay",
    "SeasonPosterFontcolor": "fontcolor",
    "SeasonPosterBordercolor": "bordercolor",
    "SeasonPosterMinPointSize": "minPointSize",
    "SeasonPosterMaxPointSize": "maxPointSize",
    "SeasonPosterBorderwidth": "borderwidth",
    "SeasonPosterMaxWidth": "MaxWidth",
    "SeasonPosterMaxHeight": "MaxHeight",
    "SeasonPosterTextOffset": "text_offset",
    "SeasonPosterLineSpacing": "lineSpacing",
    "SeasonPosterTextGravity": "TextGravity",
    # BackgroundOverlayPart
    "BackgroundFontAllCaps": "fontAllCaps",
    "BackgroundAddOverlay": "AddOverlay",
    "BackgroundAddBorder": "AddBorder",
    "BackgroundAddText": "AddText",
    "BackgroundAddTextStroke": "AddTextStroke",
    "BackgroundStrokecolor": "strokecolor",
    "BackgroundStrokewidth": "strokewidth",
    "BackgroundFontcolor": "fontcolor",
    "BackgroundBordercolor": "bordercolor",
    "BackgroundMinPointSize": "minPointSize",
    "BackgroundMaxPointSize": "maxPointSize",
    "BackgroundBorderwidth": "borderwidth",
    "BackgroundMaxWidth": "MaxWidth",
    "BackgroundMaxHeight": "MaxHeight",
    "BackgroundTextOffset": "text_offset",
    "BackgroundLineSpacing": "lineSpacing",
    "BackgroundTextGravity": "TextGravity",
    # TitleCardOverlayPart
    "TitleCardUseBackgroundAsTitleCard": "UseBackgroundAsTitleCard",
    "TitleCardBackgroundFallback": "BackgroundFallback",
    "TitleCardAddOverlay": "AddOverlay",
    "TitleCardAddBorder": "AddBorder",
    "TitleCardBordercolor": "bordercolor",
    "TitleCardBorderwidth": "borderwidth",
    "TitleCardSkipWords": "SkipWords",
    # TitleCardTitleTextPart
    "TitleCardTitleFontAllCaps": "fontAllCaps",
    "TitleCardTitleAddEPTitleText": "AddEPTitleText",
    "TitleCardTitleAddTextStroke": "AddTextStroke",
    "TitleCardTitleStrokecolor": "strokecolor",
    "TitleCardTitleStrokewidth": "strokewidth",
    "TitleCardTitleFontcolor": "fontcolor",
    "TitleCardTitleMinPointSize": "minPointSize",
    "TitleCardTitleMaxPointSize": "maxPointSize",
    "TitleCardTitleMaxWidth": "MaxWidth",
    "TitleCardTitleMaxHeight": "MaxHeight",
    "TitleCardTitleTextOffset": "text_offset",
    "TitleCardTitleLineSpacing": "lineSpacing",
    "TitleCardTitleTextGravity": "TextGravity",
    # TitleCardEPTextPart
    "TitleCardEPSeasonTCText": "SeasonTCText",
    "TitleCardEPEpisodeTCText": "EpisodeTCText",
    "TitleCardEPFontAllCaps": "fontAllCaps",
    "TitleCardEPAddEPText": "AddEPText",
    "TitleCardEPAddTextStroke": "AddTextStroke",
    "TitleCardEPStrokecolor": "strokecolor",
    "TitleCardEPStrokewidth": "strokewidth",
    "TitleCardEPFontcolor": "fontcolor",
    "TitleCardEPMinPointSize": "minPointSize",
    "TitleCardEPMaxPointSize": "maxPointSize",
    "TitleCardEPMaxWidth": "MaxWidth",
    "TitleCardEPMaxHeight": "MaxHeight",
    "TitleCardEPTextOffset": "text_offset",
    "TitleCardEPLineSpacing": "lineSpacing",
    "TitleCardEPTextGravity": "TextGravity",
    # ShowTitleOnSeasonPosterPart
    "ShowTitleAddShowTitletoSeason": "AddShowTitletoSeason",
    "ShowTitleFontAllCaps": "fontAllCaps",
    "ShowTitleAddTextStroke": "AddTextStroke",
    "ShowTitleStrokecolor": "strokecolor",
    "ShowTitleStrokewidth": "strokewidth",
    "ShowTitleFontcolor": "fontcolor",
    "ShowTitleMinPointSize": "minPointSize",
    "ShowTitleMaxPointSize": "maxPointSize",
    "ShowTitleMaxWidth": "MaxWidth",
    "ShowTitleMaxHeight": "MaxHeight",
    "ShowTitleTextOffset": "text_offset",
    "ShowTitleLineSpacing": "lineSpacing",
    "ShowTitleTextGravity": "TextGravity",
    # CollectionTitlePosterPart
    "CollectionTitleAddCollectionTitle": "AddCollectionTitle",
    "CollectionTitleCollectionTitle": "CollectionTitle",
    "CollectionTitleFontAllCaps": "fontAllCaps",
    "CollectionTitleAddTextStroke": "AddTextStroke",
    "CollectionTitleStrokecolor": "strokecolor",
    "CollectionTitleStrokewidth": "strokewidth",
    "CollectionTitleFontcolor": "fontcolor",
    "CollectionTitleMinPointSize": "minPointSize",
    "CollectionTitleMaxPointSize": "maxPointSize",
    "CollectionTitleMaxWidth": "MaxWidth",
    "CollectionTitleMaxHeight": "MaxHeight",
    "CollectionTitleTextOffset": "text_offset",
    "CollectionTitleLineSpacing": "lineSpacing",
    "CollectionTitleTextGravity": "TextGravity",
    # CollectionPosterOverlayPart
    "CollectionPosterFontAllCaps": "fontAllCaps",
    "CollectionPosterAddBorder": "AddBorder",
    "CollectionPosterAddText": "AddText",
    "CollectionPosterAddTextStroke": "AddTextStroke",
    "CollectionPosterStrokecolor": "strokecolor",
    "CollectionPosterStrokewidth": "strokewidth",
    "CollectionPosterAddOverlay": "AddOverlay",
    "CollectionPosterFontcolor": "fontcolor",
    "CollectionPosterBordercolor": "bordercolor",
    "CollectionPosterMinPointSize": "minPointSize",
    "CollectionPosterMaxPointSize": "maxPointSize",
    "CollectionPosterBorderwidth": "borderwidth",
    "CollectionPosterMaxWidth": "MaxWidth",
    "CollectionPosterMaxHeight": "MaxHeight",
    "CollectionPosterTextOffset": "text_offset",
    "CollectionPosterLineSpacing": "lineSpacing",
    "CollectionPosterTextGravity": "TextGravity",
}


# =============================================================================
# HELPER FUNCTIONS FOR CASE CONVERSION
# =============================================================================


def snake_to_pascal(snake_str):
    """
    Convert snake_case to PascalCase: text_offset -> TextOffset
    """
    if not snake_str or "_" not in snake_str:
        return snake_str
    components = snake_str.split("_")
    return "".join(word.capitalize() for word in components)


def apply_prefix_with_conversion(prefix, key):
    """
    Apply prefix and convert key if necessary.

    Examples:
        ("Poster", "text_offset") -> "PosterTextOffset"
        ("Poster", "AddBorder") -> "PosterAddBorder"
        ("Poster", "fontAllCaps") -> "PosterFontAllCaps"
    """
    # Convert snake_case to PascalCase
    if "_" in key:
        key = snake_to_pascal(key)

    # Ensure first letter is capitalized
    if key and key[0].islower():
        key = key[0].upper() + key[1:]

    return f"{prefix}{key}"


def remove_prefix_with_original_case(flat_key):
    """
    Remove prefix and restore original case from ORIGINAL_KEYS mapping.

    Examples:
        "PosterTextOffset" -> "text_offset"
        "PosterAddBorder" -> "AddBorder"
        "PosterTextGravity" -> "TextGravity"
    """
    # Check if we have the exact mapping
    if flat_key in ORIGINAL_KEYS:
        return ORIGINAL_KEYS[flat_key]

    # Fallback: try to infer the original key
    # This should rarely be needed if ORIGINAL_KEYS is complete
    logger.warning(f"No mapping found for '{flat_key}', using fallback logic")

    # Try to find the prefix
    for prefix in [
        "CollectionPoster",
        "CollectionTitle",
        "SeasonPoster",
        "TitleCardTitle",
        "TitleCardEP",
        "TitleCard",
        "ShowTitle",
        "Background",
        "Poster",
    ]:
        if flat_key.startswith(prefix):
            storage_key = flat_key[len(prefix) :]
            # Just lowercase first letter as fallback
            if storage_key:
                return storage_key[0].lower() + storage_key[1:]
            return storage_key

    return flat_key


# =============================================================================
# CONFIG GROUPS MAPPING
# =============================================================================

# Complete mapping of all config variables to their groups
CONFIG_GROUPS = {
    # WebUI Settings
    "basicAuthEnabled": "WebUI",
    "basicAuthUsername": "WebUI",
    "basicAuthPassword": "WebUI",
    # ApiPart
    "tvdbapi": "ApiPart",
    "tmdbtoken": "ApiPart",
    "FanartTvAPIKey": "ApiPart",
    "PlexToken": "ApiPart",
    "FavProvider": "ApiPart",
    "OverrideProviderOrder": "ApiPart",
    "ProviderOrder": "ApiPart",
    "PreferredLanguageOrder": "ApiPart",
    "PreferredSeasonLanguageOrder": "ApiPart",
    "LogoLanguageOrder": "ApiPart",
    "tmdb_vote_sorting": "ApiPart",
    "WidthHeightFilter": "ApiPart",
    "PosterMinWidth": "ApiPart",
    "PosterMinHeight": "ApiPart",
    "BgTcMinWidth": "ApiPart",
    "BgTcMinHeight": "ApiPart",
    "JellyfinAPIKey": "ApiPart",
    "EmbyAPIKey": "ApiPart",
    "PreferredBackgroundLanguageOrder": "ApiPart",
    "PreferredTCLanguageOrder": "ApiPart",
    "LibraryLanguageOverrides": "ApiPart",
    # PlexPart
    "PlexLibstoExclude": "PlexPart",
    "PlexUrl": "PlexPart",
    "UsePlex": "PlexPart",
    "PlexUploadExistingAssets": "PlexPart",
    # JellyfinPart
    "JellyfinLibstoExclude": "JellyfinPart",
    "JellyfinUrl": "JellyfinPart",
    "UseJellyfin": "JellyfinPart",
    "JellyfinUploadExistingAssets": "JellyfinPart",
    "JellyfinReplaceThumbwithBackdrop": "JellyfinPart",
    # EmbyPart
    "EmbyLibstoExclude": "EmbyPart",
    "EmbyUrl": "EmbyPart",
    "UseEmby": "EmbyPart",
    "EmbyUploadExistingAssets": "EmbyPart",
    "EmbyReplaceThumbwithBackdrop": "EmbyPart",
    # Notification
    "SendNotification": "Notification",
    "AppriseUrl": "Notification",
    "Discord": "Notification",
    "UseUptimeKuma": "Notification",
    "UptimeKumaUrl": "Notification",
    "DiscordUserName": "Notification",
    # PrerequisitePart
    "AssetPath": "PrerequisitePart",
    "FileTestOnTrigger": "PrerequisitePart",
    "show_skipped": "PrerequisitePart",
    "magickinstalllocation": "PrerequisitePart",
    "maxLogs": "PrerequisitePart",
    "logLevel": "PrerequisitePart",
    "font": "PrerequisitePart",
    "backgroundfont": "PrerequisitePart",
    "titlecardfont": "PrerequisitePart",
    "overlayfile": "PrerequisitePart",
    "backgroundoverlayfile": "PrerequisitePart",
    "showoverlayfile": "PrerequisitePart",
    "showbackgroundoverlayfile": "PrerequisitePart",
    "titlecardoverlayfile": "PrerequisitePart",
    "LibraryFolders": "PrerequisitePart",
    "Posters": "PrerequisitePart",
    "SeasonPosters": "PrerequisitePart",
    "BackgroundPosters": "PrerequisitePart",
    "TitleCards": "PrerequisitePart",
    "SkipTBA": "PrerequisitePart",
    "SkipJapTitle": "PrerequisitePart",
    "AssetCleanup": "PrerequisitePart",
    "AutoUpdateIM": "PrerequisitePart",
    "seasonoverlayfile": "PrerequisitePart",
    "RTLFont": "PrerequisitePart",
    "NewLineOnSpecificSymbols": "PrerequisitePart",
    "NewLineSymbols": "PrerequisitePart",
    "SymbolsToKeepOnNewLine": "PrerequisitePart",
    "NewLineOnSpecificWords": "PrerequisitePart",
    "NewLineWords": "PrerequisitePart",
    "PlexUpload": "PrerequisitePart",
    "BackupPath": "PrerequisitePart",
    "ForceRunningDeletion": "PrerequisitePart",
    "AutoUpdatePosterizarr": "PrerequisitePart",
    "ManualAssetPath": "PrerequisitePart",
    "SkipAddText": "PrerequisitePart",
    "SkipLocalPosterTextAdd": "PrerequisitePart",
    "SkipLocalBackgroundTextAdd": "PrerequisitePart",
    "SkipLocalSeasonTextAdd": "PrerequisitePart",
    "SkipLocalTCTextAdd": "PrerequisitePart",
    "SkipAddTextAndOverlay": "PrerequisitePart",
    "SkipAddTextAndBorder": "PrerequisitePart",
    "FollowSymlink": "PrerequisitePart",
    "poster4k": "PrerequisitePart",
    "Poster1080p": "PrerequisitePart",
    "UsePosterResolutionOverlays": "PrerequisitePart",
    "DisableHashValidation": "PrerequisitePart",
    "Background4k": "PrerequisitePart",
    "Background1080p": "PrerequisitePart",
    "TC4k": "PrerequisitePart",
    "TC1080p": "PrerequisitePart",
    "UseBackgroundResolutionOverlays": "PrerequisitePart",
    "UseTCResolutionOverlays": "PrerequisitePart",
    "4KDoVi": "PrerequisitePart",
    "4KHDR10": "PrerequisitePart",
    "4KDoViHDR10": "PrerequisitePart",
    "4KDoViBackground": "PrerequisitePart",
    "4KHDR10Background": "PrerequisitePart",
    "4KDoViHDR10Background": "PrerequisitePart",
    "4KDoViTC": "PrerequisitePart",
    "4KHDR10TC": "PrerequisitePart",
    "4KDoViHDR10TC": "PrerequisitePart",
    "DisableOnlineAssetFetch": "PrerequisitePart",
    "DisableOnlineTitleCardFetch": "PrerequisitePart",
    "DisableOnlinePosterFetch": "PrerequisitePart",
    "DisableOnlineBackgroundFetch": "PrerequisitePart",
    "DisableOnlineSeasonFetch": "PrerequisitePart",
    "collectionfont": "PrerequisitePart",
    "collectionoverlayfile": "PrerequisitePart",
    "UseLogo": "PrerequisitePart",
    "UseBGLogo": "PrerequisitePart",
    "UseClearlogo": "PrerequisitePart",
    "UseClearart": "PrerequisitePart",
    "LogoTextFallback": "PrerequisitePart",
    "TextlessPosterBypass": "PrerequisitePart",
    "ConvertLogoColor": "PrerequisitePart",
    "LogoFlatColor": "PrerequisitePart",
    "UseOriginalTitle": "PrerequisitePart",
    "telemetry": "PrerequisitePart",
    "ParallelJobs": "PrerequisitePart",
    # OverlayPart
    "ImageProcessing": "OverlayPart",
    "outputQuality": "OverlayPart",
    # PosterOverlayPart
    "PosterFontAllCaps": "PosterOverlayPart",
    "PosterAddBorder": "PosterOverlayPart",
    "PosterAddText": "PosterOverlayPart",
    "PosterAddOverlay": "PosterOverlayPart",
    "PosterFontcolor": "PosterOverlayPart",
    "PosterBordercolor": "PosterOverlayPart",
    "PosterMinPointSize": "PosterOverlayPart",
    "PosterMaxPointSize": "PosterOverlayPart",
    "PosterBorderwidth": "PosterOverlayPart",
    "PosterMaxWidth": "PosterOverlayPart",
    "PosterMaxHeight": "PosterOverlayPart",
    "PosterTextOffset": "PosterOverlayPart",
    "PosterAddTextStroke": "PosterOverlayPart",
    "PosterStrokecolor": "PosterOverlayPart",
    "PosterStrokewidth": "PosterOverlayPart",
    "PosterLineSpacing": "PosterOverlayPart",
    "PosterTextGravity": "PosterOverlayPart",
    # SeasonPosterOverlayPart
    "SeasonPosterFontAllCaps": "SeasonPosterOverlayPart",
    "SeasonPosterOverrideSeasonName": "SeasonPosterOverlayPart",
    "SeasonPosterSeasonOverrideText": "SeasonPosterOverlayPart",
    "SeasonPosterSpecialSeasonOverrideText": "SeasonPosterOverlayPart",
    "SeasonPosterAddBorder": "SeasonPosterOverlayPart",
    "SeasonPosterAddText": "SeasonPosterOverlayPart",
    "SeasonPosterAddOverlay": "SeasonPosterOverlayPart",
    "SeasonPosterFontcolor": "SeasonPosterOverlayPart",
    "SeasonPosterBordercolor": "SeasonPosterOverlayPart",
    "SeasonPosterMinPointSize": "SeasonPosterOverlayPart",
    "SeasonPosterMaxPointSize": "SeasonPosterOverlayPart",
    "SeasonPosterBorderwidth": "SeasonPosterOverlayPart",
    "SeasonPosterMaxWidth": "SeasonPosterOverlayPart",
    "SeasonPosterMaxHeight": "SeasonPosterOverlayPart",
    "SeasonPosterTextOffset": "SeasonPosterOverlayPart",
    "SeasonPosterAddTextStroke": "SeasonPosterOverlayPart",
    "SeasonPosterStrokecolor": "SeasonPosterOverlayPart",
    "SeasonPosterStrokewidth": "SeasonPosterOverlayPart",
    "SeasonPosterLineSpacing": "SeasonPosterOverlayPart",
    "SeasonPosterShowFallback": "SeasonPosterOverlayPart",
    "SeasonPosterTextGravity": "SeasonPosterOverlayPart",
    # BackgroundOverlayPart
    "BackgroundFontAllCaps": "BackgroundOverlayPart",
    "BackgroundAddOverlay": "BackgroundOverlayPart",
    "BackgroundAddBorder": "BackgroundOverlayPart",
    "BackgroundAddText": "BackgroundOverlayPart",
    "BackgroundFontcolor": "BackgroundOverlayPart",
    "BackgroundBordercolor": "BackgroundOverlayPart",
    "BackgroundMinPointSize": "BackgroundOverlayPart",
    "BackgroundMaxPointSize": "BackgroundOverlayPart",
    "BackgroundBorderwidth": "BackgroundOverlayPart",
    "BackgroundMaxWidth": "BackgroundOverlayPart",
    "BackgroundMaxHeight": "BackgroundOverlayPart",
    "BackgroundTextOffset": "BackgroundOverlayPart",
    "BackgroundAddTextStroke": "BackgroundOverlayPart",
    "BackgroundStrokecolor": "BackgroundOverlayPart",
    "BackgroundStrokewidth": "BackgroundOverlayPart",
    "BackgroundLineSpacing": "BackgroundOverlayPart",
    "BackgroundTextGravity": "BackgroundOverlayPart",
    # TitleCardOverlayPart
    "TitleCardUseBackgroundAsTitleCard": "TitleCardOverlayPart",
    "TitleCardAddOverlay": "TitleCardOverlayPart",
    "TitleCardAddBorder": "TitleCardOverlayPart",
    "TitleCardBordercolor": "TitleCardOverlayPart",
    "TitleCardBorderwidth": "TitleCardOverlayPart",
    "TitleCardBackgroundFallback": "TitleCardOverlayPart",
    "TitleCardSkipWords": "TitleCardOverlayPart",
    # TitleCardTitleTextPart
    "TitleCardTitleFontAllCaps": "TitleCardTitleTextPart",
    "TitleCardTitleAddEPTitleText": "TitleCardTitleTextPart",
    "TitleCardTitleFontcolor": "TitleCardTitleTextPart",
    "TitleCardTitleMinPointSize": "TitleCardTitleTextPart",
    "TitleCardTitleMaxPointSize": "TitleCardTitleTextPart",
    "TitleCardTitleMaxWidth": "TitleCardTitleTextPart",
    "TitleCardTitleMaxHeight": "TitleCardTitleTextPart",
    "TitleCardTitleTextOffset": "TitleCardTitleTextPart",
    "TitleCardTitleAddTextStroke": "TitleCardTitleTextPart",
    "TitleCardTitleStrokecolor": "TitleCardTitleTextPart",
    "TitleCardTitleStrokewidth": "TitleCardTitleTextPart",
    "TitleCardTitleLineSpacing": "TitleCardTitleTextPart",
    "TitleCardTitleTextGravity": "TitleCardTitleTextPart",
    # TitleCardEPTextPart
    "TitleCardEPSeasonTCText": "TitleCardEPTextPart",
    "TitleCardEPEpisodeTCText": "TitleCardEPTextPart",
    "TitleCardEPFontAllCaps": "TitleCardEPTextPart",
    "TitleCardEPAddEPText": "TitleCardEPTextPart",
    "TitleCardEPFontcolor": "TitleCardEPTextPart",
    "TitleCardEPMinPointSize": "TitleCardEPTextPart",
    "TitleCardEPMaxPointSize": "TitleCardEPTextPart",
    "TitleCardEPMaxWidth": "TitleCardEPTextPart",
    "TitleCardEPMaxHeight": "TitleCardEPTextPart",
    "TitleCardEPTextOffset": "TitleCardEPTextPart",
    "TitleCardEPAddTextStroke": "TitleCardEPTextPart",
    "TitleCardEPStrokecolor": "TitleCardEPTextPart",
    "TitleCardEPStrokewidth": "TitleCardEPTextPart",
    "TitleCardEPLineSpacing": "TitleCardEPTextPart",
    "TitleCardEPTextGravity": "TitleCardEPTextPart",
    # ShowTitleOnSeasonPosterPart
    "ShowTitleAddShowTitletoSeason": "ShowTitleOnSeasonPosterPart",
    "ShowTitleFontAllCaps": "ShowTitleOnSeasonPosterPart",
    "ShowTitleAddTextStroke": "ShowTitleOnSeasonPosterPart",
    "ShowTitleStrokecolor": "ShowTitleOnSeasonPosterPart",
    "ShowTitleStrokewidth": "ShowTitleOnSeasonPosterPart",
    "ShowTitleFontcolor": "ShowTitleOnSeasonPosterPart",
    "ShowTitleMinPointSize": "ShowTitleOnSeasonPosterPart",
    "ShowTitleMaxPointSize": "ShowTitleOnSeasonPosterPart",
    "ShowTitleMaxWidth": "ShowTitleOnSeasonPosterPart",
    "ShowTitleMaxHeight": "ShowTitleOnSeasonPosterPart",
    "ShowTitleTextOffset": "ShowTitleOnSeasonPosterPart",
    "ShowTitleLineSpacing": "ShowTitleOnSeasonPosterPart",
    "ShowTitleTextGravity": "ShowTitleOnSeasonPosterPart",
    # CollectionTitlePosterPart
    "CollectionTitleAddCollectionTitle": "CollectionTitlePosterPart",
    "CollectionTitleCollectionTitle": "CollectionTitlePosterPart",
    "CollectionTitleFontAllCaps": "CollectionTitlePosterPart",
    "CollectionTitleAddTextStroke": "CollectionTitlePosterPart",
    "CollectionTitleStrokecolor": "CollectionTitlePosterPart",
    "CollectionTitleStrokewidth": "CollectionTitlePosterPart",
    "CollectionTitleFontcolor": "CollectionTitlePosterPart",
    "CollectionTitleMinPointSize": "CollectionTitlePosterPart",
    "CollectionTitleMaxPointSize": "CollectionTitlePosterPart",
    "CollectionTitleMaxWidth": "CollectionTitlePosterPart",
    "CollectionTitleMaxHeight": "CollectionTitlePosterPart",
    "CollectionTitleTextOffset": "CollectionTitlePosterPart",
    "CollectionTitleLineSpacing": "CollectionTitlePosterPart",
    "CollectionTitleTextGravity": "CollectionTitlePosterPart",
    # CollectionPosterOverlayPart
    "CollectionPosterFontAllCaps": "CollectionPosterOverlayPart",
    "CollectionPosterAddBorder": "CollectionPosterOverlayPart",
    "CollectionPosterAddText": "CollectionPosterOverlayPart",
    "CollectionPosterAddTextStroke": "CollectionPosterOverlayPart",
    "CollectionPosterStrokecolor": "CollectionPosterOverlayPart",
    "CollectionPosterStrokewidth": "CollectionPosterOverlayPart",
    "CollectionPosterAddOverlay": "CollectionPosterOverlayPart",
    "CollectionPosterFontcolor": "CollectionPosterOverlayPart",
    "CollectionPosterBordercolor": "CollectionPosterOverlayPart",
    "CollectionPosterMinPointSize": "CollectionPosterOverlayPart",
    "CollectionPosterMaxPointSize": "CollectionPosterOverlayPart",
    "CollectionPosterBorderwidth": "CollectionPosterOverlayPart",
    "CollectionPosterMaxWidth": "CollectionPosterOverlayPart",
    "CollectionPosterMaxHeight": "CollectionPosterOverlayPart",
    "CollectionPosterTextOffset": "CollectionPosterOverlayPart",
    "CollectionPosterLineSpacing": "CollectionPosterOverlayPart",
    "CollectionPosterTextGravity": "CollectionPosterOverlayPart",
}


# UI Grouping for better organization
UI_GROUPS = {
    "WebUI Settings": [
        "basicAuthEnabled",
        "basicAuthUsername",
        "basicAuthPassword",
    ],
    "System Settings": [
        "AssetPath",
        "BackupPath",
        "ManualAssetPath",
        "LibraryFolders",
        "AssetCleanup",
        "FollowSymlink",
        "DisableHashValidation",
        "FileTestOnTrigger",
        "ParallelJobs",
        "telemetry",
        "AutoUpdatePosterizarr",
        "ForceRunningDeletion",
        "maxLogs",
        "logLevel",
        "magickinstalllocation",
        "show_skipped",
        "SkipTBA",
        "SkipJapTitle",
        "DisableOnlineAssetFetch",
    ],
    "Provider Settings": [
        "tvdbapi",
        "tmdbtoken",
        "FanartTvAPIKey",
        "FavProvider",
        "OverrideProviderOrder",
        "ProviderOrder",
        "tmdb_vote_sorting",
    ],
    "Media Servers": [
        "UsePlex",
        "PlexUrl",
        "PlexToken",
        "PlexUploadExistingAssets",
        "PlexUpload",
        "PlexLibstoExclude",
        "UseJellyfin",
        "JellyfinUrl",
        "JellyfinAPIKey",
        "JellyfinUploadExistingAssets",
        "JellyfinReplaceThumbwithBackdrop",
        "JellyfinLibstoExclude",
        "UseEmby",
        "EmbyUrl",
        "EmbyAPIKey",
        "EmbyUploadExistingAssets",
        "EmbyReplaceThumbwithBackdrop",
        "EmbyLibstoExclude",
    ],
    "Language & Notifications": [
        "PreferredLanguageOrder",
        "PreferredSeasonLanguageOrder",
        "PreferredBackgroundLanguageOrder",
        "PreferredTCLanguageOrder",
        "LogoLanguageOrder",
        "LibraryLanguageOverrides",
        "SendNotification",
        "Discord",
        "AppriseUrl",
        "DiscordUserName",
        "UseUptimeKuma",
        "UptimeKumaUrl",
    ],
    "Global Visuals": [
        "ImageProcessing",
        "outputQuality",
        "WidthHeightFilter",
        "UseLogo",
        "UseBGLogo",
        "UseClearlogo",
        "UseClearart",
        "LogoTextFallback",
        "TextlessPosterBypass",
        "ConvertLogoColor",
        "LogoFlatColor",
        "UseOriginalTitle",
        "NewLineOnSpecificSymbols",
        "NewLineSymbols",
        "SymbolsToKeepOnNewLine",
        "NewLineOnSpecificWords",
        "NewLineWords",
        "RTLFont",
        "SkipAddText",
        "SkipAddTextAndOverlay",
        "SkipAddTextAndBorder",
    ],
    "Poster Settings": [
        "DisableOnlinePosterFetch",
        "Posters",
        "SkipLocalPosterTextAdd",
        "PosterMinWidth",
        "PosterMinHeight",
        "UsePosterResolutionOverlays",
        "poster4k",
        "Poster1080p",
        "4KDoVi",
        "4KHDR10",
        "4KDoViHDR10",
        "font",
        "overlayfile",
        "showoverlayfile",
    ],
    "Poster Overlays": [
        "PosterFontAllCaps",
        "PosterAddBorder",
        "PosterAddText",
        "PosterAddOverlay",
        "PosterFontcolor",
        "PosterBordercolor",
        "PosterMinPointSize",
        "PosterMaxPointSize",
        "PosterBorderwidth",
        "PosterMaxWidth",
        "PosterMaxHeight",
        "PosterTextOffset",
        "PosterAddTextStroke",
        "PosterStrokecolor",
        "PosterStrokewidth",
        "PosterLineSpacing",
        "PosterTextGravity",
    ],
    "Season Settings": [
        "DisableOnlineSeasonFetch",
        "SeasonPosters",
        "SkipLocalSeasonTextAdd",
        "seasonoverlayfile",
    ],
    "Season Overlays": [
        "SeasonPosterFontAllCaps",
        "SeasonPosterOverrideSeasonName",
        "SeasonPosterSeasonOverrideText",
        "SeasonPosterSpecialSeasonOverrideText",
        "SeasonPosterAddBorder",
        "SeasonPosterAddText",
        "SeasonPosterAddOverlay",
        "SeasonPosterFontcolor",
        "SeasonPosterBordercolor",
        "SeasonPosterMinPointSize",
        "SeasonPosterMaxPointSize",
        "SeasonPosterBorderwidth",
        "SeasonPosterMaxWidth",
        "SeasonPosterMaxHeight",
        "SeasonPosterTextOffset",
        "SeasonPosterAddTextStroke",
        "SeasonPosterStrokecolor",
        "SeasonPosterStrokewidth",
        "SeasonPosterLineSpacing",
        "SeasonPosterShowFallback",
        "SeasonPosterTextGravity",
    ],
    "Season Show Title": [
        "ShowTitleAddShowTitletoSeason",
        "ShowTitleFontAllCaps",
        "ShowTitleAddTextStroke",
        "ShowTitleStrokecolor",
        "ShowTitleStrokewidth",
        "ShowTitleFontcolor",
        "ShowTitleMinPointSize",
        "ShowTitleMaxPointSize",
        "ShowTitleMaxWidth",
        "ShowTitleMaxHeight",
        "ShowTitleTextOffset",
        "ShowTitleLineSpacing",
        "ShowTitleTextGravity",
    ],
    "Background Settings": [
        "DisableOnlineBackgroundFetch",
        "BackgroundPosters",
        "SkipLocalBackgroundTextAdd",
        "BgTcMinWidth",
        "BgTcMinHeight",
        "UseBackgroundResolutionOverlays",
        "Background4k",
        "Background1080p",
        "4KDoViBackground",
        "4KHDR10Background",
        "4KDoViHDR10Background",
        "backgroundfont",
        "backgroundoverlayfile",
        "showbackgroundoverlayfile",
    ],
    "Background Overlays": [
        "BackgroundFontAllCaps",
        "BackgroundAddOverlay",
        "BackgroundAddBorder",
        "BackgroundAddText",
        "BackgroundFontcolor",
        "BackgroundBordercolor",
        "BackgroundMinPointSize",
        "BackgroundMaxPointSize",
        "BackgroundBorderwidth",
        "BackgroundMaxWidth",
        "BackgroundMaxHeight",
        "BackgroundTextOffset",
        "BackgroundAddTextStroke",
        "BackgroundStrokecolor",
        "BackgroundStrokewidth",
        "BackgroundLineSpacing",
        "BackgroundTextGravity",
    ],
    "Title Card Settings": [
        "DisableOnlineTitleCardFetch",
        "TitleCards",
        "SkipLocalTCTextAdd",
        "TitleCardSkipWords",
        "UseTCResolutionOverlays",
        "TC4k",
        "TC1080p",
        "4KDoViTC",
        "4KHDR10TC",
        "4KDoViHDR10TC",
        "titlecardfont",
        "titlecardoverlayfile",
    ],
    "Title Card Overlay": [
        "TitleCardUseBackgroundAsTitleCard",
        "TitleCardAddOverlay",
        "TitleCardAddBorder",
        "TitleCardBordercolor",
        "TitleCardBorderwidth",
        "TitleCardBackgroundFallback",
    ],
    "Title Card Title Text": [
        "TitleCardTitleFontAllCaps",
        "TitleCardTitleAddEPTitleText",
        "TitleCardTitleFontcolor",
        "TitleCardTitleMinPointSize",
        "TitleCardTitleMaxPointSize",
        "TitleCardTitleMaxWidth",
        "TitleCardTitleMaxHeight",
        "TitleCardTitleTextOffset",
        "TitleCardTitleAddTextStroke",
        "TitleCardTitleStrokecolor",
        "TitleCardTitleStrokewidth",
        "TitleCardTitleLineSpacing",
        "TitleCardTitleTextGravity",
    ],
    "Title Card Episode Text": [
        "TitleCardEPSeasonTCText",
        "TitleCardEPEpisodeTCText",
        "TitleCardEPFontAllCaps",
        "TitleCardEPAddEPText",
        "TitleCardEPFontcolor",
        "TitleCardEPMinPointSize",
        "TitleCardEPMaxPointSize",
        "TitleCardEPMaxWidth",
        "TitleCardEPMaxHeight",
        "TitleCardEPTextOffset",
        "TitleCardEPAddTextStroke",
        "TitleCardEPStrokecolor",
        "TitleCardEPStrokewidth",
        "TitleCardEPLineSpacing",
        "TitleCardEPTextGravity",
    ],
    "Collection Settings": [
        "collectionfont",
        "collectionoverlayfile",
    ],
    "Collection Title": [
        "CollectionTitleAddCollectionTitle",
        "CollectionTitleCollectionTitle",
        "CollectionTitleFontAllCaps",
        "CollectionTitleAddTextStroke",
        "CollectionTitleStrokecolor",
        "CollectionTitleStrokewidth",
        "CollectionTitleFontcolor",
        "CollectionTitleMinPointSize",
        "CollectionTitleMaxPointSize",
        "CollectionTitleMaxWidth",
        "CollectionTitleMaxHeight",
        "CollectionTitleTextOffset",
        "CollectionTitleLineSpacing",
        "CollectionTitleTextGravity",
    ],
    "Collection Poster": [
        "CollectionPosterFontAllCaps",
        "CollectionPosterAddBorder",
        "CollectionPosterAddText",
        "CollectionPosterAddTextStroke",
        "CollectionPosterStrokecolor",
        "CollectionPosterStrokewidth",
        "CollectionPosterAddOverlay",
        "CollectionPosterFontcolor",
        "CollectionPosterBordercolor",
        "CollectionPosterMinPointSize",
        "CollectionPosterMaxPointSize",
        "CollectionPosterBorderwidth",
        "CollectionPosterMaxWidth",
        "CollectionPosterMaxHeight",
        "CollectionPosterTextOffset",
        "CollectionPosterLineSpacing",
        "CollectionPosterTextGravity",
    ],
}


def flatten_config(grouped_config):
    """
    Convert grouped config structure to flat structure for internal use.

    Example:
        {"ApiPart": {"tmdbtoken": "xxx"}} -> {"tmdbtoken": "xxx"}

    Special handling for duplicate keys (LibstoExclude, UploadExistingAssets, etc.)
    by adding service prefix.
    """
    flat = {}

    for group_name, group_data in grouped_config.items():
        if not isinstance(group_data, dict):
            continue

        for key, value in group_data.items():
            # Handle special cases where keys appear in multiple groups
            if key == "LibstoExclude":
                # Add prefix based on group
                if group_name == "PlexPart":
                    flat_key = "PlexLibstoExclude"
                elif group_name == "JellyfinPart":
                    flat_key = "JellyfinLibstoExclude"
                elif group_name == "EmbyPart":
                    flat_key = "EmbyLibstoExclude"
                else:
                    flat_key = key
            elif key == "UploadExistingAssets":
                if group_name == "PlexPart":
                    flat_key = "PlexUploadExistingAssets"
                elif group_name == "JellyfinPart":
                    flat_key = "JellyfinUploadExistingAssets"
                elif group_name == "EmbyPart":
                    flat_key = "EmbyUploadExistingAssets"
                else:
                    flat_key = key
            elif key == "ReplaceThumbwithBackdrop":
                if group_name == "JellyfinPart":
                    flat_key = "JellyfinReplaceThumbwithBackdrop"
                elif group_name == "EmbyPart":
                    flat_key = "EmbyReplaceThumbwithBackdrop"
                else:
                    flat_key = key
            else:
                # Use the new helper function for prefix application with proper case conversion
                if group_name == "PosterOverlayPart":
                    flat_key = apply_prefix_with_conversion("Poster", key)
                elif group_name == "SeasonPosterOverlayPart":
                    flat_key = apply_prefix_with_conversion("SeasonPoster", key)
                elif group_name == "BackgroundOverlayPart":
                    flat_key = apply_prefix_with_conversion("Background", key)
                elif group_name == "TitleCardOverlayPart":
                    flat_key = apply_prefix_with_conversion("TitleCard", key)
                elif group_name == "TitleCardTitleTextPart":
                    flat_key = apply_prefix_with_conversion("TitleCardTitle", key)
                elif group_name == "TitleCardEPTextPart":
                    flat_key = apply_prefix_with_conversion("TitleCardEP", key)
                elif group_name == "ShowTitleOnSeasonPosterPart":
                    flat_key = apply_prefix_with_conversion("ShowTitle", key)
                elif group_name == "CollectionTitlePosterPart":
                    flat_key = apply_prefix_with_conversion("CollectionTitle", key)
                elif group_name == "CollectionPosterOverlayPart":
                    flat_key = apply_prefix_with_conversion("CollectionPoster", key)
                else:
                    # For simple groups (ApiPart, Notification, WebUI, etc.), use original key
                    flat_key = key

            flat[flat_key] = value

    return flat


def unflatten_config(flat_config):
    """
    Convert flat config structure back to grouped structure for saving.

    Example:
        {"tmdbtoken": "xxx"} -> {"ApiPart": {"tmdbtoken": "xxx"}}
    """
    grouped = {}

    for key, value in flat_config.items():
        # Find the group for this key
        group_name = CONFIG_GROUPS.get(key)

        if not group_name:
            # Unknown key - try to determine group from prefix
            logger.warning(f"Unknown config key '{key}' - skipping")
            continue

        # Initialize group if it doesn't exist
        if group_name not in grouped:
            grouped[group_name] = {}

        # Remove prefix for storage using the new helper function
        storage_key = key

        # Handle prefixed keys
        if key.startswith("Plex") and group_name == "PlexPart":
            if key == "PlexLibstoExclude":
                storage_key = "LibstoExclude"
            elif key == "PlexUploadExistingAssets":
                storage_key = "UploadExistingAssets"
            # PlexUrl, PlexUpload, etc. keep their original names
        elif key.startswith("Jellyfin") and group_name == "JellyfinPart":
            if key == "JellyfinLibstoExclude":
                storage_key = "LibstoExclude"
            elif key == "JellyfinUploadExistingAssets":
                storage_key = "UploadExistingAssets"
            elif key == "JellyfinReplaceThumbwithBackdrop":
                storage_key = "ReplaceThumbwithBackdrop"
        elif key.startswith("Emby") and group_name == "EmbyPart":
            if key == "EmbyLibstoExclude":
                storage_key = "LibstoExclude"
            elif key == "EmbyUploadExistingAssets":
                storage_key = "UploadExistingAssets"
            elif key == "EmbyReplaceThumbwithBackdrop":
                storage_key = "ReplaceThumbwithBackdrop"
        # Use the new helper function to restore original case
        elif key.startswith("Poster") and group_name == "PosterOverlayPart":
            storage_key = remove_prefix_with_original_case(key)
        elif key.startswith("SeasonPoster") and group_name == "SeasonPosterOverlayPart":
            storage_key = remove_prefix_with_original_case(key)
        elif key.startswith("Background") and group_name == "BackgroundOverlayPart":
            storage_key = remove_prefix_with_original_case(key)
        elif (
            key.startswith("TitleCardTitle") and group_name == "TitleCardTitleTextPart"
        ):
            storage_key = remove_prefix_with_original_case(key)
        elif key.startswith("TitleCardEP") and group_name == "TitleCardEPTextPart":
            storage_key = remove_prefix_with_original_case(key)
        elif key.startswith("TitleCard") and group_name == "TitleCardOverlayPart":
            storage_key = remove_prefix_with_original_case(key)
        elif (
            key.startswith("ShowTitle") and group_name == "ShowTitleOnSeasonPosterPart"
        ):
            storage_key = remove_prefix_with_original_case(key)
        elif (
            key.startswith("CollectionTitle")
            and group_name == "CollectionTitlePosterPart"
        ):
            storage_key = remove_prefix_with_original_case(key)
        elif (
            key.startswith("CollectionPoster")
            and group_name == "CollectionPosterOverlayPart"
        ):
            storage_key = remove_prefix_with_original_case(key)

        # Convert booleans to strings "true"/"false" for PowerShell script compatibility
        if isinstance(value, bool):
            value = "true" if value else "false"

        grouped[group_name][storage_key] = value

    return grouped


# Friendly display names for UI
DISPLAY_NAMES = {
    # WebUI Settings
    "basicAuthEnabled": "Enable Basic Authentication",
    "basicAuthUsername": "Basic Auth Username",
    "basicAuthPassword": "Basic Auth Password",
    # API Keys & Tokens
    "tvdbapi": "TVDB API Key",
    "tmdbtoken": "TMDB API Token",
    "FanartTvAPIKey": "Fanart.tv API Key",
    "PlexToken": "Plex Token",
    "JellyfinAPIKey": "Jellyfin API Key",
    "EmbyAPIKey": "Emby API Key",
    "FavProvider": "Favorite Provider",
    "OverrideProviderOrder": "Override Provider Order",
    "ProviderOrder": "Provider Custom Order",
    "tmdb_vote_sorting": "TMDB Vote Sorting",
    # Language & Preferences
    "PreferredLanguageOrder": "Preferred Language Order",
    "PreferredSeasonLanguageOrder": "Season Language Order",
    "PreferredBackgroundLanguageOrder": "Background Language Order",
    "PreferredTCLanguageOrder": "TitleCard Language Order",
    "LogoLanguageOrder": "Logo Language Order",
    "LibraryLanguageOverrides": "Per-Library Language Overrides",
    # Image Filters
    "WidthHeightFilter": "Width/Height Filter",
    "PosterMinWidth": "Poster Min Width",
    "PosterMinHeight": "Poster Min Height",
    "BgTcMinWidth": "Background/Title Card Min Width",
    "BgTcMinHeight": "Background/Title Card Min Height",
    # Plex Settings
    "PlexLibstoExclude": "Plex Libraries to Exclude",
    "PlexUrl": "Plex URL",
    "UsePlex": "Use Plex",
    "PlexUploadExistingAssets": "Upload Existing Assets to Plex",
    "PlexUpload": "Enable Plex Upload",
    # Jellyfin Settings
    "JellyfinLibstoExclude": "Jellyfin Libraries to Exclude",
    "JellyfinUrl": "Jellyfin URL",
    "UseJellyfin": "Use Jellyfin",
    "JellyfinUploadExistingAssets": "Upload Existing Assets to Jellyfin",
    "JellyfinReplaceThumbwithBackdrop": "Replace Thumbnail with Backdrop",
    # Emby Settings
    "EmbyLibstoExclude": "Emby Libraries to Exclude",
    "EmbyUrl": "Emby URL",
    "UseEmby": "Use Emby",
    "EmbyUploadExistingAssets": "Upload Existing Assets to Emby",
    "EmbyReplaceThumbwithBackdrop": "Replace Thumbnail with Backdrop",
    # Notifications
    "SendNotification": "Send Notifications",
    "AppriseUrl": "Apprise URL",
    "Discord": "Discord Webhook",
    "UseUptimeKuma": "Use Uptime Kuma",
    "UptimeKumaUrl": "Uptime Kuma URL",
    "DiscordUserName": "Discord Username",
    # General Settings
    "AssetPath": "Asset Path",
    "FileTestOnTrigger": "Test File on Trigger",
    "show_skipped": "Show Skipped Items",
    "magickinstalllocation": "ImageMagick Location",
    "maxLogs": "Maximum Log Files",
    "logLevel": "Log Level",
    "font": "Default Font",
    "backgroundfont": "Background Font",
    "titlecardfont": "Title Card Font",
    "collectionfont": "Collection Font",
    "RTLFont": "Right-to-Left Font",
    "overlayfile": "Overlay File",
    "backgroundoverlayfile": "Background Overlay File",
    "showoverlayfile": "Show Overlay File",
    "showbackgroundoverlayfile": "Show Background Overlay File",
    "titlecardoverlayfile": "Title Card Overlay File",
    "seasonoverlayfile": "Season Overlay File",
    "collectionoverlayfile": "Collection Overlay File",
    "LibraryFolders": "Library Folders",
    "Posters": "Generate Posters",
    "SeasonPosters": "Generate Season Posters",
    "BackgroundPosters": "Generate Backgrounds",
    "TitleCards": "Generate Title Cards",
    "SkipTBA": "Enable skipping TitleCard creation when the title starts with words from 'SkipWords'",
    "TitleCardSkipWords": "List of words to be skipped for TC, e.g 'TBA, Episode...'. Wrap in /slashes/ to use Regex.",
    "SkipJapTitle": "Skip Japanese Titles",
    "AssetCleanup": "Asset Cleanup",
    "AutoUpdateIM": "Auto-Update ImageMagick",
    "NewLineOnSpecificSymbols": "New Line on Specific Symbols",
    "NewLineSymbols": "New Line Symbols",
    "SymbolsToKeepOnNewLine": "Symbols to Keep on New Line",
    "NewLineOnSpecificWords": "New Line on Specific Words",
    "NewLineWords": "Word Replacement Mapping",
    "BackupPath": "Backup Path",
    "ForceRunningDeletion": "Force Running Deletion",
    "AutoUpdatePosterizarr": "Auto-Update Posterizarr",
    "ManualAssetPath": "Manual Asset Path",
    "SkipAddText": "Skip Add Text",
    "SkipLocalPosterTextAdd": "Skip adding local poster text",
    "SkipLocalBackgroundTextAdd": "Skip adding local background poster text",
    "SkipLocalSeasonTextAdd": "Skip adding local season poster text",
    "SkipLocalTCTextAdd": "Skip adding local TC text",
    "SkipAddTextAndOverlay": "Skip Add Text and Skip add Overlay",
    "SkipAddTextAndBorder": "Skip Add Text and Skip add Border",
    "FollowSymlink": "Follow Symlinks",
    "poster4k": "4K Poster Overlay",
    "Poster1080p": "1080p Poster Overlay",
    "UsePosterResolutionOverlays": "Use Poster Resolution Overlays",
    "DisableHashValidation": "Disable Hash Validation",
    "Background4k": "4K Background Overlay",
    "Background1080p": "1080p Background Overlay",
    "TC4k": "4K Title Card Overlay",
    "TC1080p": "1080p Title Card Overlay",
    "UseBackgroundResolutionOverlays": "Use Background Resolution Overlays",
    "UseTCResolutionOverlays": "Use Title Card Resolution Overlays",
    "4KDoVi": "4K Dolby Vision Poster Overlay",
    "4KHDR10": "4K HDR10 Poster Overlay",
    "4KDoViHDR10": "4K DoVi & HDR10 Poster Overlay",
    "4KDoViBackground": "4K Dolby Vision Background Overlay",
    "4KHDR10Background": "4K HDR10 Background Overlay",
    "4KDoViHDR10Background": "4K DoVi & HDR10 Background Overlay",
    "4KDoViTC": "4K Dolby Vision Title Card Overlay",
    "4KHDR10TC": "4K HDR10 Title Card Overlay",
    "4KDoViHDR10TC": "4K DoVi & HDR10 Title Card Overlay",
    "DisableOnlineAssetFetch": "Disable Online Asset Fetch",
    "DisableOnlineTitleCardFetch": "Disable Online Titlecard Fetch",
    "DisableOnlinePosterFetch": "Disable Online Poster Fetch",
    "DisableOnlineBackgroundFetch": "Disable Online Background Fetch",
    "DisableOnlineSeasonFetch": "Disable Online Season Fetch",
    "UseLogo": "Use Logo for Posters",
    "UseBGLogo": "Use Logo for Backgrounds",
    "UseClearlogo": "Use Clearlogo",
    "UseClearart": "Use Clearart",
    "LogoTextFallback": "Fallback to Text",
    "TextlessPosterBypass": "Textless Poster Bypass",
    "ConvertLogoColor": "Convert Logo Color",
    "LogoFlatColor": "Flat Logo Color",
    "UseOriginalTitle": "Use the original title instead of the localized version",
    # Image Processing
    "ImageProcessing": "Image Processing",
    "outputQuality": "Output Quality",
    # Poster Settings
    "PosterFontAllCaps": "All Caps Font",
    "PosterAddBorder": "Add Border",
    "PosterAddText": "Add Text",
    "PosterAddOverlay": "Add Overlay",
    "PosterFontcolor": "Font Color",
    "PosterBordercolor": "Border Color",
    "PosterMinPointSize": "Min Font Size",
    "PosterMaxPointSize": "Max Font Size",
    "PosterBorderwidth": "Border Width",
    "PosterMaxWidth": "Max Text Width",
    "PosterMaxHeight": "Max Text Height",
    "PosterTextOffset": "Text Offset",
    "PosterAddTextStroke": "Add Text Stroke",
    "PosterStrokecolor": "Stroke Color",
    "PosterStrokewidth": "Stroke Width",
    "PosterLineSpacing": "Line Spacing",
    "PosterTextGravity": "Text Gravity",
    # Season Poster Settings
    "SeasonPosterFontAllCaps": "All Caps Font",
    "SeasonPosterOverrideSeasonName": "Override Season Name",
    "SeasonPosterSeasonOverrideText": "Season Override Text",
    "SeasonPosterSpecialSeasonOverrideText": "Special Season Override Text",
    "SeasonPosterAddBorder": "Add Border",
    "SeasonPosterAddText": "Add Text",
    "SeasonPosterAddOverlay": "Add Overlay",
    "SeasonPosterFontcolor": "Font Color",
    "SeasonPosterBordercolor": "Border Color",
    "SeasonPosterMinPointSize": "Min Font Size",
    "SeasonPosterMaxPointSize": "Max Font Size",
    "SeasonPosterBorderwidth": "Border Width",
    "SeasonPosterMaxWidth": "Max Text Width",
    "SeasonPosterMaxHeight": "Max Text Height",
    "SeasonPosterTextOffset": "Text Offset",
    "SeasonPosterAddTextStroke": "Add Text Stroke",
    "SeasonPosterStrokecolor": "Stroke Color",
    "SeasonPosterStrokewidth": "Stroke Width",
    "SeasonPosterLineSpacing": "Line Spacing",
    "SeasonPosterShowFallback": "Show Fallback",
    "SeasonPosterTextGravity": "Text Gravity",
    # Background Settings
    "BackgroundFontAllCaps": "All Caps Font",
    "BackgroundAddOverlay": "Add Overlay",
    "BackgroundAddBorder": "Add Border",
    "BackgroundAddText": "Add Text",
    "BackgroundFontcolor": "Font Color",
    "BackgroundBordercolor": "Border Color",
    "BackgroundMinPointSize": "Min Font Size",
    "BackgroundMaxPointSize": "Max Font Size",
    "BackgroundBorderwidth": "Border Width",
    "BackgroundMaxWidth": "Max Text Width",
    "BackgroundMaxHeight": "Max Text Height",
    "BackgroundTextOffset": "Text Offset",
    "BackgroundAddTextStroke": "Add Text Stroke",
    "BackgroundStrokecolor": "Stroke Color",
    "BackgroundStrokewidth": "Stroke Width",
    "BackgroundLineSpacing": "Line Spacing",
    "BackgroundTextGravity": "Text Gravity",
    # Title Card Overlay
    "TitleCardUseBackgroundAsTitleCard": "Use Background as Title Card",
    "TitleCardAddOverlay": "Add Overlay",
    "TitleCardAddBorder": "Add Border",
    "TitleCardBordercolor": "Border Color",
    "TitleCardBorderwidth": "Border Width",
    "TitleCardBackgroundFallback": "Background Fallback",
    # Title Card Title Text
    "TitleCardTitleFontAllCaps": "All Caps Font",
    "TitleCardTitleAddEPTitleText": "Add Episode Title Text",
    "TitleCardTitleFontcolor": "Font Color",
    "TitleCardTitleMinPointSize": "Min Font Size",
    "TitleCardTitleMaxPointSize": "Max Font Size",
    "TitleCardTitleMaxWidth": "Max Text Width",
    "TitleCardTitleMaxHeight": "Max Text Height",
    "TitleCardTitleTextOffset": "Text Offset",
    "TitleCardTitleAddTextStroke": "Add Text Stroke",
    "TitleCardTitleStrokecolor": "Stroke Color",
    "TitleCardTitleStrokewidth": "Stroke Width",
    "TitleCardTitleLineSpacing": "Line Spacing",
    "TitleCardTitleTextGravity": "Text Gravity",
    # Title Card Episode Text
    "TitleCardEPSeasonTCText": "Season Text Format",
    "TitleCardEPEpisodeTCText": "Episode Text Format",
    "TitleCardEPFontAllCaps": "All Caps Font",
    "TitleCardEPAddEPText": "Add Episode Text",
    "TitleCardEPFontcolor": "Font Color",
    "TitleCardEPMinPointSize": "Min Font Size",
    "TitleCardEPMaxPointSize": "Max Font Size",
    "TitleCardEPMaxWidth": "Max Text Width",
    "TitleCardEPMaxHeight": "Max Text Height",
    "TitleCardEPTextOffset": "Text Offset",
    "TitleCardEPAddTextStroke": "Add Text Stroke",
    "TitleCardEPStrokecolor": "Stroke Color",
    "TitleCardEPStrokewidth": "Stroke Width",
    "TitleCardEPLineSpacing": "Line Spacing",
    "TitleCardEPTextGravity": "Text Gravity",
    # Show Title on Season
    "ShowTitleAddShowTitletoSeason": "Add Show Title to Season",
    "ShowTitleFontAllCaps": "All Caps Font",
    "ShowTitleAddTextStroke": "Add Text Stroke",
    "ShowTitleStrokecolor": "Stroke Color",
    "ShowTitleStrokewidth": "Stroke Width",
    "ShowTitleFontcolor": "Font Color",
    "ShowTitleMinPointSize": "Min Font Size",
    "ShowTitleMaxPointSize": "Max Font Size",
    "ShowTitleMaxWidth": "Max Text Width",
    "ShowTitleMaxHeight": "Max Text Height",
    "ShowTitleTextOffset": "Text Offset",
    "ShowTitleLineSpacing": "Line Spacing",
    "ShowTitleTextGravity": "Text Gravity",
    # Collection Title
    "CollectionTitleAddCollectionTitle": "Add Collection Title",
    "CollectionTitleCollectionTitle": "Collection Title Text",
    "CollectionTitleFontAllCaps": "All Caps Font",
    "CollectionTitleAddTextStroke": "Add Text Stroke",
    "CollectionTitleStrokecolor": "Stroke Color",
    "CollectionTitleStrokewidth": "Stroke Width",
    "CollectionTitleFontcolor": "Font Color",
    "CollectionTitleMinPointSize": "Min Font Size",
    "CollectionTitleMaxPointSize": "Max Font Size",
    "CollectionTitleMaxWidth": "Max Text Width",
    "CollectionTitleMaxHeight": "Max Text Height",
    "CollectionTitleTextOffset": "Text Offset",
    "CollectionTitleLineSpacing": "Line Spacing",
    "CollectionTitleTextGravity": "Text Gravity",
    # Collection Poster
    "CollectionPosterFontAllCaps": "All Caps Font",
    "CollectionPosterAddBorder": "Add Border",
    "CollectionPosterAddText": "Add Text",
    "CollectionPosterAddTextStroke": "Add Text Stroke",
    "CollectionPosterStrokecolor": "Stroke Color",
    "CollectionPosterStrokewidth": "Stroke Width",
    "CollectionPosterAddOverlay": "Add Overlay",
    "CollectionPosterFontcolor": "Font Color",
    "CollectionPosterBordercolor": "Border Color",
    "CollectionPosterMinPointSize": "Min Font Size",
    "CollectionPosterMaxPointSize": "Max Font Size",
    "CollectionPosterBorderwidth": "Border Width",
    "CollectionPosterMaxWidth": "Max Text Width",
    "CollectionPosterMaxHeight": "Max Text Height",
    "CollectionPosterTextOffset": "Text Offset",
    "CollectionPosterLineSpacing": "Line Spacing",
    "CollectionPosterTextGravity": "Text Gravity",
}


def get_display_name(key):
    """Get friendly display name for a config key"""
    return DISPLAY_NAMES.get(key, key.replace("_", " ").title())


def get_tooltip(key):
    """Get tooltip description for a config key"""
    return CONFIG_TOOLTIPS.get(key, "")