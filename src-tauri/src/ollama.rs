use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{ipc::Channel, State};
use tokio_util::sync::CancellationToken;

const BASE: &str = "http://127.0.0.1:11434/api";
const OFFLINE: &str = "Couldn’t reach Ollama. Run ollama serve, then retry.";
const MAX_LINE: usize = 4 * 1024 * 1024;

pub struct Transport {
    client: reqwest::Client,
    runs: Arc<Mutex<HashMap<String, (Identity, CancellationToken)>>>,
}
impl Transport {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(6))
                .build()?,
            runs: Arc::new(Mutex::new(HashMap::new())),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    conversation_id: String,
    message_id: String,
    request_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    role: Role,
    content: String,
}

#[derive(Clone, Serialize)]
pub struct Event {
    #[serde(flatten)]
    identity: Identity,
    kind: &'static str,
    text: String,
}

#[tauri::command]
pub async fn list_models(state: State<'_, Transport>) -> Result<Vec<String>, String> {
    let response = state
        .client
        .get(format!("{BASE}/tags"))
        .timeout(Duration::from_secs(6))
        .send()
        .await
        .map_err(|_| OFFLINE.to_string())?;
    let data: Value = response
        .error_for_status()
        .map_err(|_| OFFLINE.to_string())?
        .json()
        .await
        .map_err(|e| format!("Invalid Ollama model list: {e}"))?;
    Ok(data["models"]
        .as_array()
        .ok_or("Invalid Ollama model list")?
        .iter()
        .filter_map(|m| m["name"].as_str().map(String::from))
        .collect())
}

#[tauri::command]
pub async fn start_reply(
    state: State<'_, Transport>,
    identity: Identity,
    model: String,
    messages: Vec<Message>,
    channel: Channel<Event>,
) -> Result<Identity, String> {
    if [
        &identity.request_id,
        &identity.conversation_id,
        &identity.message_id,
    ]
    .iter()
    .any(|s| s.is_empty() || s.len() > 128)
        || model.is_empty()
        || model.len() > 256
    {
        return Err("Invalid request identity or model".into());
    }
    let cancel = CancellationToken::new();
    {
        let mut runs = state
            .runs
            .lock()
            .map_err(|_| "Request registry unavailable")?;
        if runs.contains_key(&identity.request_id)
            || runs
                .values()
                .any(|(id, _)| id.conversation_id == identity.conversation_id)
        {
            return Err("This conversation already has an active response".into());
        }
        runs.insert(
            identity.request_id.clone(),
            (identity.clone(), cancel.clone()),
        );
    }
    let client = state.client.clone();
    let runs = state.runs.clone();
    let id = identity.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::select! {
            _ = cancel.cancelled() => Err("stopped".to_string()),
            result = reply(client, &model, messages, &id, &channel) => result,
        };
        // Retire first: receiving the terminal event permits an immediate Retry.
        if let Ok(mut runs) = runs.lock() {
            runs.remove(&id.request_id);
        }
        let (kind, text) = match result {
            Ok(()) => ("done", String::new()),
            Err(e) if e == "stopped" => ("stopped", String::new()),
            Err(e) => ("error", e),
        };
        let _ = channel.send(Event {
            identity: id,
            kind,
            text,
        });
        // Drop the channel, including on HTTP/parse failure and cancellation.
    });
    Ok(identity)
}

#[tauri::command]
pub fn cancel_reply(state: State<'_, Transport>, identity: Identity) -> Result<(), String> {
    let runs = state
        .runs
        .lock()
        .map_err(|_| "Request registry unavailable")?;
    if let Some((id, token)) = runs.get(&identity.request_id) {
        if id != &identity {
            return Err("Request identity did not match".into());
        }
        token.cancel();
    }
    Ok(())
}

// Buffer bytes, not decoded chunks: UTF-8 characters may span HTTP chunks.
fn consume(line: &[u8], mut text: impl FnMut(&str) -> Result<(), String>) -> Result<bool, String> {
    if line.iter().all(u8::is_ascii_whitespace) {
        return Ok(false);
    }
    let chunk: Value =
        serde_json::from_slice(line).map_err(|e| format!("Invalid Ollama stream: {e}"))?;
    if let Some(error) = chunk["error"].as_str() {
        return Err(error.into());
    }
    if let Some(delta) = chunk["message"]["content"].as_str() {
        text(delta)?;
    }
    Ok(chunk["done"].as_bool() == Some(true))
}

async fn reply(
    client: reqwest::Client,
    model: &str,
    messages: Vec<Message>,
    id: &Identity,
    channel: &Channel<Event>,
) -> Result<(), String> {
    let response = tokio::time::timeout(Duration::from_secs(120), client.post(format!("{BASE}/chat"))
        .json(&json!({ "model": model, "messages": messages, "stream": true, "think": false, "keep_alive": "10m" }))
        .send()).await.map_err(|_| "Ollama did not start a reply within two minutes. Please retry.")?
        .map_err(|_| OFFLINE.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = tokio::time::timeout(Duration::from_secs(6), provider_error(response))
            .await
            .ok()
            .flatten();
        return Err(format!(
            "Ollama returned {status}: {}",
            detail.unwrap_or_else(|| "Check the selected model and retry.".into())
        ));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut done = false;
    let mut emit = |delta: &str| {
        channel
            .send(Event {
                identity: id.clone(),
                kind: "text",
                text: delta.into(),
            })
            .map_err(|_| "The application stopped receiving this reply".to_string())
    };
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(120), stream.next())
        .await
        .map_err(|_| "Ollama sent no data for two minutes. Please retry.")?
    {
        let bytes = chunk.map_err(|e| format!("Ollama connection failed: {e}"))?;
        for byte in bytes {
            if byte == b'\n' {
                done |= consume(&buffer, &mut emit)?;
                buffer.clear();
                if done {
                    return Ok(());
                }
            } else {
                buffer.push(byte);
                if buffer.len() > MAX_LINE {
                    return Err("Ollama stream line exceeded the safety limit".into());
                }
            }
        }
    }
    done |= consume(&buffer, &mut emit)?;
    if done {
        Ok(())
    } else {
        Err("The connection ended before the reply finished. Please retry.".into())
    }
}

async fn provider_error(response: reqwest::Response) -> Option<String> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if bytes.len() + chunk.len() > 64 * 1024 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice::<Value>(&bytes).ok()?["error"]
        .as_str()
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_unicode_final_line_and_provider_errors() {
        let mut output = String::new();
        assert!(
            !consume("{\"message\":{\"content\":\"🙂\"}}".as_bytes(), |s| {
                output.push_str(s);
                Ok(())
            })
            .unwrap()
        );
        assert_eq!(output, "🙂");
        assert!(consume(b"{\"done\":true}", |_| Ok(())).unwrap());
        assert_eq!(
            consume(b"{\"error\":\"model unavailable\"}", |_| Ok(())).unwrap_err(),
            "model unavailable"
        );
        assert!(consume(b"{bad", |_| Ok(())).is_err());
    }
}
