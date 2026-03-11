import { localeNames } from '@/config/locale';
import { themes } from '@/config/theme/themes';
import {
  DynamicPage,
  Header,
  Section,
} from '@/shared/types/blocks/landing';

export type ConfigMap = Record<string, string | undefined>;

export const LANDING_BUNDLE_SECTION_DEFAULT_KEY = 'html-bundle';
export const LANDING_THEME_STORAGE_KEY = 'app-theme-color';

export interface LandingBundleRegistryItem {
  slug: string;
  title?: string;
  publicPath: string;
  indexPath: string;
  entryFile?: string;
  locale?: string;
  theme?: string;
  uploadedAt?: string;
}

export type LandingBundleVariantMap = Record<string, string>;

const defaultLocalePrompt = Object.entries(localeNames)
  .map(([value, label]) => `${value}: ${label}`)
  .join(', ');

const defaultThemePrompt = themes
  .map((theme) => `${theme.name}: ${theme.label} (${theme.description})`)
  .join('; ');

export const DEFAULT_OPENCLAW_PROMPT_TEMPLATES = {
  zh: `你正在为站点首页生成一个可直接发布的静态 HTML bundle，请严格遵守以下要求：
1. 输出必须是完整的静态站点资源，可打包为 zip，并且入口文件固定为 index.html。
2. 页面语言必须使用 {{locale_label}}，语言代码为 {{locale}}。所有可见文案、按钮、表单提示、日期格式都必须与该语言一致。
3. 页面视觉主题必须匹配 {{theme_label}}。主题说明：{{theme_description}}。
4. 颜色必须优先使用 CSS 变量：--primary、--secondary、--accent、--background、--foreground、--muted、--border。
5. 页面需同时兼容亮色/暗色模式。请读取 URL 查询参数 locale、theme、appearance，并在页面初始化时根据这些参数切换文案和配色。
6. 所有资源路径必须使用相对路径，不能依赖外部构建工具，不能要求额外安装依赖。
7. 设计必须适合嵌入 SaaS 首页 section，推荐内容宽度 1200px，移动端优先，自带响应式布局。
8. 如果存在按钮，请保留语义化 a / button 标签，并使用 data-cta 标记主要动作。
9. 不要输出解释文字，只输出可打包的 HTML/CSS/JS 代码与资源说明。

当前目标：
- 语言：{{locale_label}}（{{locale}}）
- 主题：{{theme_label}}
- 外观模式：{{appearance}}
- 业务说明：{{business_context}}
- section 目标：{{section_goal}}

请生成一个具有强烈品牌感、结构清晰、能直接嵌入首页的静态 HTML section。`,
  en: `Generate a production-ready static HTML bundle for a landing page section. Follow these requirements exactly:
1. Output must be a complete static site bundle that can be zipped, with index.html as the entry file.
2. The visible language must be {{locale_label}} with locale code {{locale}}. All copy, buttons, labels, and formatting must match that locale.
3. The visual direction must match {{theme_label}}. Theme description: {{theme_description}}.
4. Colors must primarily use CSS variables: --primary, --secondary, --accent, --background, --foreground, --muted, --border.
5. Support both light and dark appearance. Read locale, theme, and appearance from URL query params and adapt the page at runtime.
6. Use only relative asset paths. Do not require any external build step or extra dependency installation.
7. The result must work as a homepage section inside a SaaS landing page. Target 1200px content width and responsive mobile-first layout.
8. Keep semantic anchors/buttons. Mark the main action with data-cta.
9. Do not include explanations. Only provide the shippable HTML/CSS/JS bundle and asset notes.

Current target:
- Locale: {{locale_label}} ({{locale}})
- Theme: {{theme_label}}
- Appearance: {{appearance}}
- Business context: {{business_context}}
- Section goal: {{section_goal}}

Generate a distinctive static landing section that is ready to embed on the homepage.`,
} as const;

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(target: T, source: unknown): T {
  if (Array.isArray(source)) {
    return cloneData(source) as T;
  }

  if (!isRecord(target) || !isRecord(source)) {
    return cloneData(source as T);
  }

  const result: Record<string, any> = {
    ...target,
  };

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      result[key] = cloneData(value);
      continue;
    }

    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key], value);
      continue;
    }

    result[key] = cloneData(value);
  }

  return result as T;
}

export function parseJsonConfig<T>(
  rawValue: string | undefined,
  fallback: T
): T {
  if (!rawValue?.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    console.warn('[landing-config] invalid json config', error);
    return fallback;
  }
}

