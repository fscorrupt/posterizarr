import React, { useEffect, useState } from "react";
import { Server } from "lucide-react";

const logos = {
  plex: "/plex.svg",
  jellyfin: "/jellyfin.svg",
  emby: "/emby.svg",
  silo: "/silo.png",
};

export default function MediaServerLogo({ server, className = "h-5 w-5" }) {
  const logo = logos[String(server || "").toLowerCase()];
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [logo]);

  if (!logo || imgError) return <Server className={className} aria-hidden="true" />;
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      onError={() => setImgError(true)}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
