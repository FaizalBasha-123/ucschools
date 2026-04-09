pub mod storage;
pub mod tasks;

use std::collections::HashMap;

use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;

use ai_tutor_domain::{
    action::LessonAction,
    scene::{Scene, SceneOutline, SlideBackground, SlideElement},
};

use crate::storage::{infer_content_type, AssetKind, AssetStore};
use crate::tasks::{MediaTask, TtsTask};

pub fn collect_media_tasks(lesson_id: &str, outlines: &[SceneOutline]) -> Vec<MediaTask> {
    let now = Utc::now();

    outlines
        .iter()
        .flat_map(|outline| {
            outline
                .media_generations
                .iter()
                .map(|request| MediaTask::from_request(lesson_id, &outline.id, request, now))
        })
        .collect()
}

pub fn replace_media_placeholders(
    scenes: &mut [Scene],
    media_map: &HashMap<String, String>,
) -> Result<()> {
    for scene in scenes {
        match &mut scene.content {
            ai_tutor_domain::scene::SceneContent::Slide { canvas } => {
                for element in &mut canvas.elements {
                    match element {
                        SlideElement::Image { src, .. } | SlideElement::Video { src, .. } => {
                            if let Some(url) = media_map.get(src) {
                                *src = url.clone();
                            }
                        }
                        _ => {}
                    }
                }

                if let Some(SlideBackground::Image { src }) = &mut canvas.background {
                    if let Some(url) = media_map.get(src) {
                        *src = url.clone();
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}

pub fn collect_tts_tasks(lesson_id: &str, scenes: &[Scene]) -> Vec<TtsTask> {
    let now = Utc::now();

    scenes
        .iter()
        .flat_map(|scene| {
            scene.actions.iter().filter_map(|action| match action {
                LessonAction::Speech {
                    id,
                    text,
                    voice,
                    speed,
                    ..
                } if !text.trim().is_empty() => Some(TtsTask::new(
                    lesson_id,
                    &scene.id,
                    id,
                    text,
                    voice.clone(),
                    *speed,
                    now,
                )),
                _ => None,
            })
        })
        .collect()
}

pub fn apply_tts_results(scenes: &mut [Scene], audio_map: &HashMap<String, String>) -> Result<()> {
    for scene in scenes {
        for action in &mut scene.actions {
            if let LessonAction::Speech {
                id,
                audio_id,
                audio_url,
                ..
            } = action
            {
                if let Some(url) = audio_map.get(id) {
                    *audio_id = Some(format!("tts_{}", id));
                    *audio_url = Some(url.clone());
                }
            }
        }
    }

    Ok(())
}

pub async fn persist_inline_audio_assets(
    store: &dyn AssetStore,
    lesson_id: &str,
    scenes: &mut [Scene],
) -> Result<()> {
    for scene in scenes {
        for action in &mut scene.actions {
            if let LessonAction::Speech {
                id,
                audio_url: Some(audio_url),
                ..
            } = action
            {
                if let Some((mime_type, bytes)) = decode_data_url(audio_url)? {
                    let extension = extension_for_mime(mime_type);
                    let filename = format!("tts_{}.{}", id, extension);
                    *audio_url = store
                        .persist_asset(
                            AssetKind::Audio,
                            lesson_id,
                            &filename,
                            &infer_content_type(std::path::Path::new(&filename), mime_type),
                            bytes,
                        )
                        .await?;
                }
            }
        }
    }

    Ok(())
}

pub async fn persist_inline_media_assets(
    store: &dyn AssetStore,
    lesson_id: &str,
    scenes: &mut [Scene],
) -> Result<()> {
    for scene in scenes {
        match &mut scene.content {
            ai_tutor_domain::scene::SceneContent::Slide { canvas } => {
                for element in &mut canvas.elements {
                    match element {
                        SlideElement::Image { id, src, .. }
                        | SlideElement::Video { id, src, .. } => {
                            if let Some((mime_type, bytes)) = decode_data_url(src)? {
                                let extension = extension_for_media_mime(mime_type);
                                let filename =
                                    format!("{}_{}.{}", element_prefix(mime_type), id, extension);
                                *src = store
                                    .persist_asset(
                                        AssetKind::Media,
                                        lesson_id,
                                        &filename,
                                        &infer_content_type(
                                            std::path::Path::new(&filename),
                                            mime_type,
                                        ),
                                        bytes,
                                    )
                                    .await?;
                            }
                        }
                        _ => {}
                    }
                }

                if let Some(SlideBackground::Image { src }) = &mut canvas.background {
                    if let Some((mime_type, bytes)) = decode_data_url(src)? {
                        let extension = extension_for_media_mime(mime_type);
                        let filename = format!("background_{}.{}", scene.id, extension);
                        *src = store
                            .persist_asset(
                                AssetKind::Media,
                                lesson_id,
                                &filename,
                                &infer_content_type(std::path::Path::new(&filename), mime_type),
                                bytes,
                            )
                            .await?;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}

fn decode_data_url(value: &str) -> Result<Option<(&str, Vec<u8>)>> {
    if !value.starts_with("data:") {
        return Ok(None);
    }

    let Some((meta, payload)) = value.split_once(',') else {
        return Ok(None);
    };
    let mime_type = meta
        .strip_prefix("data:")
        .and_then(|rest| rest.split(';').next())
        .unwrap_or("audio/mpeg");
    let bytes = STANDARD.decode(payload)?;
    Ok(Some((mime_type, bytes)))
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        _ => "mp3",
    }
}

fn extension_for_media_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        mime if mime.starts_with("image/") => "png",
        mime if mime.starts_with("video/") => "mp4",
        other => {
            let _ = other;
            "bin"
        }
    }
}

fn element_prefix(mime_type: &str) -> &'static str {
    if mime_type.starts_with("video/") {
        "video"
    } else if mime_type.starts_with("image/") {
        "image"
    } else {
        "asset"
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    use ai_tutor_domain::{
        action::LessonAction,
        scene::{
            MediaGenerationRequest, MediaType, Scene, SceneContent, SceneOutline, SceneType,
            SlideBackground, SlideCanvas, SlideElement, SlideTheme,
        },
    };

    use super::{
        apply_tts_results, collect_media_tasks, collect_tts_tasks, persist_inline_audio_assets,
        persist_inline_media_assets, replace_media_placeholders,
    };
    use crate::storage::LocalFileAssetStore;

    #[test]
    fn collects_media_tasks_from_outlines() {
        let outlines = vec![SceneOutline {
            id: "outline-1".to_string(),
            scene_type: SceneType::Slide,
            title: "Intro".to_string(),
            description: "Intro scene".to_string(),
            key_points: vec!["One".to_string()],
            teaching_objective: None,
            estimated_duration: None,
            order: 1,
            language: Some("en-US".to_string()),
            suggested_image_ids: vec![],
            media_generations: vec![
                MediaGenerationRequest {
                    element_id: "gen_img_1".to_string(),
                    media_type: MediaType::Image,
                    prompt: "A pizza divided into slices".to_string(),
                    aspect_ratio: Some("16:9".to_string()),
                },
                MediaGenerationRequest {
                    element_id: "gen_vid_1".to_string(),
                    media_type: MediaType::Video,
                    prompt: "A pie chart animation".to_string(),
                    aspect_ratio: None,
                },
            ],
            quiz_config: None,
            interactive_config: None,
            project_config: None,
        }];

        let tasks = collect_media_tasks("lesson-1", &outlines);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].lesson_id, "lesson-1");
        assert_eq!(tasks[0].scene_outline_id, "outline-1");
    }

    #[test]
    fn replaces_media_placeholders_inside_scenes() {
        let mut scenes = vec![Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Slide".to_string(),
            order: 1,
            content: SceneContent::Slide {
                canvas: SlideCanvas {
                    id: "canvas-1".to_string(),
                    viewport_width: 1000,
                    viewport_height: 563,
                    viewport_ratio: 0.5625,
                    theme: SlideTheme {
                        background_color: "#ffffff".to_string(),
                        theme_colors: vec!["#000000".to_string()],
                        font_color: "#111111".to_string(),
                        font_name: "Geist".to_string(),
                    },
                    elements: vec![
                        SlideElement::Image {
                            id: "image-1".to_string(),
                            left: 0.0,
                            top: 0.0,
                            width: 300.0,
                            height: 200.0,
                            src: "gen_img_1".to_string(),
                        },
                        SlideElement::Video {
                            id: "video-1".to_string(),
                            left: 0.0,
                            top: 210.0,
                            width: 300.0,
                            height: 200.0,
                            src: "gen_vid_1".to_string(),
                        },
                    ],
                    background: Some(SlideBackground::Image {
                        src: "gen_bg_1".to_string(),
                    }),
                },
            },
            actions: vec![LessonAction::Speech {
                id: "action-1".to_string(),
                title: None,
                description: None,
                text: "hello".to_string(),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            }],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];

        let media_map = HashMap::from([
            (
                "gen_img_1".to_string(),
                "https://example.test/image.png".to_string(),
            ),
            (
                "gen_vid_1".to_string(),
                "https://example.test/video.mp4".to_string(),
            ),
            (
                "gen_bg_1".to_string(),
                "https://example.test/background.png".to_string(),
            ),
        ]);

        replace_media_placeholders(&mut scenes, &media_map).unwrap();

        match &scenes[0].content {
            SceneContent::Slide { canvas } => {
                match &canvas.elements[0] {
                    SlideElement::Image { src, .. } => {
                        assert_eq!(src, "https://example.test/image.png")
                    }
                    _ => panic!("expected image element"),
                }
                match &canvas.elements[1] {
                    SlideElement::Video { src, .. } => {
                        assert_eq!(src, "https://example.test/video.mp4")
                    }
                    _ => panic!("expected video element"),
                }
                match &canvas.background {
                    Some(SlideBackground::Image { src }) => {
                        assert_eq!(src, "https://example.test/background.png")
                    }
                    _ => panic!("expected background image"),
                }
            }
            _ => panic!("expected slide scene"),
        }
    }

    #[test]
    fn collects_tts_tasks_from_speech_actions() {
        let scenes = vec![Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Slide".to_string(),
            order: 1,
            content: SceneContent::Quiz { questions: vec![] },
            actions: vec![
                LessonAction::Speech {
                    id: "action-1".to_string(),
                    title: None,
                    description: None,
                    text: "Fractions show parts of a whole.".to_string(),
                    audio_id: None,
                    audio_url: None,
                    voice: Some("teacher".to_string()),
                    speed: Some(1.0),
                },
                LessonAction::Discussion {
                    id: "action-2".to_string(),
                    title: None,
                    description: None,
                    topic: "Why do fractions matter?".to_string(),
                    prompt: None,
                    agent_id: None,
                },
            ],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];

        let tasks = collect_tts_tasks("lesson-1", &scenes);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].lesson_id, "lesson-1");
        assert_eq!(tasks[0].scene_id, "scene-1");
        assert_eq!(tasks[0].action_id, "action-1");
    }

    #[test]
    fn applies_tts_results_back_into_speech_actions() {
        let mut scenes = vec![Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Slide".to_string(),
            order: 1,
            content: SceneContent::Quiz { questions: vec![] },
            actions: vec![LessonAction::Speech {
                id: "action-1".to_string(),
                title: None,
                description: None,
                text: "Fractions show parts of a whole.".to_string(),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            }],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];

        let audio_map = HashMap::from([(
            "action-1".to_string(),
            "https://example.test/audio/action-1.mp3".to_string(),
        )]);

        apply_tts_results(&mut scenes, &audio_map).unwrap();

        match &scenes[0].actions[0] {
            LessonAction::Speech {
                audio_id,
                audio_url,
                ..
            } => {
                assert_eq!(audio_id.as_deref(), Some("tts_action-1"));
                assert_eq!(
                    audio_url.as_deref(),
                    Some("https://example.test/audio/action-1.mp3")
                );
            }
            _ => panic!("expected speech action"),
        }
    }

    #[test]
    fn persists_inline_audio_assets_and_rewrites_urls() {
        let temp_root = std::env::temp_dir().join(format!(
            "ai-tutor-audio-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let mut scenes = vec![Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Slide".to_string(),
            order: 1,
            content: SceneContent::Quiz { questions: vec![] },
            actions: vec![LessonAction::Speech {
                id: "action-1".to_string(),
                title: None,
                description: None,
                text: "Fractions show parts of a whole.".to_string(),
                audio_id: Some("tts_action-1".to_string()),
                audio_url: Some("data:audio/mpeg;base64,ZmFrZQ==".to_string()),
                voice: None,
                speed: None,
            }],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];

        let store = Arc::new(LocalFileAssetStore::new(
            &temp_root,
            "http://localhost:8099",
        ));

        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(persist_inline_audio_assets(
                store.as_ref(),
                "lesson-1",
                &mut scenes,
            ))
            .unwrap();

        let expected_path: PathBuf = temp_root
            .join("assets")
            .join("audio")
            .join("lesson-1")
            .join("tts_action-1.mp3");
        assert!(expected_path.exists());

        match &scenes[0].actions[0] {
            LessonAction::Speech { audio_url, .. } => {
                assert_eq!(
                    audio_url.as_deref(),
                    Some("http://localhost:8099/api/assets/audio/lesson-1/tts_action-1.mp3")
                );
            }
            _ => panic!("expected speech action"),
        }
    }

    #[test]
    fn persists_inline_media_assets_and_rewrites_urls() {
        let temp_root = std::env::temp_dir().join(format!(
            "ai-tutor-media-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let mut scenes = vec![Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Slide".to_string(),
            order: 1,
            content: SceneContent::Slide {
                canvas: SlideCanvas {
                    id: "canvas-1".to_string(),
                    viewport_width: 1000,
                    viewport_height: 563,
                    viewport_ratio: 0.5625,
                    theme: SlideTheme {
                        background_color: "#ffffff".to_string(),
                        theme_colors: vec!["#000000".to_string()],
                        font_color: "#111111".to_string(),
                        font_name: "Geist".to_string(),
                    },
                    elements: vec![SlideElement::Image {
                        id: "image-1".to_string(),
                        left: 0.0,
                        top: 0.0,
                        width: 300.0,
                        height: 200.0,
                        src: "data:image/png;base64,ZmFrZQ==".to_string(),
                    }],
                    background: Some(SlideBackground::Image {
                        src: "data:image/png;base64,ZmFrZQ==".to_string(),
                    }),
                },
            },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];

        let store = Arc::new(LocalFileAssetStore::new(
            &temp_root,
            "http://localhost:8099",
        ));

        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(persist_inline_media_assets(
                store.as_ref(),
                "lesson-1",
                &mut scenes,
            ))
            .unwrap();

        let expected_path: PathBuf = temp_root
            .join("assets")
            .join("media")
            .join("lesson-1")
            .join("image_image-1.png");
        assert!(expected_path.exists());

        match &scenes[0].content {
            SceneContent::Slide { canvas } => match &canvas.elements[0] {
                SlideElement::Image { src, .. } => {
                    assert_eq!(
                        src,
                        "http://localhost:8099/api/assets/media/lesson-1/image_image-1.png"
                    );
                }
                _ => panic!("expected image element"),
            },
            _ => panic!("expected slide scene"),
        }
    }
}
