import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { UNSAFE_PortalProvider } from "react-aria";
import { BLProvider, tintVars } from "@brett_lamy/ui";

// The one accent. Used for focus rings, the primary action, and the current-page marker.
export const ACCENT = "#e4a853";

// BLProvider is built for full-screen apps (fixed height, clipped, no text selection). Islands on
// ordinary pages need to size to content and keep selectable text, so those three are relaxed here.
const ISLAND_STYLE = { height: "auto", width: "auto", overflow: "visible", background: "transparent", userSelect: "auto" };

// BLProvider also makes itself the portal container, and the library's overlays are
// `absolute inset-0` within that container. An island is not viewport-sized (a header strip, a
// long page), so overlays render into a fixed viewport layer instead. The layer carries the same
// scoped tokens (.wv-ui), appearance (.dark) and accent as the island, and is click-through when
// empty.
export function UIRoot({ children, className = "", style }) {
  const [layer, setLayer] = useState(null);
  const getContainer = useCallback(() => layer, [layer]);
  return (
    <BLProvider dark tint={ACCENT} className={`wv-ui ${className}`.trim()} style={{ ...ISLAND_STYLE, ...style }}>
      <UNSAFE_PortalProvider getContainer={getContainer}>{children}</UNSAFE_PortalProvider>
      {createPortal(<div ref={setLayer} className="wv-ui wv-layer dark" data-slot="wv-layer" style={tintVars(ACCENT)} />, document.body)}
    </BLProvider>
  );
}