function parseBooleanConfig(
  configs: ConfigMap,
  key: string,
  fallback: boolean
): boolean {
  const rawValue = configs[key];

  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  return rawValue === 'true' || rawValue === '1';
}

function parseStringArrayConfig(
  rawValue: string | undefined,
  fallback: string[]
): string[] {
  if (!rawValue?.trim()) {
    return fallback;
  }

  if (rawValue.trim().startsWith('[')) {
    const parsed = parseJsonConfig<unknown>(rawValue, fallback);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string');
    }
  }

  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeVariantPart(value?: string) {
  if (!value || value === 'default') {
    return 'default';
  }

  return value;
}

function buildVariantLookupKeys(locale: string, themeName: string) {
  const normalizedLocale = normalizeVariantPart(locale);
  const normalizedTheme = normalizeVariantPart(themeName);

  return [
    `${normalizedLocale}:${normalizedTheme}`,
    `${normalizedLocale}:default`,
    `default:${normalizedTheme}`,
    'default:default',
    normalizedLocale,
    normalizedTheme,
    'default',
  ];
}

export function getLandingBundleRegistry(
  configs: ConfigMap
): LandingBundleRegistryItem[] {
  const registry = parseJsonConfig<LandingBundleRegistryItem[]>(
    configs.landing_home_bundle_registry,
    []
  );

  if (!Array.isArray(registry)) {
    return [];
  }

  return registry.filter(
    (item) =>
      Boolean(item?.slug) &&
      Boolean(item?.publicPath) &&
      Boolean(item?.indexPath)
  );
}

export function getLandingBundleVariantMap(
  configs: ConfigMap
): LandingBundleVariantMap {
  const variantMap = parseJsonConfig<LandingBundleVariantMap>(
    configs.landing_home_bundle_variants,
    {}
  );

  if (!isRecord(variantMap)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(variantMap).filter(
      ([key, value]) => Boolean(key) && typeof value === 'string' && Boolean(value)
    )
  );
}

export function resolveLandingBundle(
  registry: LandingBundleRegistryItem[],
  variantMap: LandingBundleVariantMap,
  locale: string,
  themeName: string
) {
  const registryMap = new Map(
    registry.map((item) => [item.slug, item] as const)
  );

  for (const lookupKey of buildVariantLookupKeys(locale, themeName)) {
    const slug = variantMap[lookupKey];
    if (slug && registryMap.has(slug)) {
      return registryMap.get(slug) ?? null;
    }
  }

  return registry[0] ?? null;
}

function getDefaultBundleText(locale: string) {
  if (locale === 'zh') {
    return {
      title: '定制首页内容',
      description:
        '这里可以加载你通过 OpenClaw 产出的静态 HTML bundle，并根据语言与主题自动切换。',
      emptyMessage:
        '当前还没有匹配的 HTML bundle。请先在后台上传 zip，并配置语言/主题映射。',
    };
  }

  return {
    title: 'Custom Homepage Content',
    description:
      'This area can load a static HTML bundle generated with OpenClaw and switch automatically by locale and theme.',
    emptyMessage:
      'No matching HTML bundle is configured yet. Upload a zip in admin and map it to the current locale/theme.',
  };
}

export function buildLandingHeader(
  locale: string,
  defaultHeader: Header,
  configs: ConfigMap
) {
  let header = cloneData(defaultHeader);

  if (configs.landing_header_brand_title) {
    header.brand = {
      ...(header.brand || {}),
      title: configs.landing_header_brand_title,
    };
  }

  if (configs.landing_header_brand_logo) {
    header.brand = {
      ...(header.brand || {}),
      logo: {
        ...(header.brand?.logo || {}),
        src: configs.landing_header_brand_logo,
      },
    };
  }

  const navConfigKey = `landing_header_nav_${locale}`;
  if (configs[navConfigKey]?.trim()) {
    const navItems = parseJsonConfig<any[]>(configs[navConfigKey], []);
    header.nav = {
      ...(header.nav || { items: [] }),
      items: navItems,
    };
  }

  const buttonConfigKey = `landing_header_buttons_${locale}`;
  if (configs[buttonConfigKey]?.trim()) {
    const buttons = parseJsonConfig<any[]>(configs[buttonConfigKey], []);
    header.buttons = buttons;
  }

  const topbannerText = configs[`landing_header_topbanner_${locale}`];
  if (topbannerText) {
    header.topbanner = {
      ...(header.topbanner || {}),
      text: topbannerText,
    };
  }

  header.show_sign = parseBooleanConfig(
    configs,
    'landing_header_show_sign',
    header.show_sign ?? true
  );
  header.show_locale = parseBooleanConfig(
    configs,
    'landing_header_show_locale',
    Boolean(header.show_locale)
  );
  header.show_theme_toggler = parseBooleanConfig(
    configs,
    'landing_header_show_theme_toggler',
    Boolean(header.show_theme_toggler)
  );
  header.show_theme_switcher = parseBooleanConfig(
    configs,
    'landing_header_show_theme_switcher',
    Boolean(header.show_theme_switcher)
  );
  header.show_notification = parseBooleanConfig(
    configs,
    'landing_header_show_notification',
    header.show_notification ?? true
  );

  const override = parseJsonConfig<Header | null>(
    configs[`landing_header_override_${locale}`],
    null
  );
  if (override) {
    header = deepMerge(header, override);
  }

  return header;
}

