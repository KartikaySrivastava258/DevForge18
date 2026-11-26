import { memo, useCallback, type MouseEvent } from "react";
import { handleInternalLinkClick } from "./router.tsx";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard API unavailable (e.g. plain-http site); the code stays selectable
  }
}

/**
 * A compiled lesson or lab body. It is static HTML, memoised so that
 * re-renders of the page (scroll-spy updates, announcements, progress) never
 * make React re-insert the article, which would discard text selection and
 * DOM state such as a "Copied" button label.
 */
export const ArticleBody = memo(function ArticleBody({ html, onClick }: { html: string; onClick: (e: MouseEvent<HTMLElement>) => void }) {
  // HTML is rendered at build time from reviewed Markdown with raw HTML escaped (scripts/lib/markdown.ts).
  return <article className="article" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Click handler for article bodies: copy buttons on code blocks, and in-app links. */
export function useArticleClick(announce: (message: string) => void) {
  return useCallback(
    async (e: MouseEvent<HTMLElement>) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
      if (button) {
        const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
        const ok = await copyText(code);
        button.textContent = ok ? "Copied" : "Select and copy";
        button.dataset.state = ok ? "copied" : "";
        announce(ok ? "Code copied to clipboard" : "Copy is unavailable here; select the code to copy it");
        window.setTimeout(() => {
          button.textContent = "Copy";
          button.dataset.state = "";
        }, 2000);
        return;
      }
      handleInternalLinkClick(e);
    },
    [announce],
  );
}
