use std::{
    net::IpAddr,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Analytics {
    path: PathBuf,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TrackPayload {
    #[serde(default)]
    pub visitor_id: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub event_type: String,
    #[serde(default)]
    pub event_label: String,
    #[serde(default)]
    pub page_url: String,
    #[serde(default)]
    pub page_title: String,
    #[serde(default)]
    pub referrer: String,
    #[serde(default)]
    pub utm_source: String,
    #[serde(default)]
    pub utm_medium: String,
    #[serde(default)]
    pub utm_campaign: String,
    #[serde(default)]
    pub extra: Value,
}

#[derive(Debug, Clone, Default)]
pub struct RequestMeta {
    pub user_agent: String,
    pub ip: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsReport {
    pub visits_today: i64,
    pub visitors_today: i64,
    pub visits_7_days: i64,
    pub contact_events_7_days: i64,
    pub leads_7_days: i64,
    pub top_pages: Vec<(String, i64)>,
}

impl Analytics {
    pub fn open(path: impl Into<PathBuf>) -> rusqlite::Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| rusqlite::Error::InvalidPath(parent.to_path_buf()))?;
        }
        let analytics = Self { path };
        analytics.initialize()?;
        Ok(analytics)
    }

    fn connect(&self) -> rusqlite::Result<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "busy_timeout", 5_000)?;
        Ok(connection)
    }

    fn initialize(&self) -> rusqlite::Result<()> {
        self.connect()?.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS rust_visits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visitor_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                page_url TEXT NOT NULL,
                page_title TEXT,
                referrer TEXT,
                utm_source TEXT,
                utm_medium TEXT,
                utm_campaign TEXT,
                device_type TEXT,
                browser TEXT,
                os TEXT,
                ip_hint TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rust_visits_created ON rust_visits(created_at);
            CREATE INDEX IF NOT EXISTS idx_rust_visits_visitor ON rust_visits(visitor_id);

            CREATE TABLE IF NOT EXISTS rust_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visitor_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_label TEXT,
                page_url TEXT,
                extra_json TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rust_events_created ON rust_events(created_at);
            CREATE INDEX IF NOT EXISTS idx_rust_events_type ON rust_events(event_type);

            CREATE TABLE IF NOT EXISTS rust_leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visitor_id TEXT,
                session_id TEXT,
                name TEXT,
                phone TEXT,
                city TEXT,
                service TEXT,
                comment TEXT,
                page_url TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rust_leads_created ON rust_leads(created_at);
            ",
        )?;
        Ok(())
    }

    pub fn record(&self, payload: &TrackPayload, meta: &RequestMeta) -> rusqlite::Result<()> {
        let connection = self.connect()?;
        let now = unix_timestamp();
        let visitor_id = clean(&payload.visitor_id, 64);
        let session_id = clean(&payload.session_id, 64);
        let event_type = clean(&payload.event_type, 64);
        let page_url = clean(&payload.page_url, 1_000);

        if event_type == "page_view" {
            connection.execute(
                "INSERT INTO rust_visits (
                    visitor_id, session_id, page_url, page_title, referrer,
                    utm_source, utm_medium, utm_campaign, device_type, browser,
                    os, ip_hint, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    visitor_id,
                    session_id,
                    page_url,
                    clean(&payload.page_title, 300),
                    clean(&payload.referrer, 1_000),
                    clean(&payload.utm_source, 100),
                    clean(&payload.utm_medium, 100),
                    clean(&payload.utm_campaign, 200),
                    detect_device(&meta.user_agent),
                    detect_browser(&meta.user_agent),
                    detect_os(&meta.user_agent),
                    anonymize_ip(&meta.ip),
                    now,
                ],
            )?;
        } else {
            connection.execute(
                "INSERT INTO rust_events (
                    visitor_id, session_id, event_type, event_label, page_url,
                    extra_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    visitor_id,
                    session_id,
                    event_type,
                    clean(&payload.event_label, 200),
                    page_url,
                    payload.extra.to_string(),
                    now,
                ],
            )?;
        }

        if payload.event_type == "form_submit" {
            connection.execute(
                "INSERT INTO rust_leads (
                    visitor_id, session_id, name, phone, city, service,
                    comment, page_url, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    clean(&payload.visitor_id, 64),
                    clean(&payload.session_id, 64),
                    extra_string(&payload.extra, "name", 120),
                    extra_string(&payload.extra, "phone", 80),
                    extra_string(&payload.extra, "city", 120),
                    extra_string(&payload.extra, "service", 200),
                    extra_string(&payload.extra, "comment", 1_500),
                    clean(&payload.page_url, 1_000),
                    now,
                ],
            )?;
        }
        Ok(())
    }

    pub fn report(&self) -> rusqlite::Result<AnalyticsReport> {
        let connection = self.connect()?;
        let now = unix_timestamp();
        let day = start_of_almaty_day(now);
        let week = now - 7 * 86_400;

        let visits_today = connection.query_row(
            "SELECT COUNT(*) FROM rust_visits WHERE created_at >= ?1",
            [day],
            |row| row.get(0),
        )?;
        let visitors_today = connection.query_row(
            "SELECT COUNT(DISTINCT visitor_id) FROM rust_visits WHERE created_at >= ?1",
            [day],
            |row| row.get(0),
        )?;
        let visits_7_days = connection.query_row(
            "SELECT COUNT(*) FROM rust_visits WHERE created_at >= ?1",
            [week],
            |row| row.get(0),
        )?;
        let contact_events_7_days = connection.query_row(
            "SELECT COUNT(*) FROM rust_events
             WHERE created_at >= ?1
             AND event_type IN ('whatsapp_click','telegram_click','phone_click','email_click')",
            [week],
            |row| row.get(0),
        )?;
        let leads_7_days = connection.query_row(
            "SELECT COUNT(*) FROM rust_leads WHERE created_at >= ?1",
            [week],
            |row| row.get(0),
        )?;

        let mut statement = connection.prepare(
            "SELECT page_url, COUNT(*) AS total FROM rust_visits
             WHERE created_at >= ?1 GROUP BY page_url ORDER BY total DESC LIMIT 5",
        )?;
        let top_pages = statement
            .query_map([week], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(AnalyticsReport {
            visits_today,
            visitors_today,
            visits_7_days,
            contact_events_7_days,
            leads_7_days,
            top_pages,
        })
    }
}