export function buildLandingPage(
  locale: string,
  defaultPage: DynamicPage,
  configs: ConfigMap
) {
  let page = cloneData(defaultPage);

  const pageOverride = parseJsonConfig<DynamicPage | null>(
    configs[`landing_home_override_${locale}`],
    null
  );
  if (pageOverride) {
    page = deepMerge(page, pageOverride);
  }

  const sectionOverrides = parseJsonConfig<Record<string, Section> | null>(
    configs[`landing_home_section_overrides_${locale}`],
    null
  );
  if (sectionOverrides) {
    page.sections = deepMerge(page.sections || {}, sectionOverrides);
  }

  const showSectionKey = `landing_home_show_sections_${locale}`;
  if (configs[showSectionKey]?.trim()) {
    const showSections = parseStringArrayConfig(
      configs[showSectionKey],
      page.show_sections || []
    );
    page.show_sections = showSections;
  }

  const bundleEnabled = parseBooleanConfig(
    configs,
    'landing_home_bundle_enabled',
    false
  );
  if (!bundleEnabled) {
    return page;
  }

  const registry = getLandingBundleRegistry(configs);
  const variantMap = getLandingBundleVariantMap(configs);
  const bundleText = getDefaultBundleText(locale);
  const sectionKey =
    configs.landing_home_bundle_section_key || LANDING_BUNDLE_SECTION_DEFAULT_KEY;
  const heightValue = configs.landing_home_bundle_height || '960';

  const bundleSection: Section = {
    id: sectionKey,
    block: 'html-bundle',
    title: configs[`landing_home_bundle_title_${locale}`] || undefined,
    description:
      configs[`landing_home_bundle_description_${locale}`] || undefined,
    height: Number.isNaN(Number(heightValue))
      ? heightValue
      : Number(heightValue),
    registry,
    variant_map: variantMap,
    empty_message:
      configs[`landing_home_bundle_empty_message_${locale}`] ||
      bundleText.emptyMessage,
    className: configs.landing_home_bundle_classname,
  };

  page.sections = page.sections || {};
  page.sections[sectionKey] = deepMerge(
    bundleSection,
    page.sections[sectionKey] || {}
  );

  const resolvedShowSections = [...(page.show_sections || [])];
  if (!resolvedShowSections.includes(sectionKey)) {
    resolvedShowSections.push(sectionKey);
  }
  page.show_sections = resolvedShowSections;

  return page;
}

export function getThemePromptContext(themeName: string) {
  return (
    themes.find((theme) => theme.name === themeName) || {
      name: themeName,
      label: themeName,
      description: 'Custom theme',
    }
  );
}

export function getDefaultOpenClawPromptTemplate(locale: string) {
  return locale === 'zh'
    ? DEFAULT_OPENCLAW_PROMPT_TEMPLATES.zh
    : DEFAULT_OPENCLAW_PROMPT_TEMPLATES.en;
}

export function getOpenClawPromptTemplate(
  locale: string,
  configs: ConfigMap
) {
  return (
    configs[`landing_openclaw_prompt_${locale}`] ||
    getDefaultOpenClawPromptTemplate(locale)
  );
}

export function renderOpenClawPromptTemplate(
  template: string,
  values: Record<string, string>
) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    return values[key] ?? '';
  });
}

export const OPENCLAW_PROMPT_PLACEHOLDER_HELP = {
  locale: defaultLocalePrompt,
  theme: defaultThemePrompt,
};
