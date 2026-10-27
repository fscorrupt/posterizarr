import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }) {
  const [isAuthEnabled, setIsAuthEnabled] = useState(null); // null = loading, true/false = known
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authCredentials, setAuthCredentials] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check if auth is enabled on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      // Check if credentials are stored in sessionStorage or localStorage
      const storedCredentials = sessionStorage.getItem("auth_credentials") || localStorage.getItem("auth_credentials");

      // Call the /api/auth/check endpoint to see if auth is enabled
      const response = await fetch("/api/auth/check", {
        headers: storedCredentials
          ? { Authorization: `Basic ${storedCredentials}` }
          : {},
      });

      const data = await response.json();

      console.log("Auth status check:", data);

      // Backend returns: { enabled: bool, authenticated: bool }
      setIsAuthEnabled(data.enabled);

      if (!data.enabled) {
        // Auth is disabled, allow access
        setIsAuthenticated(true);
        setLoading(false);
      } else {
        // Auth is enabled, check if we have valid credentials
        if (storedCredentials && response.ok && data.authenticated) {
          // Valid credentials found
          setAuthCredentials(storedCredentials);
          setIsAuthenticated(true);
        } else {
          // No valid credentials
          setIsAuthenticated(false);
        }
        setLoading(false);
      }
    } catch (error) {
      console.error("Failed to check auth status:", error);
      // On error, assume no auth required (fail open)
      setIsAuthEnabled(false);
      setIsAuthenticated(true);
      setLoading(false);
    }
  };

  const login = (credentials) => {
    sessionStorage.setItem("auth_credentials", credentials);
    localStorage.setItem("auth_credentials", credentials);
    setAuthCredentials(credentials);
    setIsAuthenticated(true);
  };

  const logout = () => {
    sessionStorage.removeItem("auth_credentials");
    localStorage.removeItem("auth_credentials");
    setAuthCredentials(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthEnabled,
        isAuthenticated,
        authCredentials,
        loading,
        login,
        logout,
        checkAuthStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
