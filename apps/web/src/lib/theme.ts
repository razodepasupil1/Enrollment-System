import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";
const read = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch { /* private mode: the choice just will not persist */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
