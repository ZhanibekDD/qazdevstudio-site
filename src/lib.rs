use std::{collections::HashMap, path::PathBuf, sync::Arc};

use askama::Template;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderValue, StatusCode, Uri, header},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

const DOMAIN: &str = "https://qazdevstudio.kz";
const SOFTWARE_JSON: &str = include_str!("../data/software.json");
const SITE_CSS: &str = include_str!("../rust-static/site.css");
const SITE_JS: &str = include_str!("../rust-static/site.js");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Software {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub category_label: String,
    #[serde(default)]
    pub short_description: String,
    #[serde(default)]
    pub full_description: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub downloads: Vec<SoftwareDownload>,
    #[serde(default)]
    pub developer: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub verified_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SoftwareDownload {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Clone)]
pub struct AppState {
    software: Arc<Vec<Software>>,
    software_index: Arc<HashMap<String, usize>>,
    legacy_root: Arc<PathBuf>,
}

impl AppState {
    pub fn from_environment() -> Self {
        let legacy_root = std::env::var("LEGACY_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        Self::new(legacy_root)
    }

    pub fn new(legacy_root: PathBuf) -> Self {
        let software: Vec<Software> =
            serde_json::from_str(SOFTWARE_JSON).expect("data/software.json must be valid JSON");
        let software_index = software
            .iter()
            .enumerate()
            .map(|(index, app)| (app.slug.clone(), index))
            .collect();

        Self {
            software: Arc::new(software),
            software_index: Arc::new(software_index),
            legacy_root: Arc::new(legacy_root),
        }
    }
}

pub fn app(state: AppState) -> Router {
    let legacy = state.legacy_root.as_ref();
    let assets = ServeDir::new(legacy.join("assets"));
    let old_css = ServeDir::new(legacy.join("css"));
    let old_js = ServeDir::new(legacy.join("js"));
    let solutions = ServeDir::new(legacy.join("solutions"));
    let templates = ServeDir::new(legacy.join("templates"));

    Router::new()
        .route("/", get(home))
        .route("/index.html", get(home))
        .route("/razrabotka-saitov-kazakhstan.html", get(service_page))
        .route("/razrabotka-saitov-astana.html", get(service_page))
        .route("/razrabotka-saitov-almaty.html", get(service_page))
        .route("/razrabotka-saitov-karaganda.html", get(service_page))
        .route("/razrabotka-saitov-shymkent.html", get(service_page))
        .route("/razrabotka-saitov-taldykorgan.html", get(service_page))
        .route("/telegram-bot-kazakhstan.html", get(service_page))
        .route("/crm-dlya-biznesa-kazakhstan.html", get(service_page))
        .route("/avtomatizaciya-biznesa-kazakhstan.html", get(service_page))
        .route(
            "/telegram-bot-dlya-biznesa.html",
            get(|| async { Redirect::permanent("/telegram-bot-kazakhstan.html") }),
        )
        .route(
            "/crm-dlya-malogo-biznesa.html",
            get(|| async { Redirect::permanent("/crm-dlya-biznesa-kazakhstan.html") }),
        )
        .route(
            "/avtomatizaciya-biznesa.html",
            get(|| async { Redirect::permanent("/avtomatizaciya-biznesa-kazakhstan.html") }),
        )
        .route("/blog/", get(blog_index))
        .route("/blog/index.html", get(blog_index))
        .route("/blog/{file}", get(blog_article))
        .route("/programmy/", get(catalog))
        .route("/programmy/index.html", get(catalog))
        .route("/programmy/{file}", get(program_detail))
        .route("/api/programs", get(programs_api))
        .route("/api/track", post(track_compatibility))
        .route("/api/track.php", post(track_compatibility))
        .route("/health", get(health))
        .route("/site.css", get(site_css))
        .route("/site.js", get(site_js))
        .route("/robots.txt", get(robots))
        .route("/ads.txt", get(ads_txt))
        .route("/sitemap-index.xml", get(sitemap_index))
        .route("/sitemap.xml", get(sitemap_main))
        .route("/sitemap-programmy.xml", get(sitemap_programs))
        .nest_service("/assets", assets)
        .nest_service("/css", old_css)
        .nest_service("/js", old_js)
        .nest_service("/solutions", solutions)
        .nest_service("/templates", templates)
        .route_service("/favicon.svg", ServeFile::new(legacy.join("favicon.svg")))
        .route_service(
            "/site.webmanifest",
            ServeFile::new(legacy.join("site.webmanifest")),
        )
        .fallback(legacy_root_page)
        .with_state(state)
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(TraceLayer::new_for_http())
}

async fn home() -> impl IntoResponse {
    render(HomeTemplate)
}

async fn service_page(uri: Uri) -> impl IntoResponse {
    let path = uri.path();
    let service = ServicePage::from_path(path);
    render(ServiceTemplate { service })
}

async fn blog_index() -> impl IntoResponse {
    render(BlogTemplate {
        articles: blog_articles(),
    })
}

async fn blog_article(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let Some(slug) = file.strip_suffix(".html") else {
        return not_found();
    };
    if !valid_slug(slug) {
        return not_found();
    }

    let path = state.legacy_root.join("blog").join(format!("{slug}.html"));
    let Ok(source) = tokio::fs::read_to_string(path).await else {
        return not_found();
    };
    let Some(main) = extract_between(&source, "<main>", "</main>") else {
        return not_found();
    };

    let title = extract_meta(&source, "<title>", "</title>")
        .unwrap_or_else(|| "Блог QazDev Studio".to_string());
    let description = extract_meta_content(&source, "description")
        .unwrap_or_else(|| "Практический разбор от QazDev Studio".to_string());
    let canonical = format!("{DOMAIN}/blog/{slug}.html");

    render(ArticleTemplate {
        title,
        description,
        canonical,
        body: main,
    })
}

async fn catalog(State(state): State<AppState>) -> impl IntoResponse {
    let preferred = [
        "sharex",
        "vlc",
        "firefox",
        "7zip",
        "obs-studio",
        "telegram-desktop",
        "wireguard",
        "wireshark",
        "yt-dlp",
        "winmerge",
        "zotero",
        "vscodium",
    ];
    let mut featured = Vec::new();
    for slug in preferred {
        if let Some(index) = state.software_index.get(slug) {
            featured.push(state.software[*index].clone());
        }
    }
    for app in state.software.iter() {
        if featured.len() >= 12 {
            break;
        }
        if !featured.iter().any(|item| item.slug == app.slug) {
            featured.push(app.clone());
        }
    }

    render(CatalogTemplate {
        count: state.software.len(),
        featured,
    })
}

async fn program_detail(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let Some(slug) = file.strip_suffix(".html") else {
        return not_found();
    };
    if !valid_slug(slug) {
        return not_found();
    }
    let Some(index) = state.software_index.get(slug).copied() else {
        return not_found();
    };
    let app = state.software[index].clone();
    let related = state
        .software
        .iter()
        .filter(|item| item.slug != app.slug && item.category == app.category)
        .take(4)
        .cloned()
        .collect();

    render(ProgramTemplate { app, related })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgramSearchItem {
    slug: String,
    name: String,
    category: String,
    category_label: String,
    description: String,
    platforms: Vec<String>,
    icon: String,
}

async fn programs_api(State(state): State<AppState>) -> impl IntoResponse {
    let programs = state
        .software
        .iter()
        .map(|app| ProgramSearchItem {
            slug: app.slug.clone(),
            name: app.name.clone(),
            category: app.category.clone(),
            category_label: app.category_label.clone(),
            description: app.short_description.clone(),
            platforms: app.platforms.clone(),
            icon: app.icon.clone(),
        })
        .collect::<Vec<_>>();
    Json(programs)
}

async fn track_compatibility() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "runtime": "rust",
        "programs": state.software.len()
    }))
}

