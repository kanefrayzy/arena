/** Bootstraps SEO meta tags and branding (favicon, theme-color, OG tags) from
 *  /api/seo at app start. Allows admin uploads to apply without rebuilding. */

interface SeoPayload {
  seo: Record<string, string>;
  branding: Record<string, string>;
}

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name'): void {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string, type?: string): void {
  if (!href) return;
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  if (type) el.setAttribute('type', type);
}

export async function applyBrandingAndSeo(): Promise<void> {
  try {
    const r = await fetch('/api/seo', { credentials: 'omit' });
    if (!r.ok) return;
    const data = (await r.json()) as SeoPayload;
    const { seo, branding } = data;

    // Title
    if (seo.title) document.title = seo.title;
    else if (seo.site_name) document.title = seo.site_name;

    // Theme color
    if (seo.theme_color) setMeta('theme-color', seo.theme_color);

    // Description / keywords
    if (seo.description) setMeta('description', seo.description);
    if (seo.keywords) setMeta('keywords', seo.keywords);

    // Robots — always indexable.
    setMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large');

    // Open Graph
    setMeta('og:type', 'website', 'property');
    setMeta('og:site_name', seo.site_name || 'Arena1v1', 'property');
    setMeta('og:title', seo.title || seo.site_name || 'Arena1v1', 'property');
    if (seo.description) setMeta('og:description', seo.description, 'property');
    if (seo.canonical_url) setMeta('og:url', seo.canonical_url, 'property');
    const ogImage = seo.og_image_url || branding.og_image || branding.icon512;
    if (ogImage) setMeta('og:image', ogImage, 'property');

    // Twitter
    setMeta('twitter:card', 'summary_large_image');
    if (seo.twitter_handle) setMeta('twitter:site', seo.twitter_handle);
    setMeta('twitter:title', seo.title || seo.site_name || 'Arena1v1');
    if (seo.description) setMeta('twitter:description', seo.description);
    if (ogImage) setMeta('twitter:image', ogImage);

    // Canonical
    if (seo.canonical_url) setLink('canonical', seo.canonical_url);

    // Favicon / app icon
    if (branding.favicon) {
      // Drop the static SVG icon link so the browser uses the uploaded one.
      const svgIcon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
      svgIcon?.remove();
      const ext = branding.favicon.split('?')[0]!.toLowerCase();
      const type = ext.endsWith('.svg') ? 'image/svg+xml'
        : ext.endsWith('.ico') ? 'image/x-icon'
        : ext.endsWith('.jpg') || ext.endsWith('.jpeg') ? 'image/jpeg'
        : 'image/png';
      setLink('icon', branding.favicon, type);
    }
    if (branding.icon192) setLink('apple-touch-icon', branding.icon192);

    // Apple Web App title
    if (seo.site_name) setMeta('apple-mobile-web-app-title', seo.site_name);
  } catch {
    // Non-fatal — fall back to static index.html meta.
  }
}
