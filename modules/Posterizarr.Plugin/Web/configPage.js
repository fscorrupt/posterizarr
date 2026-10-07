(function () {
    'use strict';
    const pluginId = "f62d8560-6123-4567-89ab-cdef12345678";
    let configLoaded = false;

    function loadConfig(page) {
        if (configLoaded) return;
        Dashboard.showLoadingMsg();

        console.log("[Posterizarr] Attempting to load configuration...");

        ApiClient.getPluginConfiguration(pluginId).then(function (config) {
            console.log("[Posterizarr] Configuration received:", config);

            const pathInput = page.querySelector('#txtAssetPath');
            if (pathInput) {
                pathInput.value = config.AssetFolderPath || "";
            }

            const chkDebug = page.querySelector('#chkDebugMode');
            if (chkDebug) {
                chkDebug.checked = config.EnableDebugMode || false;
            }

            const chkUpdatePoster = page.querySelector('#chkUpdatePoster');
            const chkUpdateSeason = page.querySelector('#chkUpdateSeason');
            const chkUpdateTitlecard = page.querySelector('#chkUpdateTitlecard');
            const chkUpdateBackdrop = page.querySelector('#chkUpdateBackdrop');
            const chkUpdateThumbnail = page.querySelector('#chkUpdateThumbnail');
            const chkUpdateCollection = page.querySelector('#chkUpdateCollection');

            if (chkUpdatePoster) chkUpdatePoster.checked = config.UpdatePoster !== false;
            if (chkUpdateSeason) chkUpdateSeason.checked = config.UpdateSeason !== false;
            if (chkUpdateTitlecard) chkUpdateTitlecard.checked = config.UpdateTitlecard !== false;
            if (chkUpdateBackdrop) chkUpdateBackdrop.checked = config.UpdateBackdrop !== false;
            if (chkUpdateThumbnail) chkUpdateThumbnail.checked = config.UpdateThumbnail || false;
            if (chkUpdateCollection) chkUpdateCollection.checked = config.UpdateCollection || false;

            const chkRealtime = page.querySelector('#chkEnableRealtimeSync');
            if (chkRealtime) chkRealtime.checked = config.EnableRealtimeSync || false;

            const txtApiUrl = page.querySelector('#txtPosterizarrApiUrl');
            if (txtApiUrl) txtApiUrl.value = config.PosterizarrApiUrl || "";

            const txtApiKey = page.querySelector('#txtPosterizarrApiKey');
            if (txtApiKey) txtApiKey.value = config.PosterizarrApiKey || "";

            configLoaded = true;
            Dashboard.hideLoadingMsg();
        }).catch(function (err) {
            console.error("[Posterizarr] Error loading configuration:", err);
            Dashboard.hideLoadingMsg();
            Dashboard.alert({
                message: "Failed to load configuration. Check the browser console for details."
            });
        });
    }

    function init() {
        const view = document.querySelector('#PosterizarrConfigPage');
        if (!view) {
            setTimeout(init, 100);
            return;
        }

        view.addEventListener('viewshow', function () {
            configLoaded = false;
            loadConfig(this);
        });

        view.addEventListener('pageshow', function () {
            configLoaded = false;
            loadConfig(this);
        });

        const btnTest = view.querySelector('#btnTestPosterizarr');
        const resultDiv = view.querySelector('#testConnectionResult');
        if (btnTest) {
            btnTest.addEventListener('click', function (e) {
                e.preventDefault();
                const rawUrl = (view.querySelector('#txtPosterizarrApiUrl').value || '').trim();
                const apiKey = (view.querySelector('#txtPosterizarrApiKey').value || '').trim();

                if (!rawUrl) {
                    if (resultDiv) {
                        resultDiv.textContent = 'Please enter a Posterizarr URL.';
                        resultDiv.style.color = '#e5a00d';
                    }
                    return;
                }

                if (!apiKey) {
                    if (resultDiv) {
                        resultDiv.textContent = 'Please enter a Posterizarr API key.';
                        resultDiv.style.color = '#e5a00d';
                    }
                    return;
                }

                if (resultDiv) {
                    resultDiv.textContent = 'Testing connection...';
                    resultDiv.style.color = '#aaa';
                }

                const probeUrl = rawUrl.replace(/\/+$/, '') + '/ws/events';
                const headers = { 'X-API-Key': apiKey };

                fetch(probeUrl, { method: 'GET', headers: headers })
                    .then(function (res) {
                        if (!resultDiv) return;
                        if (res.ok || res.status === 200) {
                            resultDiv.textContent = 'Connected successfully.';
                            resultDiv.style.color = '#52b788';
                        } else if (res.status === 404) {
                            resultDiv.textContent = 'Connected, but /ws/events was not found (HTTP 404). Ensure Posterizarr supports WebSockets.';
                            resultDiv.style.color = '#e5a00d';
                        } else if (res.status === 401 || res.status === 403) {
                            resultDiv.textContent = 'Authentication failed (HTTP ' + res.status + '). Please check your API key.';
                            resultDiv.style.color = '#e63946';
                        } else {
                            resultDiv.textContent = 'Posterizarr returned HTTP ' + res.status;
                            resultDiv.style.color = '#e5a00d';
                        }
                    })
                    .catch(function (err) {
                        if (!resultDiv) return;
                        if (window.location.protocol === 'https:' && rawUrl.toLowerCase().startsWith('http://')) {
                            resultDiv.innerHTML = '<span style="color: #e5a00d;">⚠️ Direct test blocked by browser (mixed HTTPS/HTTP content).</span><br/>' +
                                '<span style="color: #aaa; font-size: 0.9em;">The server connects directly in the background. Save settings and check server logs.</span>';
                            return;
                        }
                        if (!rawUrl.includes('.') && !rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
                            resultDiv.innerHTML = '<span style="color: #52b788;">ℹ️ Internal Docker hostname detected.</span><br/>' +
                                '<span style="color: #aaa; font-size: 0.9em;">The browser cannot resolve container hostnames directly, but Jellyfin can. Save settings to connect.</span>';
                            return;
                        }
                        resultDiv.textContent = 'Cannot reach Posterizarr from browser. If running on LAN or Docker, save settings to test server-side.';
                        resultDiv.style.color = '#e63946';
                    });
            });
        }

        const form = view.querySelector('#PosterizarrConfigForm');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                Dashboard.showLoadingMsg();

                ApiClient.getPluginConfiguration(pluginId).then(function (config) {
                    const pathInput = view.querySelector('#txtAssetPath');
                    if (pathInput) config.AssetFolderPath = pathInput.value;

                    const chkDebug = view.querySelector('#chkDebugMode');
                    if (chkDebug) config.EnableDebugMode = chkDebug.checked;

                    const chkUpdatePoster = view.querySelector('#chkUpdatePoster');
                    const chkUpdateSeason = view.querySelector('#chkUpdateSeason');
                    const chkUpdateTitlecard = view.querySelector('#chkUpdateTitlecard');
                    const chkUpdateBackdrop = view.querySelector('#chkUpdateBackdrop');
                    const chkUpdateThumbnail = view.querySelector('#chkUpdateThumbnail');
                    const chkUpdateCollection = view.querySelector('#chkUpdateCollection');

                    if (chkUpdatePoster) config.UpdatePoster = chkUpdatePoster.checked;
                    if (chkUpdateSeason) config.UpdateSeason = chkUpdateSeason.checked;
                    if (chkUpdateTitlecard) config.UpdateTitlecard = chkUpdateTitlecard.checked;
                    if (chkUpdateBackdrop) config.UpdateBackdrop = chkUpdateBackdrop.checked;
                    if (chkUpdateThumbnail) config.UpdateThumbnail = chkUpdateThumbnail.checked;
                    if (chkUpdateCollection) config.UpdateCollection = chkUpdateCollection.checked;

                    const chkRealtime = view.querySelector('#chkEnableRealtimeSync');
                    config.EnableRealtimeSync = chkRealtime ? chkRealtime.checked : false;

                    const txtApiUrl = view.querySelector('#txtPosterizarrApiUrl');
                    config.PosterizarrApiUrl = txtApiUrl ? (txtApiUrl.value || "").trim() : "";

                    const txtApiKey = view.querySelector('#txtPosterizarrApiKey');
                    config.PosterizarrApiKey = txtApiKey ? (txtApiKey.value || "").trim() : "";

                    if (config.EnableRealtimeSync && (!config.PosterizarrApiUrl || !config.PosterizarrApiKey)) {
                        Dashboard.hideLoadingMsg();
                        Dashboard.alert({
                            message: "Posterizarr URL and API key are required when Real-Time Sync is enabled."
                        });
                        return;
                    }

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
                return false;
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();