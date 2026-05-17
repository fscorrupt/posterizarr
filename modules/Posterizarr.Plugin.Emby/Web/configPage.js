define(['loading', 'emby-input', 'emby-button', 'emby-checkbox'], function (loading) {
    'use strict';

    var pluginId = "e62d8560-6123-4567-89ab-cdef12345678";

    function loadConfig(view) {
        loading.show();

        ApiClient.getPluginConfiguration(pluginId).then(function (config) {
            view.querySelector('#txtAssetPath').value = config.AssetFolderPath || '';
            view.querySelector('#chkDebugMode').checked = config.EnableDebugMode || false;
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
