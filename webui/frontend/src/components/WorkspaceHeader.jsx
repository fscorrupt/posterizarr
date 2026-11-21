import React from "react";

export default function WorkspaceHeader({ icon: Icon, title, subtitle, children }) {
  return (
    <header className="workspace-header">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && <span className="workspace-header-icon"><Icon size={20} /></span>}
        <div className="min-w-0">
          <h1>{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-theme-muted">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="workspace-header-actions">{children}</div>}
    </header>
  );
}