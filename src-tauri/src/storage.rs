use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const VERSION: i64 = 1;
pub struct Storage {
    db: Mutex<Option<Result<Database, String>>>,
    path: Result<PathBuf, String>,
}
impl Storage {
    fn access<T>(&self, f: impl FnOnce(&mut Database) -> Result<T, String>) -> Result<T, String> {
        let mut lock = self.db.lock().map_err(|_| "Storage unavailable")?;
        if lock.is_none() {
            *lock = Some(self.path.as_ref().map_err(Clone::clone).and_then(|path| {
                std::fs::create_dir_all(path.parent().ok_or("Missing application data directory")?)
                    .map_err(|e| e.to_string())?;
                Database::open(path)
            }));
        }
        f(lock.as_mut().unwrap().as_mut().map_err(|e| e.clone())?)
    }
}
pub struct Database {
    conn: Connection,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: i64,
    pub store: Value,
    pub workspace: Value,
    pub model: String,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let existed = path.exists();
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(|e| e.to_string())?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > VERSION {
            return Err(format!("Database schema {version} is newer than this app supports ({VERSION}). Keep the original and use a newer app."));
        }
        if version < VERSION {
            if existed {
                let stamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                conn.backup(
                    rusqlite::MAIN_DB,
                    path.with_extension(format!("before-v{VERSION}-{stamp}.sqlite")),
                    None,
                )
                .map_err(|e| format!("Cannot back up before migration: {e}"))?;
            }
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch("CREATE TABLE conversations(id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, json TEXT NOT NULL);
                CREATE TABLE messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), ordinal INTEGER NOT NULL, state TEXT NOT NULL, json TEXT NOT NULL);
                CREATE TABLE workspace(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, json TEXT NOT NULL, model TEXT NOT NULL);
                PRAGMA user_version=1;").map_err(|e| format!("Migration failed; original preserved: {e}"))?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "synchronous", "FULL")
            .map_err(|e| e.to_string())?;
        let mut db = Self { conn };
        // Recovery is itself transactional and never resumes inference.
        let tx = db.conn.transaction().map_err(|e| e.to_string())?;
        let interrupted: Vec<(String, String)> = {
            let mut stmt = tx
                .prepare("SELECT id,json FROM messages WHERE state='streaming'")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for (id, raw) in interrupted {
            let mut message: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            message["status"] = json!("error");
            message["error"] =
                json!("Interrupted when afterlight quit. Retry to start a new response.");
            tx.execute(
                "UPDATE messages SET state='error',json=?1 WHERE id=?2",
                params![message.to_string(), id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(db)
    }
    pub fn load(&self) -> Result<Snapshot, String> {
        let mut store = serde_json::Map::new();
        let mut stmt = self
            .conn
            .prepare("SELECT id,json FROM conversations ORDER BY ordinal")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, raw) = row.map_err(|e| e.to_string())?;
            let mut conversation: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let mut messages = self
                .conn
                .prepare("SELECT json FROM messages WHERE conversation_id=?1 ORDER BY ordinal")
                .map_err(|e| e.to_string())?;
            let rows = messages
                .query_map([&id], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut values = Vec::new();
            for raw in rows {
                values.push(
                    serde_json::from_str::<Value>(&raw.map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?,
                );
            }
            conversation["messages"] = json!(values);
            store.insert(id, conversation);
        }
        let workspace: Option<(i64, String, String)> = self
            .conn
            .query_row(
                "SELECT revision,json,model FROM workspace WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (revision, view, model) = workspace.unwrap_or((0, "null".into(), "qwen3:8b".into()));
        Ok(Snapshot {
            revision,
            store: Value::Object(store),
            workspace: serde_json::from_str(&view).map_err(|e| e.to_string())?,
            model,
        })
    }
    pub fn save(&mut self, snapshot: Snapshot) -> Result<(), String> {
        let previous = self.load()?;
        if snapshot.revision <= previous.revision {
            return Err("Refusing a stale workspace revision".into());
        }
        let store = snapshot
            .store
            .as_object()
            .ok_or("Invalid conversation store")?;
        // No deletion API: missing conversations in a write are always an error.
        if previous
            .store
            .as_object()
            .unwrap()
            .keys()
            .any(|id| !store.contains_key(id))
        {
            return Err("Refusing to remove saved conversations".into());
        }
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        for (ordinal, (id, c)) in store.iter().enumerate() {
            if c["id"].as_str() != Some(id) {
                return Err("Conversation ID does not match".into());
            }
            if let Some(old) = previous.store.get(id) {
                if old["source"] != c["source"] || old["inheritedContext"] != c["inheritedContext"]
                {
                    return Err("Refusing to change frozen conversation provenance".into());
                }
            }
            let mut metadata = c.clone();
            metadata
                .as_object_mut()
                .ok_or("Invalid conversation")?
                .remove("messages");
            tx.execute("INSERT INTO conversations VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET json=excluded.json", params![id, c["createdAt"].as_i64().unwrap_or(ordinal as i64), metadata.to_string()]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM messages WHERE conversation_id=?1", [id])
                .map_err(|e| e.to_string())?;
            for (order, message) in c["messages"]
                .as_array()
                .ok_or("Invalid message list")?
                .iter()
                .enumerate()
            {
                let mid = message["id"].as_str().ok_or("Missing message ID")?;
                let status = message["status"].as_str().unwrap_or("complete");
                tx.execute(
                    "INSERT INTO messages VALUES(?1,?2,?3,?4,?5)",
                    params![mid, id, order as i64, status, message.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.execute("INSERT INTO workspace VALUES(1,?1,?2,?3) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,json=excluded.json,model=excluded.model", params![snapshot.revision, snapshot.workspace.to_string(), snapshot.model]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn export(&self, path: &Path) -> Result<(), String> {
        self.conn
            .backup(rusqlite::MAIN_DB, path, None)
            .map_err(|e| e.to_string())
    }
}

pub fn initialize(app: &tauri::AppHandle) -> Storage {
    Storage {
        db: Mutex::new(None),
        path: app
            .path()
            .app_data_dir()
            .map(|dir| dir.join("afterlight.sqlite"))
            .map_err(|e| e.to_string()),
    }
}
#[tauri::command]
pub async fn load_workspace(app: tauri::AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Storage>().access(|db| db.load()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_workspace(app: tauri::AppHandle, snapshot: Snapshot) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Storage>().access(|db| db.save(snapshot))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    static NEXT_PATH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "afterlight-test-{}-{}-{}.sqlite",
            std::process::id(),
            NEXT_PATH.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn snapshot(revision: i64) -> Snapshot {
        Snapshot {
            revision,
            store: json!({"a":{"id":"a","title":"hello","draft":"draft","source":null,"inheritedContext":[],"messages":[{"id":"m","role":"assistant","content":"partial","status":"streaming","model":"qwen3:8b"}]}}),
            workspace: json!({"mainId":"a","sideId":null}),
            model: "qwen3:8b".into(),
        }
    }
    #[test]
    fn recovery_export_stale_write_and_atomic_failure() {
        let original = path();
        let mut db = Database::open(&original).unwrap();
        db.save(snapshot(1)).unwrap();
        assert!(db.save(snapshot(1)).is_err());
        let mut invalid = snapshot(2);
        invalid.store["a"]["messages"][0]["id"] = Value::Null;
        assert!(db.save(invalid).is_err());
        assert_eq!(db.load().unwrap().revision, 1);
        let backup = path();
        db.export(&backup).unwrap();
        let restored = Database::open(&backup).unwrap().load().unwrap();
        assert_eq!(restored.store["a"]["messages"][0]["content"], "partial");
        assert_eq!(restored.store["a"]["messages"][0]["status"], "error");
        assert_eq!(restored.store["a"]["draft"], "draft");
        db.conn.pragma_update(None, "query_only", true).unwrap();
        assert!(db.save(snapshot(2)).is_err());
        assert_eq!(db.load().unwrap().revision, 1);
    }
    #[test]
    fn retry_keeps_frozen_sources_and_disk_full_rolls_back() {
        let mut db = Database::open(&path()).unwrap();
        let mut first = snapshot(1);
        first.store["a"]["messages"][0]
            .as_object_mut()
            .unwrap()
            .remove("status");
        let frozen = first.store["a"]["messages"][0].clone();
        first.store["b"] = json!({"id":"b","title":"child","draft":"child draft","messages":[],"source":{"conversationId":"a","anchor":{"messageId":"m","selectedText":"partial","startOffset":0,"endOffset":7,"streamVersion":"afterlight-markdown-v1"},"messageSnapshot":frozen},"inheritedContext":[{"role":"assistant","content":"partial"}]});
        db.save(first.clone()).unwrap();
        let mut retry = first.clone();
        retry.revision = 2;
        retry.store["a"]["messages"][0] =
            json!({"id":"replacement","role":"assistant","content":"new answer"});
        db.save(retry.clone()).unwrap();
        let restored = db.load().unwrap();
        assert_eq!(restored.store["b"], first.store["b"]);
        let pages: i64 = db
            .conn
            .pragma_query_value(None, "page_count", |r| r.get(0))
            .unwrap();
        db.conn
            .pragma_update(None, "max_page_count", pages)
            .unwrap();
        let mut full = retry;
        full.revision = 3;
        full.store["a"]["draft"] = json!("x".repeat(1024 * 1024));
        assert!(db.save(full).unwrap_err().contains("full"));
        assert_eq!(db.load().unwrap().revision, 2);
        assert_eq!(db.load().unwrap().store["b"], first.store["b"]);
    }
    #[test]
    fn refuses_newer_schema_and_rolls_back_failed_migration() {
        let newer = path();
        let conn = Connection::open(&newer).unwrap();
        conn.execute_batch("PRAGMA user_version=99; CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('keep');").unwrap();
        drop(conn);
        assert!(Database::open(&newer).is_err());
        let conn = Connection::open(newer).unwrap();
        assert_eq!(
            conn.query_row("SELECT value FROM retained", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "keep"
        );
        let legacy = path();
        let conn = Connection::open(&legacy).unwrap();
        conn.execute_batch(
            "CREATE TABLE messages(value TEXT); INSERT INTO messages VALUES('original');",
        )
        .unwrap();
        drop(conn);
        assert!(Database::open(&legacy).is_err());
        let conn = Connection::open(legacy).unwrap();
        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT value FROM messages", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
    }
}

#[tauri::command]
pub async fn export_backup(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("afterlight-backup.sqlite")
            .blocking_save_file()
        else {
            return Ok(());
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        app.state::<Storage>().access(|db| db.export(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn confirm_exit_without_saving(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    tauri::async_runtime::spawn_blocking(move || app.dialog()
        .message("Changes could not be saved. Keep the app open to retry saving, or explicitly exit without saving.")
        .title("Unsaved changes")
        .buttons(MessageDialogButtons::OkCancelCustom("Exit without saving".into(), "Keep app open".into()))
        .blocking_show()).await.map_err(|e|e.to_string())
}
