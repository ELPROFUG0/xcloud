use serde::Serialize;

#[cfg(feature = "local-speech")]
use fluidaudio_rs::FluidAudio;
#[cfg(feature = "local-speech")]
use std::fs;
#[cfg(feature = "local-speech")]
use std::path::PathBuf;
#[cfg(feature = "local-speech")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "local-speech")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(feature = "local-speech")]
pub struct AudioState {
    transcriber: Arc<Mutex<Option<FluidAudio>>>,
}

#[cfg(not(feature = "local-speech"))]
#[derive(Default)]
pub struct AudioState;

#[cfg(feature = "local-speech")]
impl Default for AudioState {
    fn default() -> Self {
        Self {
            transcriber: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    pub confidence: f32,
    pub duration: f64,
    pub processing_time: f64,
    pub rtfx: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub ready: bool,
    pub model_downloaded: bool,
    pub model_path: String,
}

#[cfg(feature = "local-speech")]
fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME not set".to_string())
}

#[cfg(feature = "local-speech")]
fn model_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Library/Application Support/FluidAudio/Models/parakeet-tdt-0.6b-v3-coreml"))
}

#[cfg(feature = "local-speech")]
fn model_downloaded() -> bool {
    let Ok(dir) = model_dir() else {
        return false;
    };

    [
        "Preprocessor.mlmodelc",
        "Encoder.mlmodelc",
        "Decoder.mlmodelc",
        "JointDecision.mlmodelc",
        "parakeet_vocab.json",
    ]
    .iter()
    .all(|asset| dir.join(asset).exists())
}

#[cfg(feature = "local-speech")]
fn ensure_transcriber(transcriber: &Arc<Mutex<Option<FluidAudio>>>) -> Result<(), String> {
    let mut guard = transcriber
        .lock()
        .map_err(|_| "Audio transcriber lock poisoned".to_string())?;

    if guard.is_some() {
        return Ok(());
    }

    let audio = FluidAudio::new().map_err(|e| e.to_string())?;
    audio.init_asr().map_err(|e| e.to_string())?;
    *guard = Some(audio);
    Ok(())
}

#[cfg(feature = "local-speech")]
fn safe_extension(extension: &str) -> &str {
    match extension {
        "aac" | "m4a" | "mp3" | "mp4" | "wav" | "webm" => extension,
        _ => "m4a",
    }
}

#[cfg(feature = "local-speech")]
#[tauri::command]
pub fn local_speech_status(state: tauri::State<'_, AudioState>) -> Result<AudioStatus, String> {
    let ready = state
        .transcriber
        .lock()
        .map_err(|_| "Audio transcriber lock poisoned".to_string())?
        .is_some();
    let path = model_dir()?;

    Ok(AudioStatus {
        ready,
        model_downloaded: model_downloaded(),
        model_path: path.to_string_lossy().to_string(),
    })
}

#[cfg(not(feature = "local-speech"))]
#[tauri::command]
pub fn local_speech_status(_state: tauri::State<'_, AudioState>) -> Result<AudioStatus, String> {
    Ok(AudioStatus {
        ready: false,
        model_downloaded: false,
        model_path: String::new(),
    })
}

#[cfg(feature = "local-speech")]
#[tauri::command]
pub async fn prepare_local_speech(
    state: tauri::State<'_, AudioState>,
) -> Result<AudioStatus, String> {
    let transcriber = state.transcriber.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_transcriber(&transcriber))
        .await
        .map_err(|e| format!("Audio preparation task failed: {}", e))??;

    let path = model_dir()?;
    Ok(AudioStatus {
        ready: true,
        model_downloaded: model_downloaded(),
        model_path: path.to_string_lossy().to_string(),
    })
}

#[cfg(not(feature = "local-speech"))]
#[tauri::command]
pub async fn prepare_local_speech(
    _state: tauri::State<'_, AudioState>,
) -> Result<AudioStatus, String> {
    Err("Local speech is not available in this build.".to_string())
}

#[cfg(feature = "local-speech")]
#[tauri::command]
pub fn transcribe_audio(
    state: tauri::State<'_, AudioState>,
    bytes: Vec<u8>,
    extension: String,
) -> Result<TranscriptionResult, String> {
    transcribe_audio_blocking(state.transcriber.clone(), bytes, extension)
}

#[cfg(not(feature = "local-speech"))]
#[tauri::command]
pub fn transcribe_audio(
    _state: tauri::State<'_, AudioState>,
    _bytes: Vec<u8>,
    _extension: String,
) -> Result<TranscriptionResult, String> {
    Err("Local speech is not available in this build.".to_string())
}

#[cfg(feature = "local-speech")]
#[tauri::command]
pub async fn transcribe_audio_background(
    state: tauri::State<'_, AudioState>,
    bytes: Vec<u8>,
    extension: String,
) -> Result<TranscriptionResult, String> {
    let transcriber = state.transcriber.clone();
    tauri::async_runtime::spawn_blocking(move || {
        transcribe_audio_blocking(transcriber, bytes, extension)
    })
    .await
    .map_err(|e| format!("Audio transcription task failed: {}", e))?
}

#[cfg(not(feature = "local-speech"))]
#[tauri::command]
pub async fn transcribe_audio_background(
    _state: tauri::State<'_, AudioState>,
    _bytes: Vec<u8>,
    _extension: String,
) -> Result<TranscriptionResult, String> {
    Err("Local speech is not available in this build.".to_string())
}

#[cfg(feature = "local-speech")]
fn transcribe_audio_blocking(
    transcriber: Arc<Mutex<Option<FluidAudio>>>,
    bytes: Vec<u8>,
    extension: String,
) -> Result<TranscriptionResult, String> {
    if bytes.is_empty() {
        return Err("No audio captured".to_string());
    }

    let dir = home_dir()?.join(".openclaw").join("audio-input");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio cache: {}", e))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Clock error: {}", e))?
        .as_millis();
    let path = dir.join(format!("voice-{}.{}", now, safe_extension(&extension)));

    fs::write(&path, bytes).map_err(|e| format!("Failed to write audio: {}", e))?;

    let result = {
        ensure_transcriber(&transcriber)?;

        let guard = transcriber
            .lock()
            .map_err(|_| "Audio transcriber lock poisoned".to_string())?;

        let audio = guard
            .as_ref()
            .ok_or_else(|| "Audio transcriber not available".to_string())?;

        audio.transcribe_file(&path).map_err(|e| e.to_string())
    };

    let _ = fs::remove_file(&path);

    let result = result?;
    Ok(TranscriptionResult {
        text: result.text.trim().to_string(),
        confidence: result.confidence,
        duration: result.duration,
        processing_time: result.processing_time,
        rtfx: result.rtfx,
    })
}
