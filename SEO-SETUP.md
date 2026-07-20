# SEO-запуск QazDev Studio

Техническая база уже находится в репозитории: уникальные title/description главной, canonical, `ru-KZ`, Open Graph, Twitter Card, Organization/ProfessionalService/WebSite/Service/FAQ Schema.org, `robots.txt`, две карты сайта и `sitemap-index.xml`.

## 0. Сначала опубликовать

Поисковики должны видеть новую версию на `https://qazdevstudio.kz/`. После деплоя проверьте в приватном окне:

- `https://qazdevstudio.kz/` — код 200, новый дизайн;
- `https://qazdevstudio.kz/robots.txt` — открывается текстовый файл;
- `https://qazdevstudio.kz/sitemap-index.xml` — открывается XML;
- `https://qazdevstudio.kz/sitemap.xml` и `https://qazdevstudio.kz/sitemap-programmy.xml` — код 200;
- HTTP и `www` должны одним 301-редиректом вести на `https://qazdevstudio.kz/`;
- страницы программ и их кнопки скачивания должны отвечать без 404.

## 1. Google Search Console

1. Откройте [Google Search Console](https://search.google.com/search-console/).
2. Добавьте ресурс типа **Домен**: `qazdevstudio.kz`.
3. Google выдаст TXT-запись. В панели DNS домена создайте запись типа `TXT`, имя `@`, значение — строка Google. Не удаляйте её после проверки.
4. После подтверждения откройте **Индексирование → Файлы Sitemap** и отправьте `sitemap-index.xml`.
5. В **Проверка URL** по очереди проверьте и запросите индексирование:
   - `https://qazdevstudio.kz/`
   - `https://qazdevstudio.kz/programmy/`
   - 3–5 главных страниц услуг.
6. Через 7–14 дней проверьте разделы **Страницы**, **Эффективность**, **Основные интернет-показатели** и ошибки структурированных данных.

Не отправляйте сотни URL вручную: карта сайта предназначена именно для массового обнаружения. Повторный запрос одного URL не ускоряет Google.

## 2. Яндекс Вебмастер

1. Откройте [Яндекс Вебмастер](https://webmaster.yandex.ru/) и добавьте точный адрес `https://qazdevstudio.kz/`.
2. Подтвердите права одним способом:
   - рекомендованный: скачать выданный Яндексом HTML-файл и положить в корень сайта;
   - либо TXT в DNS;
   - либо метатег `<meta name="yandex-verification" content="ВАШ_КОД">` внутри `<head>` главной.
3. Не удаляйте файл/запись/метатег: Яндекс регулярно перепроверяет права.
4. Откройте **Индексирование → Файлы Sitemap**, добавьте `https://qazdevstudio.kz/sitemap-index.xml`.
5. Сначала проверьте URL в **Инструменты → Анализ robots.txt**, **Проверка ответа сервера** и **Валидатор Sitemap**.
6. В **Индексирование → Переобход страниц** отправьте главную, каталог и ключевые услуги. Лимит используйте только для новых или сильно изменённых страниц.
7. Укажите регион Казахстан/Талдыкорган, если интерфейс предлагает региональность, и добавьте компанию в Яндекс Бизнес с одинаковыми телефоном, адресом и названием.

## 3. Bing Webmaster Tools

1. Откройте [Bing Webmaster Tools](https://www.bing.com/webmasters/).
2. Выберите **Import from Google Search Console** — ресурс и карты сайта импортируются и подтверждаются автоматически.
3. В **Sitemaps** убедитесь, что принят `https://qazdevstudio.kz/sitemap-index.xml`.
4. После крупных массовых обновлений можно подключить IndexNow. Для этого Bing сгенерирует ключ; его файл нужно разместить в корне и только после этого отправлять изменённые URL. Ключ не следует придумывать заранее.

## 4. Аналитика и цели

Подключите до запуска рекламы:

- GA4 и свяжите ресурс с Search Console;
- Яндекс Метрику с Вебвизором;
- события: `whatsapp_click`, `telegram_click`, `phone_click`, `email_click`, `download_click`, отправка формы, 50%/90% прокрутки;
- в Метрике и GA4 отметьте обращения как ключевые события/конверсии;
- все рекламные ссылки создавайте с UTM через `/utm.html`.

## 5. Контроль после запуска

Через 24 часа: доступность карт и отсутствие 404. Через 7 дней: первые проиндексированные страницы и ошибки. Через 28 дней: запросы, CTR, позиции и конверсии. Каждый месяц обновляйте полезные страницы по фактическим запросам, исправляйте 404 и слабые сниппеты; не создавайте дорвеи и массовые пустые страницы.

Важно: добавление карты сайта помогает обнаружению URL, но не гарантирует индексацию или позиции. Рост даёт связка технической доступности, полезного контента, доверия, скорости и реальных переходов/конверсий.

## Официальные инструкции

- Google: [создание и отправка Sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [запрос повторного обхода](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- Яндекс: [подтверждение прав](https://yandex.com/support/webmaster/en/service/rights), [Sitemap](https://yandex.com/support/webmaster/en/indexing-options/sitemap), [валидатор Sitemap](https://yandex.com/support/webmaster/en/indexing-options/tool-sitemap)
- Bing: [добавление и подтверждение сайта](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b), [Sitemaps](https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed), [IndexNow](https://www.bing.com/webmasters/help/indexnow-0z209wby)
