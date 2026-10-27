import React, { useState } from "react";
import { Lock, User, Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

function LoginScreen({ onLoginSuccess }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Test the credentials by making a request with Basic Auth
      const credentials = btoa(`${username}:${password}`);
      const response = await fetch("/api/status", {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      if (response.ok) {
        // Store credentials in sessionStorage and localStorage for subsequent requests
        sessionStorage.setItem("auth_credentials", credentials);
        localStorage.setItem("auth_credentials", credentials);
        onLoginSuccess(credentials);
      } else if (response.status === 401) {
        setError(t("auth.invalidCredentials"));
      } else {
        setError(t("auth.loginError"));
      }
    } catch (err) {
      console.error("Login error:", err);
      setError(t("auth.connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-dark via-theme-darker to-theme-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="mb-6">
            <img
              src="/logo.png"
              alt="Posterizarr Logo"
              className="h-16 w-auto object-contain mx-auto"
            />
          </div>
          <p className="text-theme-muted">{t("auth.signInToContinue")}</p>
        </div>

        {/* Login Card */}
        <div className="bg-theme-card rounded-2xl shadow-2xl border border-theme p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Username Field */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-theme-text mb-2"
              >
                {t("auth.username")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="w-5 h-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-theme-primary focus:border-theme-primary text-white font-medium placeholder-gray-500 transition-all"
                  placeholder={t("auth.enterUsername")}
                  required
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-theme-text mb-2"
              >
                {t("auth.password")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-gray-400" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-12 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-theme-primary focus:border-theme-primary text-white font-medium placeholder-gray-500 transition-all"
                  placeholder={t("auth.enterPassword")}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-theme-primary hover:bg-theme-primary/90 disabled:bg-theme-primary/50 text-white font-medium rounded-lg transition-all shadow-lg hover:shadow-xl disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{t("auth.signingIn")}</span>
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  <span>{t("auth.signIn")}</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-theme-muted">
            Protected by Basic Authentication
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
