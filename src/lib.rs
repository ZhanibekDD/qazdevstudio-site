mod analytics;

use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    path::PathBuf,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use analytics::{Analytics, RequestMeta, TrackPayload, format_report, notification_text};
use askama::Template;
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, Uri, header},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

const DOMAIN: &str = "https://qazdevstudio.kz";
const PROGRAM_CATEGORIES: [(&str, &str); 14] = [
    ("system", "Система"),
    ("productivity", "Работа и текст"),
    ("developer", "Разработка"),
    ("multimedia", "Видео и аудио"),
    ("graphics", "Графика и фото"),
    ("games", "Игры"),
    ("internet", "Интернет"),
    ("education", "Образование"),
    ("security", "Безопасность"),
    ("communication", "Общение"),
    ("network", "Удалённый доступ"),
    ("ai", "Локальный ИИ"),
    ("screenshots", "Скриншоты"),
    ("files", "Файлы"),
];
const SOFTWARE_JSON: &str = include_str!("../data/software.json");
const EDITORIAL_PROGRAMS_JSON: &str = include_str!("../data/editorial-programs.json");
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
    pub github: String,
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
    #[serde(skip)]
    pub editorial: bool,
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
    #[serde(default)]
    pub pattern: String,
}

#[derive(Clone)]
pub struct AppState {
    software: Arc<Vec<Software>>,
    software_index: Arc<HashMap<String, usize>>,
    legacy_root: Arc<PathBuf>,
    analytics: Option<Analytics>,
    telegram: Option<TelegramConfig>,
    http_client: reqwest::Client,
    github_token: Option<Arc<str>>,
    release_cache: Arc<RwLock<HashMap<String, CachedRelease>>>,
    static_export: bool,
}

#[derive(Clone)]
struct CachedRelease {
    loaded_at: Instant,
    assets: Arc<Vec<GithubAsset>>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Clone)]
struct TelegramConfig {
    bot_token: Arc<str>,
    admin_id: Arc<str>,
    webhook_secret: Arc<str>,
}

impl AppState {
    pub fn from_environment() -> Self {
        let legacy_root = std::env::var("LEGACY_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let mut state = Self::new(legacy_root);
        if let Ok(path) = std::env::var("QAZDEV_DB_PATH") {
            match Analytics::open(path) {
                Ok(analytics) => state.analytics = Some(analytics),
                Err(error) => tracing::error!(%error, "analytics database is unavailable"),
            }
        }
        if let (Ok(bot_token), Ok(admin_id)) = (
            std::env::var("TELEGRAM_BOT_TOKEN"),
            std::env::var("TELEGRAM_ADMIN_ID"),
        ) && !bot_token.is_empty()
            && !admin_id.is_empty()
        {
            state.telegram = Some(TelegramConfig {
                bot_token: bot_token.into(),
                admin_id: admin_id.into(),
                webhook_secret: std::env::var("TELEGRAM_WEBHOOK_SECRET")
                    .unwrap_or_default()
                    .into(),
            });
        }
        state
    }

    pub fn new(legacy_root: PathBuf) -> Self {
        let mut software: Vec<Software> =
            serde_json::from_str(SOFTWARE_JSON).expect("data/software.json must be valid JSON");
        let editorial: HashSet<String> = serde_json::from_str(EDITORIAL_PROGRAMS_JSON)
            .expect("data/editorial-programs.json must be a valid JSON string array");
        for app in &mut software {
            if app.category == "ai" {
                app.category_label = "Локальный ИИ".to_string();
            }
            if app.slug == "audio-player" {
                app.short_description = "Audio Player — простой аудиоплеер GNOME для воспроизведения локальных файлов в Linux. Версия 49.6."
                    .to_string();
                app.full_description = "Audio Player (Decibels) воспроизводит локальные аудиофайлы без обязательной медиатеки. Поддерживает форму волны, изменение скорости, быстрый переход по треку и одновременное открытие нескольких файлов. Версия 49.6 распространяется через официальный Flathub."
                    .to_string();
                app.features = vec![
                    "Аудио".to_string(),
                    "Регулировка скорости".to_string(),
                    "Форма волны".to_string(),
                    "Flatpak".to_string(),
                ];
            }
            app.editorial = editorial.contains(&app.slug);
        }
        assert_eq!(
            editorial.len(),
            162,
            "editorial program list changed unexpectedly"
        );
        assert!(
            editorial
                .iter()
                .all(|slug| software.iter().any(|app| &app.slug == slug)),
            "editorial program list contains an unknown slug"
        );
        let software_index = software
            .iter()
            .enumerate()
            .map(|(index, app)| (app.slug.clone(), index))
            .collect();

        Self {
            software: Arc::new(software),
            software_index: Arc::new(software_index),
            legacy_root: Arc::new(legacy_root),
            analytics: None,
            telegram: None,
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(6))
                .user_agent("QazDevStudio-Rust/1.0")
                .build()
                .expect("valid HTTP client configuration"),
            github_token: std::env::var("GITHUB_TOKEN")
                .ok()
                .filter(|token| !token.is_empty())
                .map(Arc::from),
            release_cache: Arc::new(RwLock::new(HashMap::new())),
            static_export: false,
        }
    }

