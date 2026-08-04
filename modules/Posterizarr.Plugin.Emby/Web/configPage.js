define(['loading', 'emby-input', 'emby-button', 'emby-checkbox'], function (loading) {
    'use strict';

    var pluginId = "e62d8560-6123-4567-89ab-cdef12345678";

    function loadConfig(view) {
        loading.show();

        ApiClient.getPluginConfiguration(pluginId).then(function (config) {
            view.querySelector('#txtAssetPath').value = config.AssetFolderPath || '';
            view.querySelector('#chkDebugMode').checked = config.EnableDebugMode || false;
            
            var chkUpdatePoster = view.querySelector('#chkUpdatePoster');
            var chkUpdateSeason = view.querySelector('#chkUpdateSeason');
            var chkUpdateTitlecard = view.querySelector('#chkUpdateTitlecard');
            var chkUpdateBackdrop = view.querySelector('#chkUpdateBackdrop');
            var chkUpdateThumbnail = view.querySelector('#chkUpdateThumbnail');
            
            if (chkUpdatePoster) chkUpdatePoster.checked = config.UpdatePoster || false;
            if (chkUpdateSeason) chkUpdateSeason.checked = config.UpdateSeason || false;
            if (chkUpdateTitlecard) chkUpdateTitlecard.checked = config.UpdateTitlecard || false;
            if (chkUpdateBackdrop) chkUpdateBackdrop.checked = config.UpdateBackdrop || false;
            if (chkUpdateThumbnail) chkUpdateThumbnail.checked = config.UpdateThumbnail || false;

            loading.hide();
        }).catch(function (err) {
            console.error('[Posterizarr] Error loading configuration:', err);
            loading.hide();
        });
    }

    function saveConfig(view) {
        loading.show();

        ApiClient.getPluginConfiguration(pluginId).then(function (config) {
            config.AssetFolderPath = view.querySelector('#txtAssetPath').value;
            config.EnableDebugMode = view.querySelector('#chkDebugMode').checked;
            
            var chkUpdatePoster = view.querySelector('#chkUpdatePoster');
            var chkUpdateSeason = view.querySelector('#chkUpdateSeason');
            var chkUpdateTitlecard = view.querySelector('#chkUpdateTitlecard');
            var chkUpdateBackdrop = view.querySelector('#chkUpdateBackdrop');
            var chkUpdateThumbnail = view.querySelector('#chkUpdateThumbnail');
            
            if (chkUpdatePoster) config.UpdatePoster = chkUpdatePoster.checked;
            if (chkUpdateSeason) config.UpdateSeason = chkUpdateSeason.checked;
            if (chkUpdateTitlecard) config.UpdateTitlecard = chkUpdateTitlecard.checked;
            if (chkUpdateBackdrop) config.UpdateBackdrop = chkUpdateBackdrop.checked;
            if (chkUpdateThumbnail) config.UpdateThumbnail = chkUpdateThumbnail.checked;

            ApiClient.updatePluginConfiguration(pluginId, config).then(function (result) {
                Dashboard.processPluginConfigurationUpdateResult(result);
                loading.hide();
            }).catch(function (err) {
                console.error('[Posterizarr] Error saving configuration:', err);
                loading.hide();
            });
        });
    }

    return function (view) {
        view.addEventListener('viewshow', function () {
            loadConfig(view);
        });

        view.querySelector('#PosterizarrConfigForm').addEventListener('submit', function (e) {
            e.preventDefault();
            saveConfig(view);
            return false;
        });
    };
});