async fn site_css() -> Response {
    static_asset(SITE_CSS, "text/css; charset=utf-8", "public, max-age=86400")
}

async fn site_js() -> Response {
    static_asset(
        SITE_JS,
        "text/javascript; charset=utf-8",
        "public, max-age=86400",
    )
}

async fn robots() -> Response {
    text_response(
        "User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://qazdevstudio.kz/sitemap-index.xml\n",
        "text/plain; charset=utf-8",
    )
}

async fn ads_txt() -> Response {
    text_response(
        "google.com, pub-8638191147118359, DIRECT, f08c47fec0942fa0\n",
        "text/plain; charset=utf-8",
    )
}

async fn sitemap_index() -> Response {
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"><sitemap><loc>{DOMAIN}/sitemap.xml</loc></sitemap><sitemap><loc>{DOMAIN}/sitemap-programmy.xml</loc></sitemap></sitemapindex>"
    );
    text_response(&body, "application/xml; charset=utf-8")
}

async fn sitemap_main() -> Response {
    let mut urls = vec![
        "/".to_string(),
        "/razrabotka-saitov-kazakhstan.html".to_string(),
        "/razrabotka-saitov-astana.html".to_string(),
        "/razrabotka-saitov-almaty.html".to_string(),
        "/razrabotka-saitov-karaganda.html".to_string(),
        "/razrabotka-saitov-shymkent.html".to_string(),
        "/razrabotka-saitov-taldykorgan.html".to_string(),
        "/telegram-bot-kazakhstan.html".to_string(),
        "/crm-dlya-biznesa-kazakhstan.html".to_string(),
        "/avtomatizaciya-biznesa-kazakhstan.html".to_string(),
        "/blog/".to_string(),
        "/programmy/".to_string(),
        "/calculator.html".to_string(),
        "/tz-generator.html".to_string(),
        "/utm.html".to_string(),
        "/obrabotka-izobrazheniy-online.html".to_string(),
    ];
    urls.extend(
        blog_articles()
            .into_iter()
            .map(|article| format!("/blog/{}.html", article.slug)),
    );
    xml_urlset(urls)
}

