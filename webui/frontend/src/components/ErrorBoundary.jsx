import React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-gradient-to-br from-theme-dark via-theme-darker to-theme-dark flex items-center justify-center p-6 text-theme-text">
          <div className="max-w-lg w-full bg-theme-card border border-red-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-theme-text">Something went wrong</h1>
                <p className="text-xs text-theme-muted">The interface encountered an unexpected error.</p>
              </div>
            </div>

            <div className="bg-theme-bg/80 border border-theme rounded-lg p-3 my-4 overflow-x-auto text-xs font-mono text-red-300/90 max-h-40">
              {this.state.error?.message || "Unknown error occurred"}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 bg-theme-primary hover:bg-theme-primary-hover text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="py-2.5 px-4 bg-theme-bg hover:bg-theme-hover border border-theme text-theme-text text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all"
              >
                <Home className="w-4 h-4" />
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
