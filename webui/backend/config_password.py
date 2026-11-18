def preserve_masked_basic_auth_password(config_update, current_config, current_flat):
    webui_update = config_update.get("WebUI")
    password_is_nested = isinstance(webui_update, dict) and "basicAuthPassword" in webui_update
    password_config = webui_update if password_is_nested else config_update

    if "basicAuthPassword" not in password_config or str(password_config["basicAuthPassword"]).strip():
        return password_config

    current_webui = current_config.get("WebUI")
    existing_password = current_flat.get("basicAuthPassword")
    if not existing_password and isinstance(current_webui, dict):
        existing_password = current_webui.get("basicAuthPassword")
    if not existing_password:
        existing_password = current_config.get("basicAuthPassword")

    if existing_password:
        password_config["basicAuthPassword"] = existing_password
    else:
        password_config.pop("basicAuthPassword", None)

    return password_config