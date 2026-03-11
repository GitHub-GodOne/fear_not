'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';

import { useThemeColor } from '@/shared/hooks/use-theme-color';
import {
  resolveLandingBundle,
  type LandingBundleRegistryItem,
  type LandingBundleVariantMap,
} from '@/shared/services/landing-config';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

function normalizeContainerMinHeight(height: number | string | undefined) {
  if (typeof height === 'number') {
    return `${height}px`;
  }

  if (!height) {
    return '960px';
  }

  return /^\d+$/.test(height) ? `${height}px` : height;
}

function toAbsoluteUrl(value: string, baseUrl: URL) {
  if (
    !value ||
    value.startsWith('#') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:')
  ) {
    return value;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function rewriteSrcset(srcset: string, baseUrl: URL) {
  return srcset
    .split(',')
    .map((item) => {
      const parts = item.trim().split(/\s+/);
      if (parts.length === 0) {
        return item;
      }

      parts[0] = toAbsoluteUrl(parts[0], baseUrl);
      return parts.join(' ');
    })
    .join(', ');
}

function rewriteCssUrls(cssText: string, baseUrl: URL) {
  return cssText.replace(/url\((['"]?)(.*?)\1\)/g, (full, quote, rawPath) => {
    const trimmedPath = String(rawPath).trim();
    if (
      !trimmedPath ||
      trimmedPath.startsWith('data:') ||
      trimmedPath.startsWith('blob:') ||
      trimmedPath.startsWith('http://') ||
      trimmedPath.startsWith('https://') ||
      trimmedPath.startsWith('//') ||
      trimmedPath.startsWith('#')
    ) {
      return full;
    }

    const resolvedPath = toAbsoluteUrl(trimmedPath, baseUrl);
    return `url(${quote}${resolvedPath}${quote})`;
  });
}

function rewriteElementAssets(root: ParentNode, baseUrl: URL) {
  const elements = root.querySelectorAll('*');

  elements.forEach((element) => {
    ['src', 'href', 'poster', 'action', 'data-src'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) {
        element.setAttribute(attribute, toAbsoluteUrl(value, baseUrl));
      }
    });

    const srcset = element.getAttribute('srcset');
    if (srcset) {
      element.setAttribute('srcset', rewriteSrcset(srcset, baseUrl));
    }
  });
}

function createDocumentShim(
  shadowRoot: ShadowRoot,
  styleRoot: HTMLDivElement,
  htmlRoot: HTMLElement,
  bodyRoot: HTMLElement
) {
  return {
    getElementById(id: string) {
      return bodyRoot.querySelector(`#${id}`);
    },
    querySelector(selector: string) {
      return shadowRoot.querySelector(selector);
    },
    querySelectorAll(selector: string) {
      return shadowRoot.querySelectorAll(selector);
    },
    createElement(tagName: string) {
      return document.createElement(tagName);
    },
    createTextNode(value: string) {
      return document.createTextNode(value);
    },
    body: bodyRoot,
    head: styleRoot,
    documentElement: htmlRoot,
  };
}

async function executeBundleScript(
  code: string,
  windowProxy: Record<string, any>,
  documentShim: Record<string, any>
) {
  const runner = new Function(
    'window',
    'document',
    `
      return (function () {
        ${code}
      }).call(window);
    `
  );

  return runner(windowProxy, documentShim);
}

async function renderBundleIntoShadowRoot(params: {
  shadowRoot: ShadowRoot;
  htmlText: string;
  bundleUrl: URL;
  locale: string;
  themeName: string;
  appearance: string;
}) {
  const {
    shadowRoot,
    htmlText,
    bundleUrl,
    locale,
    themeName,
    appearance,
  } = params;
  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(htmlText, 'text/html');
  const styleRoot = document.createElement('div');
  const htmlRoot = document.createElement('html');
  const bodyRoot = document.createElement('body');
  const scriptNodes = [
    ...parsedDocument.head.querySelectorAll('script'),
    ...parsedDocument.body.querySelectorAll('script'),
  ];

  shadowRoot.innerHTML = '';
  styleRoot.setAttribute('data-bundle-styles', '');
  htmlRoot.setAttribute('data-bundle-html', '');
  bodyRoot.setAttribute('data-bundle-body', '');
  shadowRoot.append(styleRoot, htmlRoot);
  htmlRoot.appendChild(bodyRoot);

  const resetStyle = document.createElement('style');
  resetStyle.textContent = `
    :host {
      display: block;
      color: inherit;
    }

    html[data-bundle-html],
    body[data-bundle-body] {
      display: block;
      margin: 0;
      min-height: 100%;
    }
  `;
  styleRoot.appendChild(resetStyle);

  Array.from(parsedDocument.documentElement.attributes).forEach((attribute) => {
    if (attribute.name === 'lang') {
      return;
    }
    htmlRoot.setAttribute(attribute.name, attribute.value);
  });

  Array.from(parsedDocument.body.attributes).forEach((attribute) => {
    bodyRoot.setAttribute(attribute.name, attribute.value);
  });

  parsedDocument.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) {
      return;
    }

    const nextLink = document.createElement('link');
    nextLink.rel = 'stylesheet';
    nextLink.href = toAbsoluteUrl(href, bundleUrl);
    styleRoot.appendChild(nextLink);
  });

  parsedDocument.querySelectorAll('style').forEach((styleNode) => {
    const styleElement = document.createElement('style');
    styleElement.textContent = rewriteCssUrls(
      styleNode.textContent || '',
      bundleUrl
    );
    styleRoot.appendChild(styleElement);
  });

  const fragment = document.createDocumentFragment();
  const contentNodes = parsedDocument.body.childNodes.length
    ? parsedDocument.body.childNodes
    : parsedDocument.documentElement.childNodes;

  contentNodes.forEach((node) => {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      ['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'BASE'].includes(
        (node as HTMLElement).tagName
      )
    ) {
      return;
    }

    fragment.appendChild(node.cloneNode(true));
  });

  bodyRoot.appendChild(fragment);
  rewriteElementAssets(htmlRoot, bundleUrl);

  const documentShim = createDocumentShim(
    shadowRoot,
    styleRoot,
    htmlRoot,
    bodyRoot
  );
  const bundleLocation = new URL(bundleUrl.toString());
  const windowProxy: Record<string, any> = {
    document: documentShim,
    location: bundleLocation,
    console,
    URL,
    URLSearchParams,
    fetch: window.fetch.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    navigator: window.navigator,
    CustomEvent,
    Event,
    HTMLElement,
    Node,
    __LANDING_BUNDLE_CONTEXT__: {
      locale,
      theme: themeName,
      appearance,
      bundleUrl: bundleLocation.toString(),
    },
  };

  for (const scriptNode of scriptNodes) {
    const scriptType = scriptNode.getAttribute('type');
    if (scriptType && scriptType !== 'text/javascript') {
      continue;
    }

    let scriptContent = scriptNode.textContent || '';
    const scriptSrc = scriptNode.getAttribute('src');

    if (scriptSrc) {
      const absoluteScriptUrl = toAbsoluteUrl(scriptSrc, bundleUrl);
      const response = await fetch(absoluteScriptUrl, {
        credentials: 'same-origin',
      });
      scriptContent = await response.text();
    }

    if (!scriptContent.trim()) {
      continue;
    }

    await executeBundleScript(scriptContent, windowProxy, documentShim);
  }
}