    /// Builds the same application in a mode suitable for a plain static host.
    /// Pages remain rendered by Rust, while dynamic download lookups fall back
    /// to the publisher's official release page.
    pub fn for_static_export(legacy_root: PathBuf) -> Self {
        let mut state = Self::new(legacy_root);
        state.static_export = true;
        state
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
        .route(
            "/razrabotka-saitov-taldykorgan.html",
            get(|| async { Redirect::permanent("/razrabotka-saitov-kazakhstan.html") }),
        )
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
        .route("/programmy/kategorii/{file}", get(program_category))
        .route("/programmy/{file}", get(program_detail))
        .route("/api/programs", get(programs_api))
        .route("/api/programs.json", get(programs_api))
        .route("/api/download/{slug}/{index}", get(download_asset))
        .route("/api/track", post(track_event))
        .route("/api/track.php", post(track_event))
        .route("/api/geo-track", post(geo_track))
        .route("/api/geo-track.php", post(geo_track))
        .route("/api/bot", post(bot_webhook))
        .route("/api/bot.php", post(bot_webhook))
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
        .route_service(
            "/efeebfa2eec920c3dacdc19c51c483dc.txt",
            ServeFile::new(legacy.join("efeebfa2eec920c3dacdc19c51c483dc.txt")),
        )
        .fallback(legacy_root_page)
        .with_state(state)
        .layer(DefaultBodyLimit::max(16 * 1024))
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
        "vlc-media-player",
        "firefox",
        "7-zip",
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

async fn program_category(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let Some(slug) = file.strip_suffix(".html") else {
        return not_found();
    };
    let Some((category, label)) = PROGRAM_CATEGORIES
        .iter()
        .find(|(category, _)| *category == slug)
        .copied()
    else {
        return not_found();
    };
    let programs = state
        .software
        .iter()
        .filter(|app| app.category == category)
        .cloned()
        .collect::<Vec<_>>();
    let count = programs.len();

    render(CategoryTemplate {
        title: format!("Программы: {label} — скачать официальные версии | QazTools"),
        description: format!(
            "{count} проверенных программ в категории «{label}» для Windows, Linux и macOS с официальными ссылками."
        ),
        canonical: format!("{DOMAIN}/programmy/kategorii/{category}.html"),
        label,
        count,
        programs,
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
    let structured_data = software_json_ld(&app);
    let related = state
        .software
        .iter()
        .filter(|item| item.slug != app.slug && item.category == app.category)
        .take(4)
        .cloned()
        .collect();

    render(ProgramTemplate {
        app,
        related,
        structured_data,
        static_export: state.static_export,
    })
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

async fn download_asset(
    State(state): State<AppState>,
    Path((slug, index)): Path<(String, usize)>,
) -> Response {
    let Some(app_index) = state.software_index.get(&slug).copied() else {
        return not_found();
    };
    let app = &state.software[app_index];
    let Some(download) = app.downloads.get(index) else {
        return not_found();
    };
    if valid_download_url(&download.url) {
        return Redirect::temporary(&download.url).into_response();
    }
    if app.github.is_empty() || download.pattern.is_empty() {
        return official_download_fallback(app);
    }

    let assets = match github_release_assets(&state, &app.github).await {
        Ok(assets) => assets,
        Err(error) => {
            tracing::warn!(%error, repository = %app.github, "GitHub release lookup failed");
            return official_download_fallback(app);
        }
    };
    let Ok(pattern) = regex::RegexBuilder::new(&download.pattern)
        .case_insensitive(true)
        .build()
    else {
        tracing::warn!(pattern = %download.pattern, "invalid embedded download pattern");
        return official_download_fallback(app);
    };
    let Some(asset) = assets.iter().find(|asset| {
        pattern.is_match(&asset.name) && valid_download_url(&asset.browser_download_url)
    }) else {
        return official_download_fallback(app);
    };
    Redirect::temporary(&asset.browser_download_url).into_response()
}

async fn github_release_assets(
    state: &AppState,
    repository: &str,
) -> reqwest::Result<Arc<Vec<GithubAsset>>> {
    if let Ok(cache) = state.release_cache.read()
        && let Some(entry) = cache.get(repository)
        && entry.loaded_at.elapsed() < Duration::from_secs(3_600)
    {
        return Ok(Arc::clone(&entry.assets));
    }

    let mut request = state
        .http_client
        .get(format!(
            "https://api.github.com/repos/{repository}/releases/latest"
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json");
    if let Some(token) = state.github_token.as_ref() {
        request = request.bearer_auth(token);
    }
    let release = request
        .send()
        .await?
        .error_for_status()?
        .json::<GithubRelease>()
        .await?;
    let assets = Arc::new(release.assets);
    if let Ok(mut cache) = state.release_cache.write() {
        cache.insert(
            repository.to_string(),
            CachedRelease {
                loaded_at: Instant::now(),
                assets: Arc::clone(&assets),
            },
        );
    }
    Ok(assets)
}

fn valid_download_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

fn official_download_fallback(app: &Software) -> Response {
    if !app.github.is_empty() {
        return Redirect::temporary(&format!(
            "https://github.com/{}/releases/latest",
            app.github
        ))
        .into_response();
    }
    if valid_download_url(&app.website) {
        return Redirect::temporary(&app.website).into_response();
    }
    not_found()
}

async fn track_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<TrackPayload>,
) -> StatusCode {
    if payload.visitor_id.trim().is_empty()
        || payload.session_id.trim().is_empty()
        || payload.event_type.trim().is_empty()
    {
        return StatusCode::BAD_REQUEST;
    }
    if payload.event_type.len() > 64 || payload.page_url.len() > 1_000 {
        return StatusCode::PAYLOAD_TOO_LARGE;
    }

    let meta = RequestMeta {
        user_agent: header_text(&headers, header::USER_AGENT.as_str()),
        ip: client_ip(&headers),
    };

    if let Some(analytics) = state.analytics.clone() {
        let record = payload.clone();
        match tokio::task::spawn_blocking(move || analytics.record(&record, &meta)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::warn!(%error, "analytics event was not stored"),
            Err(error) => tracing::warn!(%error, "analytics storage task failed"),
        }
    }

    if let (Some(config), Some(text)) = (state.telegram.as_ref(), notification_text(&payload))
        && let Err(error) = send_telegram(&state.http_client, config, &config.admin_id, &text).await
    {
        tracing::warn!(%error, "Telegram notification failed");
    }

    StatusCode::NO_CONTENT
}

#[derive(Debug, Default, Deserialize)]
struct GeoRequest {
    #[serde(default)]
    page_url: String,
    #[serde(default)]
    referrer: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpApiResponse {
    status: String,
    country: String,
    country_code: String,
    region_name: String,
    city: String,
    lat: Option<f64>,
    lon: Option<f64>,
    timezone: String,
    isp: String,
    #[serde(rename = "as")]
    as_name: String,
    hosting: bool,
    proxy: bool,
}

#[derive(Debug, Serialize)]
struct GeoResponse {
    ok: bool,
    ip: String,
    city: String,
    region: String,
    country: String,
    code: String,
    flag: String,
    lat: String,
    lon: String,
    tz: String,
    isp: String,
    asn: String,
    hosting: bool,
    device: String,
}

async fn geo_track(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<GeoRequest>,
) -> Json<GeoResponse> {
    let page_url = request.page_url.chars().take(300).collect::<String>();
    let referrer = request.referrer.chars().take(300).collect::<String>();
    let user_agent = header_text(&headers, header::USER_AGENT.as_str());
    let ip = parse_client_ip(&headers).unwrap_or(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    let geo = if public_ip(ip) {
        let url = format!(
            "http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,as,hosting,proxy&lang=ru"
        );
        match state.http_client.get(url).send().await {
            Ok(response) => response.json::<IpApiResponse>().await.unwrap_or_default(),
            Err(error) => {
                tracing::warn!(%error, "IP geolocation request failed");
                IpApiResponse::default()
            }
        }
    } else {
        IpApiResponse::default()
    };
    let success = geo.status == "success";
    let country_code = if success {
        geo.country_code
    } else {
        String::new()
    };
    let asn = geo
        .as_name
        .split_whitespace()
        .next()
        .filter(|value| value.starts_with("AS"))
        .unwrap_or_default()
        .to_string();

    let response = GeoResponse {
        ok: true,
        ip: ip.to_string(),
        city: if success { geo.city } else { "—".to_string() },
        region: if success {
            geo.region_name
        } else {
            String::new()
        },
        country: if success {
            geo.country
        } else {
            "—".to_string()
        },
        flag: country_flag(&country_code),
        code: country_code,
        lat: geo.lat.map(format_coordinate).unwrap_or_default(),
        lon: geo.lon.map(format_coordinate).unwrap_or_default(),
        tz: geo.timezone,
        isp: geo.isp,
        asn,
        hosting: geo.hosting || geo.proxy,
        device: device_label(&user_agent).to_string(),
    };

    if let Some(config) = state.telegram.as_ref() {
        let mut text = format!(
            "Открыли инструмент «Мой IP»\nIP: {}\nГород: {}\nСтрана: {}\nУстройство: {}\nСтраница: {}",
            response.ip, response.city, response.country, response.device, page_url
        );
        if !referrer.is_empty() {
            text.push_str("\nИсточник: ");
            text.push_str(&referrer);
        }
        if let Err(error) = send_telegram(&state.http_client, config, &config.admin_id, &text).await
        {
            tracing::warn!(%error, "IP utility Telegram notification failed");
        }
    }

    Json(response)
}

async fn bot_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(update): Json<Value>,
) -> StatusCode {
    let Some(config) = state.telegram.as_ref() else {
        return StatusCode::NOT_FOUND;
    };
    if config.webhook_secret.is_empty() {
        return StatusCode::NOT_FOUND;
    }
    if header_text(&headers, "x-telegram-bot-api-secret-token") != config.webhook_secret.as_ref() {
        return StatusCode::FORBIDDEN;
    }

    let message = update.get("message").unwrap_or(&Value::Null);
    let user_id = message
        .pointer("/from/id")
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_default();
    let chat_id = message
        .pointer("/chat/id")
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_default();
    if user_id != config.admin_id.as_ref() || chat_id.is_empty() {
        return StatusCode::NO_CONTENT;
    }

    let command = message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let text = if matches!(command, "/start" | "/report" | "📊 Сегодня" | "📈 7 дней")
    {
        if let Some(analytics) = state.analytics.clone() {
            match tokio::task::spawn_blocking(move || analytics.report()).await {
                Ok(Ok(report)) => format_report(&report),
                Ok(Err(error)) => {
                    tracing::warn!(%error, "analytics report failed");
                    "Не удалось собрать отчёт.".to_string()
                }
                Err(error) => {
                    tracing::warn!(%error, "analytics report task failed");
                    "Не удалось собрать отчёт.".to_string()
                }
            }
        } else {
            "Аналитика не подключена.".to_string()
        }
    } else {
        "QazDev Analytics\n\nКоманды:\n/report — текущий отчёт".to_string()
    };

    if let Err(error) = send_telegram(&state.http_client, config, &chat_id, &text).await {
        tracing::warn!(%error, "Telegram report failed");
    }
    StatusCode::NO_CONTENT
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "runtime": "rust",
        "programs": state.software.len(),
        "analytics": state.analytics.is_some()
    }))
}

async fn send_telegram(
    client: &reqwest::Client,
    config: &TelegramConfig,
    chat_id: &str,
    text: &str,
) -> reqwest::Result<()> {
    client
        .post(format!(
            "https://api.telegram.org/bot{}/sendMessage",
            config.bot_token
        ))
        .json(&json!({ "chat_id": chat_id, "text": text }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

fn header_text(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn client_ip(headers: &HeaderMap) -> String {
    for name in ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"] {
        let value = header_text(headers, name);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn parse_client_ip(headers: &HeaderMap) -> Option<IpAddr> {
    client_ip(headers)
        .split(',')
        .next()
        .and_then(|value| value.trim().parse().ok())
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            !(value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_broadcast()
                || value.is_documentation()
                || value.is_unspecified())
        }
        IpAddr::V6(value) => {
            !(value.is_loopback()
                || value.is_unique_local()
                || value.is_unicast_link_local()
                || value.is_unspecified())
        }
    }
}

fn country_flag(code: &str) -> String {
    let bytes = code.as_bytes();
    if bytes.len() != 2 || !bytes.iter().all(u8::is_ascii_alphabetic) {
        return "🌍".to_string();
    }
    bytes
        .iter()
        .filter_map(|byte| char::from_u32(127_397 + u32::from(byte.to_ascii_uppercase())))
        .collect()
}

fn format_coordinate(value: f64) -> String {
    format!("{value:.6}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn device_label(user_agent: &str) -> &'static str {
    let lower = user_agent.to_ascii_lowercase();
    if lower.contains("ipad") || (lower.contains("android") && !lower.contains("mobile")) {
        "📱 Планшет"
    } else if lower.contains("iphone")
        || lower.contains("android")
        || lower.contains("windows phone")
    {
        "📱 Смартфон"
    } else {
        "💻 ПК / Ноутбук"
    }
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
    let mut urls = [
        "/",
        "/calculator.html",
        "/checklist-saita.html",
        "/automation-quiz.html",
        "/tz-generator.html",
        "/ready-solutions.html",
        "/razrabotka-saitov-kazakhstan.html",
        "/telegram-bot-kazakhstan.html",
        "/crm-dlya-biznesa-kazakhstan.html",
        "/avtomatizaciya-biznesa-kazakhstan.html",
        "/avtomatizaciya-dokumentov.html",
        "/razrabotka-saitov-almaty.html",
        "/razrabotka-saitov-astana.html",
        "/razrabotka-saitov-shymkent.html",
        "/razrabotka-saitov-karaganda.html",
        "/solutions/",
        "/solutions/kak-ne-teryat-zayavki-v-whatsapp.html",
        "/solutions/telegram-bot-dlya-biznesa.html",
        "/solutions/crm-dlya-malogo-biznesa.html",
        "/solutions/avtomatizaciya-dokumentov.html",
        "/solutions/sait-dlya-yurista.html",
        "/solutions/sait-dlya-uchebnogo-centra.html",
        "/solutions/chto-luchshe-sait-bot-ili-crm.html",
        "/blog/",
        "/programmy/",
        "/obrabotka-izobrazheniy-online.html",
        "/utm.html",
        "/moy-ip.html",
        "/templates/",
        "/templates/dogovor-razrabotka-saita.html",
        "/templates/tz-na-sait.html",
        "/templates/tz-na-telegram-bot.html",
        "/templates/kommercheskoe-predlozhenie.html",
        "/ip.html",
        "/privacy.html",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    urls.extend(
        blog_articles()
            .into_iter()
            .map(|article| format!("/blog/{}.html", article.slug)),
    );
    xml_urlset(urls)
}

async fn sitemap_programs(State(state): State<AppState>) -> Response {
    let mut urls = PROGRAM_CATEGORIES
        .iter()
        .map(|(slug, _)| format!("/programmy/kategorii/{slug}.html"))
        .collect::<Vec<_>>();
    urls.extend(
        state
            .software
            .iter()
            .filter(|app| app.editorial)
            .map(|app| format!("/programmy/{}.html", app.slug)),
    );
    xml_urlset(urls)
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

fn software_json_ld(app: &Software) -> String {
    let mut data = serde_json::Map::new();
    data.insert("@context".to_string(), json!("https://schema.org"));
    data.insert("@type".to_string(), json!("SoftwareApplication"));
    data.insert("name".to_string(), json!(app.name));
    data.insert("description".to_string(), json!(app.short_description));
    data.insert(
        "url".to_string(),
        json!(format!("{DOMAIN}/programmy/{}.html", app.slug)),
    );
    data.insert("applicationCategory".to_string(), json!(app.category_label));
    data.insert(
        "operatingSystem".to_string(),
        json!(app.platforms.join(", ")),
    );
    if !app.version.is_empty() {
        data.insert("softwareVersion".to_string(), json!(app.version));
    }
    if !app.license.is_empty() {
        data.insert("license".to_string(), json!(app.license));
    }
    if !app.developer.is_empty() {
        data.insert(
            "author".to_string(),
            json!({"@type": "Organization", "name": app.developer}),
        );
    }
    if !app.icon.is_empty() {
        data.insert("image".to_string(), json!(app.icon));
    }
    if let Some(download) = app.downloads.iter().find(|download| {
        download.url.starts_with("https://") || download.url.starts_with("http://")
    }) {
        data.insert("downloadUrl".to_string(), json!(download.url));
    }

    Value::Object(data)
        .to_string()
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
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
#[template(path = "category.html")]
struct CategoryTemplate {
    title: String,
    description: String,
    canonical: String,
    label: &'static str,
    count: usize,
    programs: Vec<Software>,
}

#[derive(Template)]
#[template(path = "program.html")]
struct ProgramTemplate {
    app: Software,
    related: Vec<Software>,
    structured_data: String,
    static_export: bool,
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
                _ => "Разработка сайтов в Казахстане",
            },
            lead: "Сначала разбираю задачу и путь клиента. Затем показываю структуру, фиксирую этапы и только после этого пишу код.",
            location_note: match city {
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
            slug: "kak-podklyuchit-kaspi-pay",
            category: "Платежи",
            title: "Как подключить Kaspi Pay на сайт",
            description: "Практический разбор подключения оплаты, ссылок и сценариев для бизнеса в Казахстане.",
            reading_time: "6 минут",
        },
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
    use axum::body::to_bytes;
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
        assert_eq!(
            state.software.iter().filter(|app| app.editorial).count(),
            162
        );
    }

    #[tokio::test]
    async fn commercial_home_has_lead_form_without_adsense_script() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("data-whatsapp-form"));
        assert!(!html.contains("pagead2.googlesyndication.com"));
        assert!(!html.contains("Талдыкорган"));
    }

    #[tokio::test]
    async fn editorial_and_generated_programs_have_different_indexing_rules() {
        let router = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))));
        let editorial = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/programmy/sharex.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let editorial = String::from_utf8(
            to_bytes(editorial.into_body(), 1_000_000)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(editorial.contains("content=\"index,follow"));
        assert!(editorial.contains("SoftwareApplication"));

        let generated = router
            .oneshot(
                Request::builder()
                    .uri("/programmy/audio-player.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let generated = String::from_utf8(
            to_bytes(generated.into_body(), 1_000_000)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(generated.contains("content=\"noindex,follow\""));
        assert!(generated.contains("простой аудиоплеер GNOME"));
        assert!(!generated.contains("SoftwareApplication"));
    }

    #[tokio::test]
    async fn program_sitemap_contains_only_editorial_cards() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/sitemap-programmy.xml")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        let xml = String::from_utf8(body.to_vec()).unwrap();
        assert!(xml.contains("/programmy/sharex.html"));
        assert!(!xml.contains("/programmy/audio-player.html"));
        assert_eq!(xml.matches("<url>").count(), 162 + PROGRAM_CATEGORIES.len());
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
    async fn removed_city_page_redirects_to_kazakhstan() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/razrabotka-saitov-taldykorgan.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
        assert_eq!(
            response.headers().get(header::LOCATION).unwrap(),
            "/razrabotka-saitov-kazakhstan.html"
        );
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

    #[tokio::test]
    async fn geo_endpoint_is_preserved() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/geo-track.php")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-real-ip", "127.0.0.1")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn program_category_is_rendered_by_rust() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/programmy/kategorii/system.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn pattern_download_button_is_kept() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/programmy/sharex.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("/api/download/sharex/0"));
    }

    #[tokio::test]
    async fn pattern_download_resolves_from_cache() {
        let state = AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        state.release_cache.write().unwrap().insert(
            "ShareX/ShareX".to_string(),
            CachedRelease {
                loaded_at: Instant::now(),
                assets: Arc::new(vec![GithubAsset {
                    name: "sharex-18.0.0-setup-x64.exe".to_string(),
                    browser_download_url:
                        "https://github.com/ShareX/ShareX/releases/download/v18/ShareX-18.0.0-setup-x64.exe"
                            .to_string(),
                }]),
            },
        );
        let response = app(state)
            .oneshot(
                Request::builder()
                    .uri("/api/download/sharex/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            response.headers().get(header::LOCATION).unwrap(),
            "https://github.com/ShareX/ShareX/releases/download/v18/ShareX-18.0.0-setup-x64.exe"
        );
    }

    #[test]
    fn category_names_match_catalog_labels() {
        assert!(PROGRAM_CATEGORIES.contains(&("productivity", "Работа и текст")));
        assert!(PROGRAM_CATEGORIES.contains(&("multimedia", "Видео и аудио")));
        assert!(PROGRAM_CATEGORIES.contains(&("network", "Удалённый доступ")));
    }

    #[test]
    fn ai_labels_are_normalized() {
        let state = AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        assert!(
            state
                .software
                .iter()
                .filter(|app| app.category == "ai")
                .all(|app| app.category_label == "Локальный ИИ")
        );
    }

    #[tokio::test]
    async fn indexnow_key_is_served() {
        let response = app(AppState::new(PathBuf::from(env!("CARGO_MANIFEST_DIR"))))
            .oneshot(
                Request::builder()
                    .uri("/efeebfa2eec920c3dacdc19c51c483dc.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[test]
    fn existing_kaspi_article_stays_discoverable() {
        assert!(
            blog_articles()
                .iter()
                .any(|article| article.slug == "kak-podklyuchit-kaspi-pay")
        );
    }

    #[test]
    fn rejects_path_traversal_slugs() {
        assert!(valid_slug("sharex"));
        assert!(!valid_slug("../config"));
        assert!(!valid_slug("ShareX"));
    }
}