pub fn notification_text(payload: &TrackPayload) -> Option<String> {
    match payload.event_type.as_str() {
        "whatsapp_click" => Some(format!(
            "Клик по WhatsApp\nСтраница: {}\nКнопка: {}",
            clean(&payload.page_url, 500),
            clean(&payload.event_label, 200)
        )),
        "phone_click" => Some(format!(
            "Клик по телефону\nСтраница: {}",
            clean(&payload.page_url, 500)
        )),
        "telegram_click" => Some(format!(
            "Клик по Telegram\nСтраница: {}\nКнопка: {}",
            clean(&payload.page_url, 500),
            clean(&payload.event_label, 200)
        )),
        "email_click" => Some(format!(
            "Клик по email\nСтраница: {}",
            clean(&payload.page_url, 500)
        )),
        "price_click" => Some(format!(
            "Интерес к тарифу\nТариф: {}\nСтраница: {}",
            clean(&payload.event_label, 200),
            clean(&payload.page_url, 500)
        )),
        "form_submit" => Some(format!(
            "Новая заявка с сайта\nТелефон: {}\nГород: {}\nУслуга: {}\nКомментарий: {}\nСтраница: {}",
            extra_string(&payload.extra, "phone", 80),
            extra_string(&payload.extra, "city", 120),
            extra_string(&payload.extra, "service", 200),
            extra_string(&payload.extra, "comment", 500),
            clean(&payload.page_url, 500),
        )),
        _ => None,
    }
}

