#!/bin/sh
# Idempotent MinIO bootstrap: buckets (private, versioned) and a least-privilege user for the application.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

for bucket in "$S3_BUCKET" "$S3_BACKUP_BUCKET"; do
  mc mb --ignore-existing "local/$bucket"
  mc anonymous set none "local/$bucket"
  mc version enable "local/$bucket"
done

# Backups older than 60 days are removed by lifecycle rules in addition to the application's "keep last N".
mc ilm rule add --expire-days 60 "local/$S3_BACKUP_BUCKET" >/dev/null 2>&1 || true

cat > /tmp/adpilot-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET", "arn:aws:s3:::$S3_BACKUP_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET/*", "arn:aws:s3:::$S3_BACKUP_BUCKET/*"]
    }
  ]
}
EOF

mc admin policy create local adpilot-app /tmp/adpilot-policy.json >/dev/null 2>&1 || mc admin policy create local adpilot-app /tmp/adpilot-policy.json
if ! mc admin user info local "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
fi
mc admin policy attach local adpilot-app --user "$S3_ACCESS_KEY_ID" >/dev/null 2>&1 || true
echo "MinIO ready: buckets $S3_BUCKET, $S3_BACKUP_BUCKET; application user $S3_ACCESS_KEY_ID"
