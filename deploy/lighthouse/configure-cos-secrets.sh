#!/usr/bin/env bash
set -euo pipefail

project_dir="/opt/ai-video-qc"
env_file="$project_dir/deploy/lighthouse/.env"

if [[ ! -f "$env_file" ]]; then
  echo "未找到生产环境配置文件：$env_file" >&2
  exit 1
fi

read -r -s -p "请输入腾讯云 SecretId（输入不会显示）：" cos_secret_id
echo
read -r -s -p "请输入腾讯云 SecretKey（输入不会显示）：" cos_secret_key
echo

if [[ -z "$cos_secret_id" || -z "$cos_secret_key" ]]; then
  echo "SecretId 和 SecretKey 不能为空。" >&2
  exit 1
fi

export QC_COS_SECRET_ID="$cos_secret_id"
export QC_COS_SECRET_KEY="$cos_secret_key"

python3 - "$env_file" <<'PY'
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
updates = {
    "VIDEO_STORAGE_PROVIDER": "cos",
    "COS_REGION": "ap-shanghai",
    "COS_BUCKET": "ai-video-qc-prod-1479003531",
    "COS_VIDEO_PREFIX": "ai-video-qc/videos",
    "COS_SIGNED_URL_TTL_SECONDS": "900",
    "TENCENTCLOUD_SECRET_ID": os.environ["QC_COS_SECRET_ID"],
    "TENCENTCLOUD_SECRET_KEY": os.environ["QC_COS_SECRET_KEY"],
}

def encode(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"

lines = path.read_text(encoding="utf-8").splitlines()
seen = set()
result = []
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0].strip()
        if key in updates:
            result.append(f"{key}={encode(updates[key])}")
            seen.add(key)
            continue
    result.append(line)

for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={encode(value)}")

path.write_text("\n".join(result) + "\n", encoding="utf-8")
PY

unset QC_COS_SECRET_ID QC_COS_SECRET_KEY cos_secret_id cos_secret_key
chmod 600 "$env_file"

cd "$project_dir"
docker compose --env-file "$env_file" -f deploy/lighthouse/compose.yaml up -d --no-deps --force-recreate api

echo "COS 配置已写入并已重启后端。"
