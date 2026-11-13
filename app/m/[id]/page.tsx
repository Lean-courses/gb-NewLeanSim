import { getLocale } from 'next-intl/server'
import { EditorLoader } from '@/components/editor/EditorLoader'
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config'

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { id } = await params
  const { from } = await searchParams
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  return <EditorLoader id={id} locale={locale} fromTemplate={from} />
}
