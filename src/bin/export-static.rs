use std::{
    env, fs,
    path::{Path, PathBuf},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use qazdevstudio::{AppState, Software, app};
use tower::ServiceExt;

const CATEGORIES: [&str; 14] = [
    "system",
    "productivity",
    "developer",
    "multimedia",
    "graphics",
    "games",
    "internet",
    "education",
    "security",
    "communication",
    "network",
    "ai",
    "screenshots",
    "files",
];

const SERVICE_PAGES: [&str; 9] = [
    "razrabotka-saitov-kazakhstan.html",
    "razrabotka-saitov-astana.html",
    "razrabotka-saitov-almaty.html",
    "razrabotka-saitov-karaganda.html",
    "razrabotka-saitov-shymkent.html",
    "razrabotka-saitov-taldykorgan.html",
    "telegram-bot-kazakhstan.html",
    "crm-dlya-biznesa-kazakhstan.html",
    "avtomatizaciya-biznesa-kazakhstan.html",
];

#[tokio::main]
async fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("target/plesk-site"));

    prepare_output(&root, &output).expect("failed to prepare static output");
    let router = app(AppState::for_static_export(root.clone()));

    copy_legacy_public_files(&root, &output).expect("failed to copy public files");
    export_core_pages(&router, &root, &output)
        .await
        .expect("failed to render static site");

    println!("Rust static site exported to {}", output.display());
}

fn prepare_output(root: &Path, output: &Path) -> std::io::Result<()> {
    let output = if output.is_absolute() {
        output.to_path_buf()
    } else {
        root.join(output)
    };
    if output == root || output.parent().is_none() || output.file_name().is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "output must be a dedicated directory",
        ));
    }
    if output.exists() {
        fs::remove_dir_all(&output)?;
    }
    fs::create_dir_all(output)
}

fn copy_legacy_public_files(root: &Path, output: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file()
            && matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("html" | "svg" | "webmanifest")
            )
        {
            fs::copy(&path, output.join(entry.file_name()))?;
        }
    }

    for file in [".htaccess", "efeebfa2eec920c3dacdc19c51c483dc.txt"] {
        copy_file_if_present(&root.join(file), &output.join(file))?;
    }

    for directory in ["api", "assets", "css", "js", "solutions"] {
        copy_directory(&root.join(directory), &output.join(directory))?;
    }

    let public_templates = [
        "index.html",
        "dogovor-razrabotka-saita.html",
        "tz-na-sait.html",
        "tz-na-telegram-bot.html",
        "kommercheskoe-predlozhenie.html",
    ];
    fs::create_dir_all(output.join("templates"))?;
    for file in public_templates {
        copy_file_if_present(
            &root.join("templates").join(file),
            &output.join("templates").join(file),
        )?;
    }
    Ok(())
}

async fn export_core_pages(
    router: &Router,
    root: &Path,
    output: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    export(router, "/", &output.join("index.html"), StatusCode::OK).await?;
    for page in SERVICE_PAGES {
        export(
            router,
            &format!("/{page}"),
            &output.join(page),
            StatusCode::OK,
        )
        .await?;
    }

    export(
        router,
        "/blog/",
        &output.join("blog/index.html"),
        StatusCode::OK,
    )
    .await?;
    for entry in fs::read_dir(root.join("blog"))? {
        let entry = entry?;
        let file = entry.file_name();
        let name = file.to_string_lossy();
        if name != "index.html" && name.ends_with(".html") {
            export(
                router,
                &format!("/blog/{name}"),
                &output.join("blog").join(file),
                StatusCode::OK,
            )
            .await?;
        }
    }

    export(
        router,
        "/programmy/",
        &output.join("programmy/index.html"),
        StatusCode::OK,
    )
    .await?;
    for category in CATEGORIES {
        let file = format!("{category}.html");
        export(
            router,
            &format!("/programmy/kategorii/{file}"),
            &output.join("programmy/kategorii").join(file),
            StatusCode::OK,
        )
        .await?;
    }

    let software: Vec<Software> =
        serde_json::from_str(&fs::read_to_string(root.join("data/software.json"))?)?;
    for software in &software {
        let file = format!("{}.html", software.slug);
        export(
            router,
            &format!("/programmy/{file}"),
            &output.join("programmy").join(file),
            StatusCode::OK,
        )
        .await?;
    }

    for (route, file) in [
        ("/site.css", "site.css"),
        ("/site.js", "site.js"),
        ("/robots.txt", "robots.txt"),
        ("/ads.txt", "ads.txt"),
        ("/sitemap-index.xml", "sitemap-index.xml"),
        ("/sitemap.xml", "sitemap.xml"),
        ("/sitemap-programmy.xml", "sitemap-programmy.xml"),
        ("/api/programs.json", "api/programs.json"),
    ] {
        export(router, route, &output.join(file), StatusCode::OK).await?;
    }
    export(
        router,
        "/__static-export-404__",
        &output.join("404.html"),
        StatusCode::NOT_FOUND,
    )
    .await?;

    println!(
        "Rendered {} programs, {} categories and all blog/service pages",
        software.len(),
        CATEGORIES.len()
    );
    Ok(())
}

async fn export(
    router: &Router,
    route: &str,
    destination: &Path,
    expected_status: StatusCode,
) -> Result<(), Box<dyn std::error::Error>> {
    let response = router
        .clone()
        .oneshot(Request::builder().uri(route).body(Body::empty())?)
        .await?;
    if response.status() != expected_status {
        return Err(format!("{route} returned {}", response.status()).into());
    }
    let body = to_bytes(response.into_body(), 16 * 1024 * 1024).await?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(destination, body)?;
    Ok(())
}

fn copy_file_if_present(source: &Path, destination: &Path) -> std::io::Result<()> {
    if !source.exists() {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            copy_file_if_present(&source_path, &destination_path)?;
        }
    }
    Ok(())
}
