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
            var chkUpdateCollection = view.querySelector('#chkUpdateCollection');

            if (chkUpdatePoster) chkUpdatePoster.checked = config.UpdatePoster !== false;
            if (chkUpdateSeason) chkUpdateSeason.checked = config.UpdateSeason !== false;
            if (chkUpdateTitlecard) chkUpdateTitlecard.checked = config.UpdateTitlecard !== false;
            if (chkUpdateBackdrop) chkUpdateBackdrop.checked = config.UpdateBackdrop !== false;
            if (chkUpdateThumbnail) chkUpdateThumbnail.checked = config.UpdateThumbnail || false;
            if (chkUpdateCollection) chkUpdateCollection.checked = config.UpdateCollection || false;

            var chkRealtime = view.querySelector('#chkEnableRealtimeSync');
            if (chkRealtime) chkRealtime.checked = config.EnableRealtimeSync || false;
            var txtUrl = view.querySelector('#txtPosterizarrApiUrl');
            if (txtUrl) txtUrl.value = config.PosterizarrApiUrl || '';
            var txtKey = view.querySelector('#txtPosterizarrApiKey');
            if (txtKey) txtKey.value = config.PosterizarrApiKey || '';

            // Plex Direct Sync bindings & mutual exclusivity
            var chkPlexSync = view.querySelector('#chkEnablePlexSync');
            var plexSection = view.querySelector('#plexSyncSettingsSection');
            var plexNotice = view.querySelector('#plexSyncWarningNotice');

            function updateSyncExclusivity(isPlexActive) {
                if (plexSection) plexSection.style.display = isPlexActive ? 'block' : 'none';
                if (plexNotice) plexNotice.style.display = isPlexActive ? 'block' : 'none';
            }

            if (chkPlexSync) {
                chkPlexSync.checked = config.EnablePlexSync || false;
                updateSyncExclusivity(chkPlexSync.checked);
                chkPlexSync.onchange = function () {
                    updateSyncExclusivity(this.checked);
                };
            }

            var txtPlexUrl = view.querySelector('#txtPlexServerUrl');
            if (txtPlexUrl) txtPlexUrl.value = config.PlexServerUrl || '';
            var txtPlexToken = view.querySelector('#txtPlexToken');
            if (txtPlexToken) txtPlexToken.value = config.PlexToken || '';
            var txtPlexLibs = view.querySelector('#txtPlexLibrariesToInclude');
            if (txtPlexLibs) txtPlexLibs.value = config.PlexLibrariesToInclude || '';

            var chkPlexMovies = view.querySelector('#chkPlexSyncMovies');
            var chkPlexShows = view.querySelector('#chkPlexSyncShows');
            var chkPlexSeasons = view.querySelector('#chkPlexSyncSeasons');
            var chkPlexTitlecards = view.querySelector('#chkPlexSyncTitlecards');
            var chkPlexBackdrops = view.querySelector('#chkPlexSyncBackdrops');

            if (chkPlexMovies) chkPlexMovies.checked = config.PlexSyncMovies !== false;
            if (chkPlexShows) chkPlexShows.checked = config.PlexSyncShows !== false;
            if (chkPlexSeasons) chkPlexSeasons.checked = config.PlexSyncSeasons !== false;
            if (chkPlexTitlecards) chkPlexTitlecards.checked = config.PlexSyncTitlecards !== false;
            if (chkPlexBackdrops) chkPlexBackdrops.checked = config.PlexSyncBackdrops || false;

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
            var chkUpdateCollection = view.querySelector('#chkUpdateCollection');

            if (chkUpdatePoster) config.UpdatePoster = chkUpdatePoster.checked;
            if (chkUpdateSeason) config.UpdateSeason = chkUpdateSeason.checked;
            if (chkUpdateTitlecard) config.UpdateTitlecard = chkUpdateTitlecard.checked;
            if (chkUpdateBackdrop) config.UpdateBackdrop = chkUpdateBackdrop.checked;
            if (chkUpdateThumbnail) config.UpdateThumbnail = chkUpdateThumbnail.checked;
            if (chkUpdateCollection) config.UpdateCollection = chkUpdateCollection.checked;

            var chkEnablePlex = view.querySelector('#chkEnablePlexSync');
            config.EnablePlexSync = chkEnablePlex ? chkEnablePlex.checked : false;

            var chkRealtime = view.querySelector('#chkEnableRealtimeSync');
            config.EnableRealtimeSync = chkRealtime ? chkRealtime.checked : false;

            var txtUrl = view.querySelector('#txtPosterizarrApiUrl');
            config.PosterizarrApiUrl = txtUrl ? (txtUrl.value || '').trim() : '';
            var txtKey = view.querySelector('#txtPosterizarrApiKey');
            config.PosterizarrApiKey = txtKey ? (txtKey.value || '').trim() : '';

            var txtPlexUrl = view.querySelector('#txtPlexServerUrl');
            config.PlexServerUrl = txtPlexUrl ? (txtPlexUrl.value || '').trim() : '';
            var txtPlexToken = view.querySelector('#txtPlexToken');
            config.PlexToken = txtPlexToken ? (txtPlexToken.value || '').trim() : '';
            var txtPlexLibs = view.querySelector('#txtPlexLibrariesToInclude');
            config.PlexLibrariesToInclude = txtPlexLibs ? (txtPlexLibs.value || '').trim() : '';

            var chkPlexMovies = view.querySelector('#chkPlexSyncMovies');
            var chkPlexShows = view.querySelector('#chkPlexSyncShows');
            var chkPlexSeasons = view.querySelector('#chkPlexSyncSeasons');
            var chkPlexTitlecards = view.querySelector('#chkPlexSyncTitlecards');
            var chkPlexBackdrops = view.querySelector('#chkPlexSyncBackdrops');

            if (chkPlexMovies) config.PlexSyncMovies = chkPlexMovies.checked;
            if (chkPlexShows) config.PlexSyncShows = chkPlexShows.checked;
            if (chkPlexSeasons) config.PlexSyncSeasons = chkPlexSeasons.checked;
            if (chkPlexTitlecards) config.PlexSyncTitlecards = chkPlexTitlecards.checked;
            if (chkPlexBackdrops) config.PlexSyncBackdrops = chkPlexBackdrops.checked;

            if (config.EnableRealtimeSync && (!config.PosterizarrApiUrl || !config.PosterizarrApiKey)) {
                loading.hide();
                Dashboard.alert({
                    message: "Posterizarr URL and API key are required when Real-Time Sync is enabled."
                });
                return;
            }

            if (config.EnablePlexSync && (!config.PlexServerUrl || !config.PlexToken)) {
                loading.hide();
                Dashboard.alert({
                    message: "Plex Server URL and Plex Token are required when Plex Direct Sync is enabled."
                });
                return;
            }

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

        var btnTest = view.querySelector('#btnTestPosterizarr');
        var resultDiv = view.querySelector('#testConnectionResult');
        if (btnTest) {
            btnTest.addEventListener('click', function (e) {
                e.preventDefault();
                var rawUrl = (view.querySelector('#txtPosterizarrApiUrl').value || '').trim();
                var apiKey = (view.querySelector('#txtPosterizarrApiKey').value || '').trim();

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

                var probeUrl = rawUrl.replace(/\/+$/, '') + '/ws/events';
                var headers = { 'X-API-Key': apiKey };

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
                                '<span style="color: #aaa; font-size: 0.9em;">The browser cannot resolve container hostnames directly, but Emby can. Save settings to connect.</span>';
                            return;
                        }
                        resultDiv.textContent = 'Cannot reach Posterizarr from browser. If running on LAN or Docker, save settings to test server-side.';
                        resultDiv.style.color = '#e63946';
                    });
            });
        }

        var btnTestPlex = view.querySelector('#btnTestPlex');
        var plexResultDiv = view.querySelector('#testPlexConnectionResult');
        if (btnTestPlex) {
            btnTestPlex.addEventListener('click', function (e) {
                e.preventDefault();
                var rawUrl = (view.querySelector('#txtPlexServerUrl').value || '').trim();
                var token = (view.querySelector('#txtPlexToken').value || '').trim();

                if (!rawUrl) {
                    if (plexResultDiv) {
                        plexResultDiv.textContent = 'Please enter a Plex server URL.';
                        plexResultDiv.style.color = '#e5a00d';
                    }
                    return;
                }

                if (!token) {
                    if (plexResultDiv) {
                        plexResultDiv.textContent = 'Please enter a Plex token.';
                        plexResultDiv.style.color = '#e5a00d';
                    }
                    return;
                }

                if (plexResultDiv) {
                    plexResultDiv.textContent = 'Testing connection...';
                    plexResultDiv.style.color = '#aaa';
                }

                var probeUrl = rawUrl.replace(/\/+$/, '') + '/identity';
                var headers = { 'X-Plex-Token': token, 'Accept': 'application/json' };

                fetch(probeUrl, { method: 'GET', headers: headers })
                    .then(function (res) {
                        if (!plexResultDiv) return;
                        if (res.ok || res.status === 200) {
                            plexResultDiv.textContent = 'Connected to Plex successfully.';
                            plexResultDiv.style.color = '#52b788';
                        } else if (res.status === 401 || res.status === 403) {
                            plexResultDiv.textContent = 'Authentication failed (HTTP ' + res.status + '). Please check your Plex token.';
                            plexResultDiv.style.color = '#e63946';
                        } else {
                            plexResultDiv.textContent = 'Plex returned HTTP ' + res.status;
                            plexResultDiv.style.color = '#e5a00d';
                        }
                    })
                    .catch(function (err) {
                        if (!plexResultDiv) return;
                        if (window.location.protocol === 'https:' && rawUrl.toLowerCase().startsWith('http://')) {
                            plexResultDiv.innerHTML = '<span style="color: #e5a00d;">⚠️ Direct test blocked by browser (mixed HTTPS/HTTP content).</span><br/>' +
                                '<span style="color: #aaa; font-size: 0.9em;">The server connects directly in the background. Save settings and check server logs.</span>';
                            return;
                        }
                        if (!rawUrl.includes('.') && !rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
                            plexResultDiv.innerHTML = '<span style="color: #52b788;">ℹ️ Internal Docker hostname detected.</span><br/>' +
                                '<span style="color: #aaa; font-size: 0.9em;">The browser cannot resolve container hostnames directly, but Emby can. Save settings to connect.</span>';
                            return;
                        }
                        plexResultDiv.textContent = 'Cannot reach Plex from browser. If running on LAN or Docker, save settings to test server-side.';
                        plexResultDiv.style.color = '#e63946';
                    });
            });
        }

        view.querySelector('#PosterizarrConfigForm').addEventListener('submit', function (e) {
            e.preventDefault();
            saveConfig(view);
            return false;
        });
    };
});