pub fn format_report(report: &AnalyticsReport) -> String {
    let pages = if report.top_pages.is_empty() {
        "— данных пока нет".to_string()
    } else {
        report
            .top_pages
            .iter()
            .map(|(path, count)| format!("— {path}: {count}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "QazDev Analytics\n\nСегодня\nВизиты: {}\nПосетители: {}\n\n7 дней\nВизиты: {}\nКонтактные действия: {}\nЗаявки: {}\n\nПопулярные страницы\n{}",
        report.visits_today,
        report.visitors_today,
        report.visits_7_days,
        report.contact_events_7_days,
        report.leads_7_days,
        pages
    )
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn start_of_almaty_day(timestamp: i64) -> i64 {
    const ALMATY_UTC_OFFSET: i64 = 5 * 60 * 60;
    (timestamp + ALMATY_UTC_OFFSET).div_euclid(86_400) * 86_400 - ALMATY_UTC_OFFSET
}

fn clean(value: &str, max: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|character| !matches!(character, '<' | '>' | '\0'))
        .take(max)
        .collect()
}

fn extra_string(value: &Value, key: &str, max: usize) -> String {
    clean(
        value.get(key).and_then(Value::as_str).unwrap_or_default(),
        max,
    )
}

fn detect_device(user_agent: &str) -> &'static str {
    let ua = user_agent.to_ascii_lowercase();
    if ua.contains("ipad") || ua.contains("tablet") {
        "tablet"
    } else if ua.contains("mobile") || ua.contains("iphone") || ua.contains("android") {
        "mobile"
    } else {
        "desktop"
    }
}

fn detect_browser(user_agent: &str) -> &'static str {
    if user_agent.contains("YaBrowser/") {
        "Yandex"
    } else if user_agent.contains("Edg/") {
        "Edge"
    } else if user_agent.contains("Firefox/") {
        "Firefox"
    } else if user_agent.contains("Chrome/") {
        "Chrome"
    } else if user_agent.contains("Safari/") {
        "Safari"
    } else {
        "Other"
    }
}

fn detect_os(user_agent: &str) -> &'static str {
    if user_agent.contains("Windows") {
        "Windows"
    } else if user_agent.contains("Android") {
        "Android"
    } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
        "iOS"
    } else if user_agent.contains("Mac OS") {
        "macOS"
    } else if user_agent.contains("Linux") {
        "Linux"
    } else {
        "Other"
    }
}

fn anonymize_ip(value: &str) -> String {
    let first = value.split(',').next().unwrap_or_default().trim();
    match first.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            let [a, b, c, _] = ip.octets();
            format!("{a}.{b}.{c}.0")
        }
        Ok(IpAddr::V6(ip)) => {
            let segments = ip.segments();
            format!(
                "{:x}:{:x}:{:x}:{:x}::",
                segments[0], segments[1], segments[2], segments[3]
            )
        }
        Err(_) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anonymizes_addresses() {
        assert_eq!(anonymize_ip("192.0.2.45"), "192.0.2.0");
        assert_eq!(anonymize_ip("bad"), "");
    }

    #[test]
    fn cleans_html_markers() {
        assert_eq!(clean(" <b>hello</b> ", 20), "bhello/b");
    }

    #[test]
    fn uses_almaty_calendar_midnight() {
        let utc_day_ten = 10 * 86_400;
        let now = utc_day_ten + 20 * 60 * 60;
        assert_eq!(start_of_almaty_day(now), utc_day_ten + 19 * 60 * 60);
    }

    #[test]
    fn stores_and_reports_page_views() {
        let folder = std::env::temp_dir().join(format!(
            "qazdev-analytics-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let analytics = Analytics::open(folder.join("analytics.sqlite")).unwrap();
        analytics
            .record(
                &TrackPayload {
                    visitor_id: "visitor-1".to_string(),
                    session_id: "session-1".to_string(),
                    event_type: "page_view".to_string(),
                    page_url: "/test".to_string(),
                    page_title: "Test".to_string(),
                    ..TrackPayload::default()
                },
                &RequestMeta {
                    user_agent: "Mozilla/5.0 Chrome/140.0".to_string(),
                    ip: "192.0.2.45".to_string(),
                },
            )
            .unwrap();
        let report = analytics.report().unwrap();
        assert_eq!(report.visits_today, 1);
        assert_eq!(report.visitors_today, 1);
        assert_eq!(report.top_pages, vec![("/test".to_string(), 1)]);
        drop(analytics);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