async fn sitemap_programs(State(state): State<AppState>) -> Response {
    xml_urlset(
        state
            .software
            .iter()
            .map(|app| format!("/programmy/{}.html", app.slug)),
    )
}

async fn legacy_root_page(State(state): State<AppState>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.is_empty()
        || path.contains('/')
        || !path.ends_with(".html")
        || !path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return not_found();
    }

    match tokio::fs::read_to_string(state.legacy_root.join(path)).await {
        Ok(body) => Html(body).into_response(),
        Err(_) => not_found(),
    }
}

fn xml_urlset<I>(paths: I) -> Response
where
    I: IntoIterator<Item = String>,
{
    let mut body = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
    );
    for path in paths {
        body.push_str("<url><loc>");
        body.push_str(DOMAIN);
        body.push_str(&path);
        body.push_str("</loc></url>");
    }
    body.push_str("</urlset>");
    text_response(&body, "application/xml; charset=utf-8")
}

fn static_asset(body: &'static str, content_type: &'static str, cache: &'static str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(body))
        .expect("valid static response")
}

fn text_response(body: &str, content_type: &'static str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(body.to_owned()))
        .expect("valid text response")
}

fn render(template: impl Template) -> Response {
    match template.render() {
        Ok(body) => Html(body).into_response(),
        Err(error) => {
            tracing::error!(%error, "template rendering failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn not_found() -> Response {
    match NotFoundTemplate.render() {
        Ok(body) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(body))
            .expect("valid not-found response"),
        Err(error) => {
            tracing::error!(%error, "not-found template rendering failed");
            StatusCode::NOT_FOUND.into_response()
        }
    }
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn extract_between(source: &str, start: &str, end: &str) -> Option<String> {
    let start_index = source.find(start)? + start.len();
    let end_index = source[start_index..].find(end)? + start_index;
    Some(source[start_index..end_index].to_owned())
}

fn extract_meta(source: &str, start: &str, end: &str) -> Option<String> {
    extract_between(source, start, end).map(|value| value.trim().to_string())
}

fn extract_meta_content(source: &str, name: &str) -> Option<String> {
    let needle = format!("<meta name=\"{name}\" content=\"");
    let start = source.find(&needle)? + needle.len();
    let end = source[start..].find('"')? + start;
    Some(source[start..end].to_string())
}

#[derive(Template)]
#[template(path = "home.html")]
struct HomeTemplate;

#[derive(Template)]
#[template(path = "service.html")]
struct ServiceTemplate {
    service: ServicePage,
}

#[derive(Template)]
#[template(path = "blog.html")]
struct BlogTemplate {
    articles: Vec<Article>,
}

#[derive(Template)]
#[template(path = "article.html")]
struct ArticleTemplate {
    title: String,
    description: String,
    canonical: String,
    body: String,
}

#[derive(Template)]
#[template(path = "catalog.html")]
struct CatalogTemplate {
    count: usize,
    featured: Vec<Software>,
}

#[derive(Template)]
#[template(path = "program.html")]
struct ProgramTemplate {
    app: Software,
    related: Vec<Software>,
}

#[derive(Template)]
#[template(path = "404.html")]
struct NotFoundTemplate;

#[derive(Debug, Clone)]
struct ServicePage {
    title: &'static str,
    description: &'static str,
    canonical: &'static str,
    eyebrow: &'static str,
    heading: &'static str,
    lead: &'static str,
    location_note: &'static str,
    offer: &'static str,
    deliverables: Vec<&'static str>,
    packages: Vec<PricePackage>,
    faqs: Vec<Faq>,
}

impl ServicePage {
    fn from_path(path: &str) -> Self {
        match path {
            "/razrabotka-saitov-astana.html" => Self::city(
                "Астана",
                "Создание и разработка сайтов в Астане — цены и примеры | QazDev",
                "Разработка сайтов для бизнеса в Астане: структура, дизайн, программирование, SEO и запуск. Цены от 150 000 ₸, работа напрямую с разработчиком.",
                "https://qazdevstudio.kz/razrabotka-saitov-astana.html",
            ),
            "/razrabotka-saitov-almaty.html" => Self::city(
                "Алматы",
                "Разработка сайтов в Алматы под ключ — QazDev Studio",
                "Сайты и веб-сервисы для бизнеса Алматы. Прямое общение с разработчиком, фиксированные этапы и честная стоимость.",
                "https://qazdevstudio.kz/razrabotka-saitov-almaty.html",
            ),
            "/razrabotka-saitov-karaganda.html" => Self::city(
                "Караганда",
                "Разработка сайтов в Караганде под ключ — QazDev Studio",
                "Проектирование и разработка сайтов для компаний Караганды. Дизайн, программирование, запуск и поддержка.",
                "https://qazdevstudio.kz/razrabotka-saitov-karaganda.html",
            ),
            "/razrabotka-saitov-shymkent.html" => Self::city(
                "Шымкент",
                "Разработка сайтов в Шымкенте под ключ — QazDev Studio",
                "Сайты для бизнеса Шымкента: от структуры и дизайна до запуска и аналитики. Работа напрямую с разработчиком.",
                "https://qazdevstudio.kz/razrabotka-saitov-shymkent.html",
            ),
            "/razrabotka-saitov-taldykorgan.html" => Self::city(
                "Талдыкорган",
                "Разработка сайтов в Талдыкоргане — QazDev Studio",
                "Разработка сайтов и цифровых систем в Талдыкоргане. Личная встреча или удалённая работа, договор и поддержка.",
                "https://qazdevstudio.kz/razrabotka-saitov-taldykorgan.html",
            ),
            "/telegram-bot-kazakhstan.html" => Self::technology(
                "Telegram‑боты",
                "Разработка Telegram-ботов для бизнеса в Казахстане — QazDev",
                "Telegram-боты для заявок, записи, документов, оплаты и внутренних процессов. Проектирование и разработка под ключ.",
                "https://qazdevstudio.kz/telegram-bot-kazakhstan.html",
                "Telegram‑бот, который выполняет работу, а не показывает меню",
                "Проектирую сценарий под ваш процесс: бот принимает данные, проверяет их, создаёт заявку, формирует документ и уведомляет сотрудника.",
            ),
            "/crm-dlya-biznesa-kazakhstan.html" => Self::technology(
                "CRM и кабинеты",
                "CRM для малого бизнеса в Казахстане — разработка QazDev",
                "Разработка простой CRM под процесс компании: клиенты, статусы, задачи, документы, аналитика и интеграции.",
                "https://qazdevstudio.kz/crm-dlya-biznesa-kazakhstan.html",
                "CRM, в которой нет лишних экранов и потерянных заявок",
                "Собираю только те сущности и действия, которыми команда действительно пользуется каждый день.",
            ),
            "/avtomatizaciya-biznesa-kazakhstan.html" => Self::technology(
                "Автоматизация",
                "Автоматизация бизнеса в Казахстане — QazDev Studio",
                "Автоматизация заявок, документов, уведомлений и отчётов. Интеграции сайта, Telegram, CRM и внешних API.",
                "https://qazdevstudio.kz/avtomatizaciya-biznesa-kazakhstan.html",
                "Убираю повторяющиеся действия из ежедневной работы",
                "Сначала считаем потери времени и денег, затем автоматизируем один узкий процесс и только после результата расширяем систему.",
            ),
            _ => Self::technology(
                "Веб‑разработка",
                "Разработка сайтов в Казахстане под ключ — QazDev Studio",
                "Проектирование и разработка сайтов, сервисов и внутренних систем для бизнеса в Казахстане.",
                "https://qazdevstudio.kz/razrabotka-saitov-kazakhstan.html",
                "Разрабатываю сайты, которые объясняют продукт и приводят к действию",
                "Структура, дизайн и код собираются под одну бизнес-задачу. Никаких универсальных шаблонов и декоративной сложности ради эффекта.",
            ),
        }
    }

    fn city(
        city: &'static str,
        title: &'static str,
        description: &'static str,
        canonical: &'static str,
    ) -> Self {
        Self {
            title,
            description,
            canonical,
            eyebrow: "Разработка сайтов / Казахстан",
            heading: match city {
                "Астана" => "Разработка сайтов в Астане без агентской наценки",
                "Алматы" => "Разработка сайтов в Алматы напрямую с разработчиком",
                "Караганда" => "Разработка сайтов для бизнеса Караганды",
                "Шымкент" => "Разработка сайтов для бизнеса Шымкента",
                "Талдыкорган" => "Разработка сайтов в Талдыкоргане",
                _ => "Разработка сайтов в Казахстане",
            },
            lead: "Сначала разбираю задачу и путь клиента. Затем показываю структуру, фиксирую этапы и только после этого пишу код.",
            location_note: match city {
                "Талдыкорган" => {
                    "QazDev Studio находится в Талдыкоргане. Можно встретиться лично или вести проект онлайн."
                }
                "Астана" => {
                    "Работаю с компаниями Астаны удалённо. Не выдаю виртуальный адрес за офис: созвоны, демонстрации и документы проходят онлайн."
                }
                "Алматы" => {
                    "Работаю с компаниями Алматы удалённо: созвоны, прототипы, демонстрации и документы проходят онлайн."
                }
                _ => "Проект ведётся онлайн: созвоны, прототип, демонстрации, документы и запуск.",
            },
            offer: "Сайт под задачу бизнеса, а не набор одинаковых блоков",
            deliverables: standard_deliverables(),
            packages: standard_packages(),
            faqs: standard_faqs(),
        }
    }

    fn technology(
        eyebrow: &'static str,
        title: &'static str,
        description: &'static str,
        canonical: &'static str,
        heading: &'static str,
        lead: &'static str,
    ) -> Self {
        Self {
            title,
            description,
            canonical,
            eyebrow,
            heading,
            lead,
            location_note: "Проект ведёт один ответственный разработчик: от диагностики процесса до запуска и поддержки.",
            offer: "Сначала рабочий минимум, затем развитие по реальным данным",
            deliverables: standard_deliverables(),
            packages: standard_packages(),
            faqs: standard_faqs(),
        }
    }
}

#[derive(Debug, Clone)]
struct PricePackage {
    name: &'static str,
    price: &'static str,
    term: &'static str,
    description: &'static str,
}

#[derive(Debug, Clone)]
struct Faq {
    question: &'static str,
    answer: &'static str,
}

fn standard_deliverables() -> Vec<&'static str> {
    vec![
        "Карта страниц и логика переходов до начала дизайна",
        "Адаптивный интерфейс без шаблонной сетки",
        "Чистая HTML-разметка, быстрый Rust-сервер и базовое SEO",
        "Формы, WhatsApp, аналитика и необходимые интеграции",
        "Перенос на домен, проверка индексации и 30 дней поддержки",
    ]
}

fn standard_packages() -> Vec<PricePackage> {
    vec![
        PricePackage {
            name: "Старт",
            price: "от 150 000 ₸",
            term: "7–14 дней",
            description: "Одна услуга, один сильный сценарий, до 7 смысловых блоков.",
        },
        PricePackage {
            name: "Бизнес",
            price: "от 280 000 ₸",
            term: "14–30 дней",
            description: "Многостраничный сайт, услуги, кейсы, блог и расширенное SEO.",
        },
        PricePackage {
            name: "Система",
            price: "от 450 000 ₸",
            term: "от 30 дней",
            description: "Личный кабинет, CRM, автоматизация или нестандартная логика.",
        },
    ]
}

fn standard_faqs() -> Vec<Faq> {
    vec![
        Faq {
            question: "Можно начать без готового технического задания?",
            answer: "Да. На первом разговоре достаточно объяснить продукт, клиентов и главную задачу. Структуру и список функций я предложу сам.",
        },
        Faq {
            question: "Почему цена выше дешёвого сайта на конструкторе?",
            answer: "В стоимость входят исследование задачи, структура, тексты, дизайн, программирование, аналитика и запуск. Если нужен только простой шаблон, я честно скажу, что конструктор выгоднее.",
        },
        Faq {
            question: "Работаете по договору?",
            answer: "Да. В договоре фиксируются этапы, стоимость, сроки, результат и порядок передачи проекта.",
        },
        Faq {
            question: "Сайт сразу попадёт в топ Google?",
            answer: "Нет честного способа гарантировать топ сразу. На старте я закладываю техническую SEO-базу, а позиции растут за счёт полезных страниц, репутации и внешних сигналов.",
        },
    ]
}

#[derive(Debug, Clone)]
struct Article {
    slug: &'static str,
    category: &'static str,
    title: &'static str,
    description: &'static str,
    reading_time: &'static str,
}

fn blog_articles() -> Vec<Article> {
    vec![
        Article {
            slug: "skolko-stoit-sait-v-kazakhstane",
            category: "Разработка",
            title: "Сколько стоит сайт в Казахстане в 2026 году",
            description: "Разбираем диапазоны цен, состав работы и способы сэкономить без потери качества.",
            reading_time: "7 минут",
        },
        Article {
            slug: "konstruktor-ili-razrabotka",
            category: "Сравнение",
            title: "Конструктор или разработка с нуля",
            description: "Когда Tilda решает задачу, а когда ограничения начнут стоить дороже разработки.",
            reading_time: "7 минут",
        },
        Article {
            slug: "landing-ili-multistranichnyj",
            category: "Разработка",
            title: "Лендинг или многостраничный сайт",
            description: "Выбор формата по продукту, источнику трафика и циклу сделки.",
            reading_time: "6 минут",
        },
        Article {
            slug: "chto-dolzhno-byt-na-sajte-yurista",
            category: "Практика",
            title: "Что должно быть на сайте юридической компании",
            description: "Структура доверия: специализация, документы, кейсы, авторы и понятный следующий шаг.",
            reading_time: "6 минут",
        },
        Article {
            slug: "kak-sdelat-sajt-dlya-kliniki",
            category: "Практика",
            title: "Как сделать сайт для клиники",
            description: "Что нужно пациенту до записи и какие блоки мешают конверсии.",
            reading_time: "7 минут",
        },
        Article {
            slug: "kak-ne-teryat-zayavki",
            category: "CRM",
            title: "Как не терять заявки от клиентов",
            description: "Четыре места, где пропадают обращения, и минимальная система контроля.",
            reading_time: "6 минут",
        },
        Article {
            slug: "chto-takoe-crm",
            category: "CRM",
            title: "Что такое CRM простыми словами",
            description: "Без терминов: что фиксировать, кто отвечает и когда таблиц уже недостаточно.",
            reading_time: "6 минут",
        },
        Article {
            slug: "crm-ili-google-tablicy",
            category: "CRM",
            title: "CRM или Google Таблицы",
            description: "Честное сравнение стоимости, контроля, автоматизации и риска ошибок.",
            reading_time: "7 минут",
        },
        Article {
            slug: "kak-vesti-klientskuyu-bazu",
            category: "CRM",
            title: "Как вести клиентскую базу",
            description: "Минимальный набор полей и действий, который действительно помогает продажам.",
            reading_time: "5 минут",
        },
        Article {
            slug: "kak-vybrat-crm-dlya-malogo-biznesa",
            category: "CRM",
            title: "Как выбрать CRM для малого бизнеса",
            description: "Bitrix24, amoCRM, Notion, таблицы или собственная система — по задаче и бюджету.",
            reading_time: "8 минут",
        },
        Article {
            slug: "kak-sdelat-telegram-bot",
            category: "Telegram",
            title: "Как сделать Telegram-бота для бизнеса",
            description: "Сценарии, ограничения, стоимость и вопросы, которые стоит решить до разработки.",
            reading_time: "7 минут",
        },
        Article {
            slug: "telegram-bot-dlya-zapisi-klientov",
            category: "Telegram",
            title: "Telegram-бот для записи клиентов",
            description: "Запись, подтверждение, напоминания и передача данных сотруднику.",
            reading_time: "6 минут",
        },
        Article {
            slug: "telegram-bot-dlya-salona-krasoty",
            category: "Telegram",
            title: "Telegram-бот для салона красоты",
            description: "Как автоматизировать запись и возврат клиентов без сложной CRM.",
            reading_time: "5 минут",
        },
        Article {
            slug: "telegram-bot-dlya-dostavki",
            category: "Telegram",
            title: "Telegram-бот для доставки",
            description: "Каталог, заказ, статус и уведомления — где бот удобен, а где нужен сайт.",
            reading_time: "6 минут",
        },
        Article {
            slug: "chto-umeet-telegram-bot",
            category: "Telegram",
            title: "Что умеет Telegram-бот",
            description: "Полезные сценарии и задачи, которые не стоит пытаться решать через бота.",
            reading_time: "8 минут",
        },
        Article {
            slug: "telegram-bot-vs-whatsapp",
            category: "Сравнение",
            title: "Telegram-бот или WhatsApp",
            description: "Сравниваем охват, автоматизацию, стоимость и ограничения двух каналов.",
            reading_time: "5 минут",
        },
        Article {
            slug: "avtomatizatsiya-malogo-biznesa",
            category: "Автоматизация",
            title: "Автоматизация малого бизнеса: с чего начать",
            description: "Как выбрать первый процесс и посчитать эффект до разработки.",
            reading_time: "8 минут",
        },
        Article {
            slug: "kak-avtomatizirovat-dokumenty",
            category: "Автоматизация",
            title: "Как автоматизировать документы",
            description: "Данные, шаблоны, проверка и выдача готового файла без ручного копирования.",
            reading_time: "7 минут",
        },
        Article {
            slug: "google-tablicy-dlya-biznesa",
            category: "Инструменты",
            title: "Google Таблицы для бизнеса",
            description: "Когда простой инструмент закрывает задачу лучше дорогой системы.",
            reading_time: "6 минут",
        },
        Article {
            slug: "integratsiya-1s-s-saytom",
            category: "Интеграции",
            title: "Интеграция 1С с сайтом",
            description: "Какие данные синхронизировать и почему сначала нужен единый источник правды.",
            reading_time: "8 минут",
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn home_is_rendered_by_rust() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("x-powered-by")
                .and_then(|v| v.to_str().ok()),
            None
        );
    }

    #[tokio::test]
    async fn all_programs_have_unique_slugs() {
        let state = AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        assert_eq!(state.software.len(), 1_000);
        assert_eq!(state.software_index.len(), state.software.len());
    }

    #[tokio::test]
    async fn old_broken_service_links_redirect() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/telegram-bot-dlya-biznesa.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
    }

    #[tokio::test]
    async fn missing_page_returns_real_404() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/programmy/not-a-real-app.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn rejects_path_traversal_slugs() {
        assert!(valid_slug("sharex"));
        assert!(!valid_slug("../config"));
        assert!(!valid_slug("ShareX"));
    }
}
