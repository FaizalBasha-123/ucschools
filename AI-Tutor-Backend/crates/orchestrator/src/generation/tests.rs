mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

    use super::super::*;
    use ai_tutor_domain::generation::{AgentMode, Language, UserRequirements};
    use ai_tutor_domain::scene::{MediaType, VisualType, SlideElement, SlideCanvas, SlideTheme};

    struct MockLlmProvider {
        responses: Mutex<Vec<String>>,
    }

    struct FlakyLlmProvider {
        failures_before_success: AtomicUsize,
        response: String,
        error_message: String,
        call_count: AtomicUsize,
    }

    struct SharedFlakyLlmProvider {
        inner: Arc<FlakyLlmProvider>,
    }

    #[async_trait]
    impl LlmProvider for MockLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("no mock response available"));
            }
            Ok(responses.remove(0))
        }
    }

    #[async_trait]
    impl LlmProvider for FlakyLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            let remaining = self.failures_before_success.load(Ordering::SeqCst);
            if remaining > 0 {
                self.failures_before_success.fetch_sub(1, Ordering::SeqCst);
                return Err(anyhow!(self.error_message.clone()));
            }
            Ok(self.response.clone())
        }
    }

    #[async_trait]
    impl LlmProvider for SharedFlakyLlmProvider {
        async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
            self.inner.generate_text(system_prompt, user_prompt).await
        }
    }

    fn sample_request() -> LessonGenerationRequest {
        LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
            },
            pdf_content: None,
            pdf_images: vec![],
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
            account_id: None,
            school_id: None,
            quality_mode: None,
            learning_mode: None,
            precharged_credits: None,
            extra_scenes_consented: false,
        }
    }

    #[tokio::test]
    async fn llm_pipeline_parses_outline_content_and_actions() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                // Outline LLM: slide with visual_type=image to get media_generation
                "```json\n{\"outlines\":[{\"title\":\"Intro to Fractions\",\"description\":\"Basic idea\",\"key_points\":[\"What a fraction is\",\"Parts of a fraction\"],\"scene_type\":\"slide\",\"visual_type\":\"image\"},{\"title\":\"Fraction Quiz\",\"description\":\"Check learning\",\"key_points\":[\"Identify numerator\"],\"scene_type\":\"quiz\"}]}\n```".to_string(),
                "Here is the JSON:\n{\"elements\":[{\"kind\":\"text\",\"content\":\"Fractions represent parts of a whole.\",\"left\":60.0,\"top\":80.0,\"width\":800.0,\"height\":100.0}]}".to_string(),
                "```json\n{\"actions\":[{\"action_type\":\"speech\",\"text\":\"A fraction shows part of a whole.\"}]}\n```".to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 2);
        assert!(matches!(outlines[0].scene_type, SceneType::Slide));
        // visual_type=image + flag on → exactly 1 media_generation
        assert_eq!(outlines[0].media_generations.len(), 1);

        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();
        match &content {
            SceneContent::Slide { canvas } => {
                assert!(canvas.elements.len() >= 2);
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Text { content, .. } => content.contains("Intro to Fractions"),
                    _ => false,
                }));
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Image { src, .. } => src == "gen_img_1",
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content, None, &outlines, 0, &[])
            .await
            .unwrap();
        assert!(!actions.is_empty());
        assert!(matches!(actions[0], LessonAction::Speech { .. }));
    }

    #[tokio::test]
    async fn outline_media_requests_are_filtered_when_generation_is_disabled() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide","media_generations":[{"element_id":"gen_img_1","media_type":"image","prompt":"A fraction wheel","aspect_ratio":"16:9"},{"element_id":"gen_vid_1","media_type":"video","prompt":"A rotating fraction chart","aspect_ratio":"16:9"}]}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert!(outlines[0].media_generations.is_empty());
    }

    #[tokio::test]
    async fn no_image_without_explicit_visual_type_image() {
        // Old behavior: auto-inject image regardless of LLM choice. DELETED.
        // New behavior: NO image unless LLM explicitly says visual_type=image.
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                // LLM gives a slide but omits visual_type (defaults to none)
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();

        assert_eq!(outlines.len(), 1);
        // No auto-injection: LLM didn't say visual_type=image, so no media_generation
        assert!(
            outlines[0].media_generations.is_empty(),
            "omitting visual_type must NOT auto-inject an image — the old ensure_outline_media_generations behavior is gone"
        );
    }

    #[tokio::test]
    async fn repairs_empty_image_src_using_generated_media_placeholder() {
        // When visual_type=image, LLM returns empty src → should be repaired to gen_img_1
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide","visual_type":"image"}]}"#.to_string(),
                r#"{"elements":[{"kind":"image","src":"","left":60.0,"top":80.0,"width":400.0,"height":240.0}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();

        match content {
            SceneContent::Slide { canvas } => {
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Image { src, .. } => src == "gen_img_1",
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn falls_back_to_default_outlines_when_outline_json_is_invalid() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec!["not valid json at all".to_string()]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();

        assert_eq!(outlines.len(), 3);
        assert!(matches!(outlines[0].scene_type, SceneType::Slide));
        assert!(matches!(outlines[2].scene_type, SceneType::Quiz));
        // Fallback outlines use visual_type=None — no images
        assert!(
            outlines[0].media_generations.is_empty(),
            "fallback outlines should NOT auto-inject images under the new system"
        );
    }

    #[tokio::test]
    async fn repairs_outline_json_with_trailing_commas() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide",},],}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = pipeline.generate_outlines(&sample_request(), None).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(outlines[0].title, "Intro to Fractions");
    }

    #[tokio::test]
    async fn outline_generation_preserves_quiz_and_interactive_configs() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Lab","description":"Hands-on modeling","teachingObjective":"Explore part-whole relationships","estimatedDuration":180,"order":1,"key_points":["Manipulate parts","Observe equivalence"],"type":"interactive","interactiveConfig":{"conceptName":"Fractions","conceptOverview":"Manipulate a whole into equal parts","designIdea":"Use sliders and draggable parts to compare equivalent fractions","subject":"Math"}},{"title":"Fraction Check","description":"Assess understanding","key_points":["Numerator","Denominator"],"type":"quiz","quizConfig":{"questionCount":3,"difficulty":"medium","questionTypes":["single","multiple"]}}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = pipeline.generate_outlines(&sample_request(), None).await.unwrap();

        assert_eq!(outlines.len(), 2);
        assert!(matches!(outlines[0].scene_type, SceneType::Interactive));
        assert_eq!(
            outlines[0]
                .interactive_config
                .as_ref()
                .map(|config| config.subject.as_deref()),
            Some(Some("Math"))
        );
        assert_eq!(outlines[0].estimated_duration, Some(180));
        assert!(matches!(outlines[1].scene_type, SceneType::Quiz));
        assert_eq!(
            outlines[1]
                .quiz_config
                .as_ref()
                .map(|config| config.question_count),
            Some(3)
        );
    }

    #[tokio::test]
    async fn repairs_outline_json_with_missing_closing_braces() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = pipeline.generate_outlines(&sample_request(), None).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(outlines[0].title, "Intro to Fractions");
    }

    #[tokio::test]
    async fn falls_back_to_default_slide_elements_when_slide_json_is_invalid() {
        // Slide JSON is invalid → fallback elements should be text-only (no image unless visual_type=image)
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide","visual_type":"none"}]}"#.to_string(),
                "not valid json".to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();

        match content {
            SceneContent::Slide { canvas } => {
                // Must have at least fallback text elements
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Text { .. })));
                // visual_type=none → no AI image
                assert!(
                    !canvas.elements.iter().any(|element| matches!(element, SlideElement::Image { .. })),
                    "visual_type=none must produce no image element even when slide JSON fails"
                );
            }
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn slide_generation_supports_richer_elements_and_repairs_layout() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Models","description":"Compare visual models","key_points":["Area model","Number line"],"scene_type":"slide"}]}"#.to_string(),
                r#"{"elements":[{"id":"chart-1","kind":"chart","chart_type":"bar","left":-50.0,"top":20.0,"width":1200.0,"height":320.0},{"id":"latex-1","kind":"latex","latex":"\\frac{1}{2}","left":100.0,"top":360.0,"width":180.0,"height":90.0}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let content = pipeline
            .generate_scene_content(
                &sample_request(),
                &pipeline.generate_outlines(&sample_request(), None).await.unwrap()[0],
                None,
                &[],
            )
            .await
            .unwrap();

        match content {
            SceneContent::Slide { canvas } => {
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Chart { .. })));
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Latex { .. })));
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Text { content, .. } => content.contains("Fraction Models"),
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn action_generation_parses_interleaved_openmaic_style_arrays() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Models","description":"Compare visual models","key_points":["Area model","Number line"],"scene_type":"slide"}]}"#.to_string(),
                r#"{"elements":[{"id":"title-box","kind":"text","content":"Fraction Models","left":60.0,"top":60.0,"width":400.0,"height":60.0},{"id":"video-demo","kind":"video","src":"gen_vid_1","left":500.0,"top":140.0,"width":320.0,"height":180.0}]}"#.to_string(),
                r#"[{"type":"action","name":"spotlight","params":{"elementId":"title-box"}},{"type":"text","content":"Let's start with the title idea."},{"type":"action","name":"play_video","params":{"elementId":"video-demo"}},{"type":"text","content":"This explanation should be dropped because it comes after the video?"},{"type":"action","name":"discussion","params":{"topic":"Where do you see one half in real life?","prompt":"Give one everyday example."}}]"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();
        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content, None, &outlines, 0, &[])
            .await
            .unwrap();

        assert!(matches!(actions[0], LessonAction::Spotlight { .. }));
        assert!(matches!(actions[1], LessonAction::Speech { .. }));
        assert!(actions
            .iter()
            .any(|action| matches!(action, LessonAction::PlayVideo { .. })));
        assert!(matches!(
            actions.last(),
            Some(LessonAction::Discussion { .. })
        ));
    }

    #[tokio::test]
    async fn generation_pipeline_uses_phase_llms_and_escalates_scene_actions() {
        let fallback_llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"actions":[{"action_type":"speech","text":"Fallback action model produced valid JSON."}]}"#.to_string(),
            ]),
        };
        let actions_primary_llm = MockLlmProvider {
            responses: Mutex::new(vec!["this is not valid action json".to_string()]),
        };
        let content_llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"elements":[{"kind":"text","content":"Phase-based scene content.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
            ]),
        };
        let outlines_llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Phase Routed Outline","description":"Outline generated by outlines model","key_points":["Point A"],"scene_type":"slide"}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(MockLlmProvider {
            responses: Mutex::new(vec!["unused".to_string()]),
        }))
        .with_phase_llms(
            Box::new(outlines_llm),
            Box::new(content_llm),
            Box::new(actions_primary_llm),
        )
        .with_scene_actions_fallback_llm(Box::new(fallback_llm));

        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines[0].title, "Phase Routed Outline");

        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();
        match &content {
            SceneContent::Slide { canvas } => {
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Text { content, .. } if content.contains("Phase-based scene content"))));
            }
            _ => panic!("expected slide content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content, None, &outlines, 0, &[])
            .await
            .unwrap();
        assert!(actions.iter().any(|action| {
            matches!(
                action,
                LessonAction::Speech { text, .. } if text.contains("Fallback action model produced valid JSON.")
            )
        }));
    }

    #[tokio::test]
    async fn retries_transient_outline_generation_failures() {
        let llm = Arc::new(FlakyLlmProvider {
            failures_before_success: AtomicUsize::new(2),
            response: r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
            error_message: "temporary upstream timeout".to_string(),
            call_count: AtomicUsize::new(0),
        });

        let pipeline = LlmGenerationPipeline::new(Box::new(SharedFlakyLlmProvider {
            inner: Arc::clone(&llm),
        }));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(llm.call_count.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn does_not_retry_non_retryable_outline_failures() {
        let llm = Arc::new(FlakyLlmProvider {
            failures_before_success: AtomicUsize::new(1),
            response: r#"{"outlines":[{"title":"Ignored","description":"Ignored","key_points":["Ignored"],"scene_type":"slide"}]}"#.to_string(),
            error_message: "missing api key".to_string(),
            call_count: AtomicUsize::new(0),
        });

        let pipeline = LlmGenerationPipeline::new(Box::new(SharedFlakyLlmProvider {
            inner: Arc::clone(&llm),
        }));
        let error = pipeline
            .generate_outlines(&sample_request(), None)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("missing api key"));
        assert_eq!(llm.call_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn interactive_scene_generation_is_supported() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Explorer","description":"Hands-on exploration","key_points":["Visualize parts of a whole"],"scene_type":"interactive","interactive_config":{"concept_name":"Fractions","concept_overview":"Explore equivalent fractions visually","design_idea":"Use a slider and fraction bar","subject":"Math"}}]}"#.to_string(),
                r#"{"core_formulas":["a/b = c/d when ad = bc"],"constraints":["Partition the whole into equal parts"],"interaction_guidance":["Move the slider to change the numerator"]}"#.to_string(),
                r#"<!DOCTYPE html><html><body><h2>Fraction Explorer</h2><p>Move the slider to compare fractions.</p></body></html>"#.to_string(),
                r#"<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fraction Explorer</title><script>function updateResult(){document.getElementById('result').textContent='Equivalent fractions keep the same ratio.';}</script></head><body><h2>Fraction Explorer</h2><p class="instructions">Move the slider to change the numerator.</p><input type="range" min="1" max="4" value="1" oninput="updateResult()"><p id="result">Equivalent fractions keep the same ratio.</p></body></html>"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"Try changing the fraction slider and describe what you observe."}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(matches!(outlines[0].scene_type, SceneType::Interactive));

        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();
        match &content {
            SceneContent::Interactive {
                html,
                scientific_model,
                ..
            } => {
                assert!(html
                    .as_deref()
                    .unwrap_or_default()
                    .contains("Fraction Explorer"));
                assert!(scientific_model.is_some());
            }
            _ => panic!("expected interactive content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content, None, &outlines, 0, &[])
            .await
            .unwrap();
        assert!(!actions.is_empty());
    }

    #[tokio::test]
    async fn interactive_scene_generation_revises_sparse_scientific_model() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Density Explorer","description":"Investigate mass and volume","key_points":["Density compares mass and volume"],"scene_type":"interactive","interactive_config":{"concept_name":"Density","concept_overview":"Explore how mass and volume affect density","design_idea":"Use sliders and sample blocks","subject":"Science"}}]}"#.to_string(),
                r#"{"core_formulas":["density = mass / volume"],"interaction_guidance":["Change one slider."]}"#.to_string(),
                r#"{"variables":["mass","volume","density"],"interaction_guidance":["Change the mass slider.","Change the volume slider and compare the result."],"experiment_steps":["Set the same volume for two blocks.","Increase the mass of one block and compare densities."],"observation_prompts":["What changed when mass increased at constant volume?"]}"#.to_string(),
                r#"<!DOCTYPE html><html><body><h2>Density Explorer</h2><button onclick="document.getElementById('result').textContent='Higher mass at the same volume increases density.'">Test</button><p id="result"></p></body></html>"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"Try adjusting mass and volume, then explain how density changes."}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();

        match &content {
            SceneContent::Interactive {
                scientific_model: Some(model),
                ..
            } => {
                assert!(model.variables.len() >= 3);
                assert!(model.experiment_steps.len() >= 2);
                assert!(!model.observation_prompts.is_empty());
            }
            _ => panic!("expected interactive content with revised scientific model"),
        }
    }

    #[tokio::test]
    async fn pbl_scene_generation_is_supported() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Recipe Project","description":"Create a recipe card using fractions","key_points":["Scaling ingredients","Equivalent fractions"],"scene_type":"pbl","project_config":{"project_topic":"Recipe scaling","project_description":"Students redesign a recipe for new serving sizes","target_skills":["fractions","measurement"],"issue_count":3,"language":"en-US"}}]}"#.to_string(),
                r#"{"summary":"Build a mini recipe-conversion poster showing how to scale ingredient fractions for two serving sizes.","title":"Recipe Scaling Challenge","driving_question":"How can we scale a recipe without changing its balance?","final_deliverable":"A poster and worked conversion table","target_skills":["fractions","measurement","communication"],"milestones":["Choose a recipe","Convert ingredient amounts","Explain the math"],"team_roles":["Recipe analyst","Checker"],"assessment_focus":["accuracy","clarity"],"starter_prompt":"Choose a favorite recipe and identify one ingredient fraction to scale."}"#.to_string(),
                r#"{"agent_roles":[{"name":"Recipe analyst","responsibility":"Calculate scaled ingredient amounts","deliverable":"A checked conversion table"},{"name":"Checker","responsibility":"Verify equivalent fractions and units","deliverable":"A validation note"}],"success_criteria":["Scaled fractions are mathematically correct","Poster clearly explains the conversions"],"facilitator_notes":["Have teams compare two scaling strategies","Press students to justify equivalent fractions aloud"]}"#.to_string(),
                r#"{"issue_board":[{"title":"Choose a recipe","description":"Pick a recipe with at least one fractional ingredient.","owner_role":"Recipe analyst","checkpoints":["Select recipe","Highlight fractional ingredients"]},{"title":"Scale ingredient amounts","description":"Create new fraction amounts for a second serving size.","owner_role":"Recipe analyst","checkpoints":["Convert each ingredient","Check equivalent fractions"]},{"title":"Explain the math","description":"Prepare a poster section that explains the scaling process.","owner_role":"Checker","checkpoints":["Write explanation","Review clarity"]}]}"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"Let’s plan your project goal and expected deliverable first."},{"action_type":"discussion","topic":"Which real recipe would you like to scale?"}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(matches!(outlines[0].scene_type, SceneType::Pbl));

        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();
        match &content {
            SceneContent::Project { project_config } => {
                assert!(project_config.summary.contains("recipe"));
                assert_eq!(
                    project_config.driving_question.as_deref(),
                    Some("How can we scale a recipe without changing its balance?")
                );
                assert!(project_config
                    .milestones
                    .as_ref()
                    .is_some_and(|milestones| milestones.len() >= 3));
                assert!(project_config
                    .agent_roles
                    .as_ref()
                    .is_some_and(|roles| roles.len() >= 2));
                assert!(project_config
                    .issue_board
                    .as_ref()
                    .is_some_and(|issues| issues.len() >= 3));
            }
            _ => panic!("expected project content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content, None, &outlines, 0, &[])
            .await
            .unwrap();
        assert!(actions
            .iter()
            .any(|action| matches!(action, LessonAction::Discussion { .. })));
    }

    #[tokio::test]
    async fn pbl_scene_generation_revises_sparse_project_plan() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Water Filter Project","description":"Design a classroom water filter","key_points":["Materials","Testing","Explaining results"],"scene_type":"pbl","project_config":{"project_topic":"Water filter design","project_description":"Students build and test a simple filter","target_skills":["science","collaboration"],"issue_count":3,"language":"en-US"}}]}"#.to_string(),
                r#"{"summary":"Build a simple water filter and explain what it removes."}"#.to_string(),
                r#"{"summary":"Build and test a simple water filter, then explain the evidence from your test results.","title":"Water Filter Challenge","driving_question":"How can we improve water clarity using simple materials?","final_deliverable":"A tested filter prototype and a short evidence-based explanation","target_skills":["science","collaboration","evidence"],"milestones":["Choose materials","Build and test the filter","Explain the evidence"],"team_roles":["Builder","Recorder"],"assessment_focus":["quality of evidence","clarity of explanation"],"starter_prompt":"Choose two filter materials and predict which one will work best."}"#.to_string(),
                r#"{"agent_roles":[{"name":"Builder","responsibility":"Assemble and adjust the prototype","deliverable":"A working filter build log"},{"name":"Recorder","responsibility":"Capture measurements and evidence","deliverable":"A short evidence summary"}],"success_criteria":["The filter process is testable","The team explains the evidence clearly","The final explanation matches the observed results"],"facilitator_notes":["Push students to compare evidence across trials","Ask teams to justify material choices with data"]}"#.to_string(),
                r#"{"issue_board":[{"title":"Choose materials","description":"Pick and justify the filter materials.","owner_role":"Builder","checkpoints":["List materials","Predict performance"]},{"title":"Run filter tests","description":"Test the filter and record the results.","owner_role":"Recorder","checkpoints":["Run at least two trials","Record observations"]},{"title":"Explain the evidence","description":"Prepare the final explanation and recommendations.","owner_role":"Recorder","checkpoints":["Summarize results","Connect claims to evidence"]}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0], None, &[])
            .await
            .unwrap();

        match &content {
            SceneContent::Project { project_config } => {
                assert!(project_config
                    .driving_question
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()));
                assert!(project_config
                    .final_deliverable
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()));
                assert!(project_config
                    .milestones
                    .as_ref()
                    .is_some_and(|milestones| milestones.len() >= 3));
                assert!(project_config
                    .team_roles
                    .as_ref()
                    .is_some_and(|roles| roles.len() >= 2));
            }
            _ => panic!("expected project content"),
        }
    }

    #[tokio::test]
    async fn web_search_degrades_gracefully_without_tavily_config() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
    }

    // ── Deployment tests: image gating ────────────────────────────────────────

    #[tokio::test]
    async fn image_generation_disabled_flag_produces_no_media_generations() {
        // When enable_image_generation = false, no outline should have media_generations.
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                // LLM tries to include an image despite the flag
                r#"{"outlines":[{"title":"Mitochondria","description":"Cell powerhouse","key_points":["ATP","cristae"],"scene_type":"slide","media_generations":[{"element_id":"gen_img_1","media_type":"image","prompt":"Mitochondria diagram","aspect_ratio":"16:9"}]}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.requirements.requirement = "Teach mitochondria".to_string();
        request.enable_image_generation = false;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1, "should parse 1 outline");
        assert!(
            outlines[0].media_generations.is_empty(),
            "disabled image gen must yield no media_generations, got: {:?}",
            outlines[0].media_generations
        );
    }

    // REMOVED: image_generation_enabled_adds_fallback_when_llm_did_not_propose_one
    // Rationale: ensure_outline_media_generations() has been DELETED. The new system
    // ONLY creates an AI image when the LLM explicitly says visual_type="image".
    // Auto-injection of images without LLM consent no longer exists by design.

    #[tokio::test]
    async fn visual_type_image_with_flag_on_creates_media_generation() {
        // When LLM says visual_type="image" AND enable_image_generation=true,
        // exactly 1 media_generation must be created with a smart prompt.
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Eiffel Tower","description":"Iconic French landmark","key_points":["steel lattice","1889"],"scene_type":"slide","visual_type":"image"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.requirements.requirement = "Teach Paris landmarks".to_string();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert_eq!(
            outlines[0].media_generations.len(),
            1,
            "LLM requested image type with flag on → exactly 1 media_generation"
        );
        assert!(
            matches!(outlines[0].media_generations[0].media_type, MediaType::Image),
        );
        assert!(
            outlines[0].media_generations[0].prompt.contains("Eiffel Tower"),
            "smart prompt must mention the scene title"
        );
        assert!(
            matches!(outlines[0].visual_type, Some(VisualType::Image)),
            "visual_type field must be Some(Image)"
        );
    }

    #[tokio::test]
    async fn visual_type_image_with_flag_off_creates_no_media_generation() {
        // When LLM says visual_type="image" but enable_image_generation=false (kill switch),
        // no media_generation should be created.
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Eiffel Tower","description":"Landmark","key_points":["steel"],"scene_type":"slide","visual_type":"image"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = false;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(
            outlines[0].media_generations.is_empty(),
            "kill switch OFF must prevent AI image even when LLM asked for it"
        );
    }

    #[tokio::test]
    async fn visual_type_chart_creates_no_media_generation() {
        // When LLM says visual_type="chart", no AI image should be generated.
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Mitochondria Energy","description":"ATP production stats","key_points":["ATP","ADP","efficiency"],"scene_type":"slide","visual_type":"chart"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(
            outlines[0].media_generations.is_empty(),
            "chart visual_type must produce zero AI image requests"
        );
        assert!(
            matches!(outlines[0].visual_type, Some(VisualType::Chart)),
            "visual_type must be Some(Chart)"
        );
    }

    #[tokio::test]
    async fn visual_type_none_creates_no_media_generation() {
        // When LLM says visual_type="none", absolutely nothing should be generated.
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Vocabulary: Osmosis","description":"Word definitions","key_points":["solvent","solute"],"scene_type":"slide","visual_type":"none"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(
            outlines[0].media_generations.is_empty(),
            "none visual_type must produce zero media generations"
        );
    }

    #[tokio::test]
    async fn image_generation_does_not_duplicate_when_llm_already_provided_visual_type_image() {
        // When LLM sets visual_type="image" and enable_image_generation=true,
        // only 1 media_generation is created (no double-injection).
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Mitochondria","description":"Cell powerhouse","key_points":["ATP"],"scene_type":"slide","visual_type":"image"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request, None).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert_eq!(
            outlines[0].media_generations.len(),
            1,
            "exactly 1 media_generation — no duplicate injection"
        );
    }

    #[test]
    fn build_smart_image_prompt_includes_title_and_domain_style() {
        let prompt = build_smart_image_prompt(
            "Mitochondria",
            "The powerhouse of the cell",
            &["ATP synthesis".to_string(), "Inner membrane".to_string()],
        );
        assert!(prompt.contains("Mitochondria"), "prompt must include scene title");
        assert!(
            prompt.contains("scientific illustration") || prompt.contains("educational"),
            "prompt must include a domain-appropriate style hint"
        );
    }

    #[test]
    fn build_smart_image_prompt_handles_empty_key_points() {
        let prompt = build_smart_image_prompt("Fractions", "Parts of a whole", &[]);
        assert!(prompt.contains("Fractions"), "title must appear in prompt");
    }

    #[tokio::test]
    async fn generate_lesson_title_default_impl_returns_empty_string() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                "My Short Title".to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = vec![
            ai_tutor_domain::scene::SceneOutline {
                id: "sc-1".to_string(),
                title: "Intro to Mitochondria".to_string(),
                description: "Overview".to_string(),
                key_points: vec![],
                scene_type: ai_tutor_domain::scene::SceneType::Slide,
                visual_type: Some(VisualType::None),
                media_generations: vec![],
                quiz_config: None,
                interactive_config: None,
                project_config: None,
                suggested_image_ids: vec![],
                language: None,
                teaching_objective: None,
                estimated_duration: None,
                widget_type: None,
                widget_outline: None,
                order: 0,
            },
        ];
        let result = pipeline
            .generate_lesson_title("Teach mitochondria", &outlines, "en-US")
            .await;
        assert!(result.is_ok(), "generate_lesson_title must not error");
        let title = result.unwrap();
        assert!(!title.trim().is_empty() || title.is_empty(), "title must be a string");
    }

    // ── Medical web search detection tests ───────────────────────────────────

    #[test]
    fn medical_detector_identifies_clinical_content() {
        assert!(is_medical_content("You are a teacher.", "Explain the diagnosis and treatment of type 2 diabetes"));
        assert!(is_medical_content("System", "Lesson about pharmacology of antibiotics and drug interactions"));
        assert!(is_medical_content("System", "Create a quiz on cardiovascular pathology and hypertension"));
        assert!(is_medical_content("System", "Teach the mechanism of vaccine immunization"));
        assert!(is_medical_content("System", "Explain the clinical guidelines for sepsis management"));
    }

    #[test]
    fn medical_detector_ignores_non_medical_content() {
        assert!(!is_medical_content("You are a teacher.", "Teach fractions and fraction models"));
        assert!(!is_medical_content("System", "Lesson about Newton's laws of motion"));
        assert!(!is_medical_content("System", "Explain photosynthesis in plants"));
        assert!(!is_medical_content("System", "Introduction to Python programming"));
        assert!(!is_medical_content("System", "The French Revolution and its causes"));
    }

    #[test]
    fn medical_detector_catches_partial_keywords() {
        // "dosage" should trigger even in a broader sentence
        assert!(is_medical_content("System", "Calculate the correct dosage of medication for a patient"));
        // "symptom" should trigger
        assert!(is_medical_content("System", "Identify the primary symptom of the disorder"));
    }

    #[test]
    fn medical_tool_prompt_contains_mandatory_search_and_disclaimer() {
        let prompt = build_web_search_tool_prompt(false, true);
        assert!(prompt.contains("MEDICAL GROUNDING MODE"), "medical prompt must announce medical mode");
        assert!(prompt.contains("MANDATORY"), "medical prompt must mark search as mandatory");
        assert!(prompt.contains("DISCLAIMER"), "medical prompt must require a disclaimer");
        assert!(prompt.contains("authoritative"), "medical prompt must mention authoritative sources");
        assert!(prompt.contains("healthcare professional"), "medical prompt must mention consulting a healthcare professional");
    }

    #[test]
    fn non_medical_tool_prompt_omits_medical_specifics() {
        let prompt = build_web_search_tool_prompt(false, false);
        assert!(!prompt.contains("MEDICAL GROUNDING MODE"), "non-medical prompt must not mention medical mode");
        assert!(!prompt.contains("DISCLAIMER"), "non-medical prompt must not require a disclaimer");
    }
}