export function HtmlBundle({ section }: { section: Section }) {
  const locale = useLocale();
  const { currentTheme } = useThemeColor();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const bundle = useMemo(() => {
    if (!mounted) {
      return null;
    }

    return resolveLandingBundle(
      (section.registry || []) as LandingBundleRegistryItem[],
      (section.variant_map || {}) as LandingBundleVariantMap,
      locale,
      currentTheme
    );
  }, [currentTheme, locale, mounted, section.registry, section.variant_map]);

  const bundleUrl = useMemo(() => {
    if (!mounted || !bundle || typeof window === 'undefined') {
      return null;
    }

    const nextUrl = new URL(bundle.indexPath, window.location.origin);
    nextUrl.searchParams.set('locale', locale);
    nextUrl.searchParams.set('theme', currentTheme);
    nextUrl.searchParams.set('appearance', resolvedTheme || 'light');
    return nextUrl;
  }, [bundle, currentTheme, locale, resolvedTheme]);

  useEffect(() => {
    let disposed = false;

    async function loadBundle() {
      if (!hostRef.current || !bundleUrl) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await fetch(bundleUrl.toString(), {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Failed to load bundle: ${response.status}`);
        }

        const htmlText = await response.text();
        const shadowRoot =
          hostRef.current.shadowRoot ||
          hostRef.current.attachShadow({ mode: 'open' });

        await renderBundleIntoShadowRoot({
          shadowRoot,
          htmlText,
          bundleUrl,
          locale,
          themeName: currentTheme,
          appearance: resolvedTheme || 'light',
        });

        if (!disposed) {
          setLoading(false);
        }
      } catch (loadError: any) {
        if (!disposed) {
          setLoading(false);
          setError(loadError.message || 'Failed to render bundle');
        }
      }
    }

    void loadBundle();

    return () => {
      disposed = true;
    };
  }, [bundleUrl, currentTheme, locale, resolvedTheme]);

  return (
    <section
      id={section.id || 'html-bundle'}
      className={cn('w-full', section.className)}
    >
      {(section.title || section.description) && (
        <div className="mx-auto mb-6 max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          {section.title ? (
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {section.title}
            </h2>
          ) : null}
          {section.description ? (
            <p className="text-muted-foreground mt-3 text-base sm:text-lg">
              {section.description}
            </p>
          ) : null}
        </div>
      )}

      <div
        className="relative w-full overflow-hidden"
        style={{ minHeight: normalizeContainerMinHeight(section.height) }}
      >
        {bundleUrl ? (
          <>
            <div ref={hostRef} className="min-h-full w-full" />
            {loading ? (
              <div className="text-muted-foreground absolute inset-0 flex min-h-64 items-center justify-center bg-background/70 p-8 text-center text-sm">
                Loading HTML bundle...
              </div>
            ) : null}
          </>
        ) : (
          <>
            {mounted ? (
              <div className="text-muted-foreground flex min-h-64 items-center justify-center p-8 text-center text-sm">
                {section.empty_message ||
                  'No HTML bundle is available for the current locale and theme.'}
              </div>
            ) : (
              <div className="text-muted-foreground flex min-h-64 items-center justify-center p-8 text-center text-sm">
                Loading HTML bundle...
              </div>
            )}
          </>
        )}

        {error ? (
          <div className="text-muted-foreground p-4 text-sm">{error}</div>
        ) : null}
      </div>
    </section>
  );
}
