/** Preserve relative assets when inline HTML is detached from its origin. */
export function withBaseHref(html: string, url: string): string {
  if (/<base\s/i.test(html)) {
    return html;
  }
  const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const baseTag = `<base href="${escaped}">`;
  const headOpen = /<head\b[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return `${html.slice(0, at)}${baseTag}${html.slice(at)}`;
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${baseTag}</head>${html.slice(at)}`;
  }
  return `${baseTag}${html}`;
}
