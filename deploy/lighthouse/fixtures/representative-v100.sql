-- Synthetic, non-login fixture for the seven-migration V1.0 schema. Never production data.
INSERT INTO users (id,name,account,password_hash,role,updated_at)
VALUES ('10000000-0000-4000-8000-000000000001','本地迁移夹具','migration-fixture','not-a-login-hash','admin',now());
INSERT INTO videos (id,title,original_file_name,file_path,mime_type,file_size_bytes,video_type,creator_id,status,updated_at)
VALUES ('20000000-0000-4000-8000-000000000001','代表性历史有效视频','fixture.mp4','fixture-only.mp4','video/mp4',32,'organic','10000000-0000-4000-8000-000000000001','final_effective',now());
INSERT INTO videos (id,title,original_file_name,file_path,mime_type,file_size_bytes,video_type,creator_id,status,parent_video_id,version,updated_at)
VALUES ('20000000-0000-4000-8000-000000000002','历史返修关联','revision.mp4','fixture-only-revision.mp4','video/mp4',32,'organic','10000000-0000-4000-8000-000000000001','submitted','20000000-0000-4000-8000-000000000001',2,now());
INSERT INTO ai_content_reviews (id,video_id,model_provider,model_name,content_grade,total_score,status,raw_response)
VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture','content','A',88,'succeeded','{"original":"内容原文保留"}');
INSERT INTO content_review_scores (id,ai_content_review_id,dimension,score,max_score)
VALUES ('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','画面',8,10);
INSERT INTO supervisor_reviews (id,video_id,reviewer_id,review_result,is_allowed_to_publish)
VALUES ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','approved_for_publish',true);
INSERT INTO video_result_metrics (id,video_id,video_type,views,roi,submitted_by,updated_at)
VALUES ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','organic',1000,2.3500,'10000000-0000-4000-8000-000000000001',now());
INSERT INTO ai_result_reviews (id,video_id,result_metric_id,model_provider,model_name,data_grade,data_sufficiency,status,raw_response)
VALUES ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','fixture','result','B','sufficient','succeeded','{"original":"数据原文保留"}');
INSERT INTO rule_engine_results (id,video_id,content_review_id,result_review_id,content_grade,data_grade,data_sufficiency,rule_code,rule_result,rule_reason,recommended_boundary)
VALUES ('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','A','B','sufficient','R12','effective_candidate','历史规则','allow_final_effective');
INSERT INTO final_video_evaluations (id,video_id,content_review_id,result_review_id,rule_engine_result_id,model_provider,model_name,content_grade,data_grade,final_grade,final_status,is_effective_final,confirmed_by,confirmed_at,triggered_by_id,status,raw_response,updated_at)
VALUES ('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','fixture','final','A','B','effective','final_effective',true,'10000000-0000-4000-8000-000000000001',now(),'10000000-0000-4000-8000-000000000001','succeeded','{"original":"建议原文保留"}',now());
INSERT INTO operation_logs (id,user_id,video_id,action_type,comment)
VALUES ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','final_evaluation_confirmed','原始审计');
INSERT INTO ai_model_configs (id,agent_type,provider,model_name,updated_at)
VALUES ('a0000000-0000-4000-8000-000000000001','content_review','fixture','disabled-model',now());
INSERT INTO platform_benchmarks (id,platform,video_type,metric_name,a_threshold,direction,updated_at)
VALUES ('b0000000-0000-4000-8000-000000000001','fixture','organic','views',1000,'higher_is_better',now());
