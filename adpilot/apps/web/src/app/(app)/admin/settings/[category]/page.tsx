import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SETTINGS_SLUGS, categoryBySlug } from '@/features/admin-settings/categories';
import { SettingsCategoryPage } from '@/features/admin-settings/settings-category-page';

export const dynamicParams = false;

export function generateStaticParams() {
  return SETTINGS_SLUGS.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  return { title: `${categoryBySlug(category)?.title ?? 'Settings'} · System settings` };
}

export default async function AdminSettingsCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!categoryBySlug(category)) notFound();
  return <SettingsCategoryPage slug={category} />;
}
