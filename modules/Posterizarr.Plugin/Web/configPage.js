(function () {
    const pluginId = "f62d8560-6123-4567-89ab-cdef12345678";

    function loadConfig(page) {
        Dashboard.showLoadingMsg();

        console.log("[Posterizarr] Attempting to load configuration...");

        ApiClient.getPluginConfiguration(pluginId).then(function (config) {
            console.log("[Posterizarr] Configuration received:", config);

            const pathInput = page.querySelector('#AssetFolderPath');

            if (config && config.AssetFolderPath !== undefined) {
                pathInput.value = config.AssetFolderPath;
                console.log("[Posterizarr] Field populated with:", config.AssetFolderPath);
            } else {
                console.warn("[Posterizarr] Configuration object is empty or AssetFolderPath is missing.");
            }
            
            const chkReplaceThumb = page.querySelector('#chkReplaceThumb');
            const chkReplaceThumbExclusively = page.querySelector('#chkReplaceThumbExclusively');
            const containerExclusive = page.querySelector('#containerExclusive');
            
            if (chkReplaceThumb && chkReplaceThumbExclusively) {
                chkReplaceThumb.checked = config.ReplaceThumbwithBackdrop || false;
                chkReplaceThumbExclusively.checked = config.ReplaceThumbwithBackdropExclusively || false;
                
                const toggleExclusive = () => {
                    if (containerExclusive) {
                        containerExclusive.style.display = chkReplaceThumb.checked ? "block" : "none";
                    }
                };
                chkReplaceThumb.addEventListener('change', toggleExclusive);
                toggleExclusive();
            }

            Dashboard.hideLoadingMsg();
        }).catch(function (err) {
            console.error("[Posterizarr] Error loading configuration:", err);
            Dashboard.hideLoadingMsg();
            Dashboard.alert({
                message: "Failed to load configuration. Check the browser console for details."
            });
        });
    }

    // Ensure the script runs when the page is shown
    document.querySelector('#PosterizarrConfigPage').addEventListener('pageshow', function () {
        loadConfig(this);
    });

    document.querySelector('#PosterizarrConfigForm').addEventListener('submit', function (e) {
        e.preventDefault();
        Dashboard.showLoadingMsg();

        const form = this;
        const newPath = form.querySelector('#AssetFolderPath').value;

        ApiClient.getPluginConfiguration(pluginId).then(function (config) {
            // Update the existing config object
            config.AssetFolderPath = newPath;
            
            const chkReplaceThumb = form.querySelector('#chkReplaceThumb');
            const chkReplaceThumbExclusively = form.querySelector('#chkReplaceThumbExclusively');
            if (chkReplaceThumb) config.ReplaceThumbwithBackdrop = chkReplaceThumb.checked;
            if (chkReplaceThumbExclusively) config.ReplaceThumbwithBackdropExclusively = chkReplaceThumbExclusively.checked;

            console.log("[Posterizarr] Saving new configuration:", config);

            ApiClient.updatePluginConfiguration(pluginId, config).then(function (result) {
                console.log("[Posterizarr] Save result:", result);
                Dashboard.processPluginConfigurationUpdateResult(result);
            }).catch(function (err) {
                console.error("[Posterizarr] Error saving configuration:", err);
                Dashboard.hideLoadingMsg();
                Dashboard.alert({
                    message: "Failed to save configuration."
                });
            });
        });
    });
})();