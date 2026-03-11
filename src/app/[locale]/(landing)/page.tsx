import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { getAllConfigs } from '@/shared/models/config';
import { buildLandingPage } from '@/shared/services/landing-config';
import { DynamicPage } from '@/shared/types/blocks/landing';

export const revalidate = 3600;

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.index');
  const configs = await getAllConfigs();

  // get page data
  const page: DynamicPage = buildLandingPage(locale, t.raw('page'), configs);

  // load page component
  const Page = await getThemePage('dynamic-page');

  return <Page locale={locale} page={page} />;
}
