/**
 * i18n sin routing por URL.
 *
 * El idioma vive en una cookie, no en el path. Para una herramienta que se usa
 * en vivo frente a una sala, cambiar de idioma tiene que ser un toggle en el
 * header, no una navegacion que pierda el estado del modelo que se esta
 * mostrando.
 */

import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config'

export default getRequestConfig(async () => {
  const store = await cookies()
  const fromCookie = store.get(LOCALE_COOKIE)?.value
  const locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
