import { useEffect, useState } from "react";

/** Returns the id of the section currently nearest the top of the viewport. */
export function useScrollSpy(ids: string[], ready: boolean): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "-72px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return active;
}
